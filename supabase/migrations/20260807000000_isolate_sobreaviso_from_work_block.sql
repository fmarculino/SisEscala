-- Migration: Impede que Sobreaviso seja fundido no bloco de trabalho continuo
-- Data: 2026-08-07
--
-- PROBLEMA
--   fn_confirmar_presenca agrupa os turnos do dia em "blocos continuos": se um turno comeca
--   antes ou no instante em que o anterior termina, os dois viram um bloco so, e a janela de
--   SAIDA passa a ser o fim do ultimo turno. Isso e correto e desejado para
--   Regular + Extra + Plantao (ex: 08h-18h + 2h extra + Plantao N 12h = um bloco continuo).
--
--   Sobreaviso, porem, tambem entrava nessa fusao. E o start_hour do Sobreaviso e alinhado
--   ao fim do turno Regular do dia (o terceiro elemento do COALESCE de start_hour nao filtra
--   por categoria), de modo que um Sobreaviso N12 encostava exatamente no fim da jornada:
--
--       Regular    08:00 -> 18:00
--       Sobreaviso 18:00 -> 06:00 (dia seguinte)
--       merge: 1080 <= 1080  =>  bloco unico 08:00 -> 06:00
--
--   Consequencia: o servidor nao conseguia registrar a saida as 18:00, porque o sistema
--   passava a esperar a saida as 06:00 do dia seguinte.
--
-- EVIDENCIA (producao, 08/2026)
--   logs_tentativas_presenca da servidora LUCIA LAYANE ROSA SAMPAIO:
--     05/08 18:26 e 18:29 -> "Fora da janela de presenca permitida", escala_prevista_fim 06:00
--     06/08 18:17 e 18:18 -> idem
--   27 servidor-dias em 08/2026 tinham Sobreaviso no mesmo dia de Regular/Plantao.
--
-- CORRECAO
--   Sobreaviso nunca funde com outro turno: permanece sempre como bloco isolado, com janela
--   propria. Regular, Extra e Plantao continuam fundindo entre si exatamente como antes.
--
-- ATENCAO AO RECRIAR ESTAS FUNCOES NO FUTURO
--   Preserve as condicoes "<> 'Sobreaviso'" nas 8 comparacoes de fusao de bloco.
--   Ver .agents/AGENTS.md e CLAUDE.md.
--
-- Baseada em: 20260806000000_restore_interval_guard_short_journeys.sql
-- (corpo preservado byte a byte, exceto as 8 condicoes de fusao)


-- 0. FONTE UNICA DA REGRA DE INTERVALO INTRAJORNADA
CREATE OR REPLACE FUNCTION public.fn_jornada_tem_intervalo(
    p_duracao_minutos integer,
    p_intervalo_minutos integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $fn$
    -- CLT Art. 71: intervalo obrigatorio somente acima de 6h (360 min).
    -- Exige tambem que a jornada cadastrada tenha intervalo_minutos > 0.
    SELECT COALESCE(p_duracao_minutos, 0) > 360
       AND COALESCE(p_intervalo_minutos, 0) > 0;
$fn$;

COMMENT ON FUNCTION public.fn_jornada_tem_intervalo(integer, integer) IS
    'Regra unica de intervalo intrajornada (CLT Art. 71): duracao > 360 min E intervalo_minutos > 0.';


CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca(
    p_matricula text, 
    p_pin_servidor text, 
    p_coordenador_id uuid,
    p_momento_simulado timestamp with time zone default null
)
RETURNS jsonb AS $$
DECLARE
    v_servidor_id UUID;
    v_servidor_unidade_id UUID;
    v_servidor_setor_id UUID;
    v_escala_mensal_id UUID;
    v_unidade_id UUID;
    v_ignora_janela BOOLEAN;
    
    v_now TIMESTAMP WITH TIME ZONE;
    v_now_local TIMESTAMP;
    v_janela_minutos INTEGER;
    v_timezone TEXT;
    
    v_hora_atual INTEGER;
    v_minuto_atual INTEGER;
    v_momento_atual_minutos INTEGER;
    
    v_dia_hoje INTEGER;
    v_mes INTEGER;
    v_ano INTEGER;
    
    v_dia_ontem INTEGER;
    v_mes_ontem INTEGER;
    v_ano_ontem INTEGER;
    v_date_ontem DATE;

    -- Shift variables
    r RECORD;
    v_shifts_count INTEGER;
    v_blocks_count INTEGER;
    v_start_hour INTEGER;

    -- Today/Yesterday shifts (up to 3 supported)
    v_s1_id UUID; v_s1_inicio INTEGER; v_s1_fim INTEGER; v_s1_entrada TIMESTAMP WITH TIME ZONE; v_s1_int_saida TIMESTAMP WITH TIME ZONE; v_s1_int_retorno TIMESTAMP WITH TIME ZONE; v_s1_saida TIMESTAMP WITH TIME ZONE; v_s1_cat TEXT; v_s1_int_ini_min INTEGER; v_s1_int_fim_min INTEGER; v_s1_permite_int BOOLEAN;
    v_s2_id UUID; v_s2_inicio INTEGER; v_s2_fim INTEGER; v_s2_entrada TIMESTAMP WITH TIME ZONE; v_s2_int_saida TIMESTAMP WITH TIME ZONE; v_s2_int_retorno TIMESTAMP WITH TIME ZONE; v_s2_saida TIMESTAMP WITH TIME ZONE; v_s2_cat TEXT; v_s2_int_ini_min INTEGER; v_s2_int_fim_min INTEGER; v_s2_permite_int BOOLEAN;
    v_s3_id UUID; v_s3_inicio INTEGER; v_s3_fim INTEGER; v_s3_entrada TIMESTAMP WITH TIME ZONE; v_s3_int_saida TIMESTAMP WITH TIME ZONE; v_s3_int_retorno TIMESTAMP WITH TIME ZONE; v_s3_saida TIMESTAMP WITH TIME ZONE; v_s3_cat TEXT; v_s3_int_ini_min INTEGER; v_s3_int_fim_min INTEGER; v_s3_permite_int BOOLEAN;

    -- Today/Yesterday blocks (up to 3 blocks)
    v_b1_inicio INTEGER; v_b1_fim INTEGER; v_b1_ids UUID[]; v_b1_entradas TIMESTAMP WITH TIME ZONE[]; v_b1_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b1_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b1_saidas TIMESTAMP WITH TIME ZONE[]; v_b1_cat TEXT; v_b1_int_ini INTEGER; v_b1_int_fim INTEGER; v_b1_permite_int BOOLEAN;
    v_b2_inicio INTEGER; v_b2_fim INTEGER; v_b2_ids UUID[]; v_b2_entradas TIMESTAMP WITH TIME ZONE[]; v_b2_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b2_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b2_saidas TIMESTAMP WITH TIME ZONE[]; v_b2_cat TEXT; v_b2_int_ini INTEGER; v_b2_int_fim INTEGER; v_b2_permite_int BOOLEAN;
    v_b3_inicio INTEGER; v_b3_fim INTEGER; v_b3_ids UUID[]; v_b3_entradas TIMESTAMP WITH TIME ZONE[]; v_b3_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b3_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b3_saidas TIMESTAMP WITH TIME ZONE[]; v_b3_cat TEXT; v_b3_int_ini INTEGER; v_b3_int_fim INTEGER; v_b3_permite_int BOOLEAN;

    -- Ponto Facultativo variables
    v_block_date DATE;
    v_pf_inicio_liberacao TIME;
    v_pf_fim_liberacao TIME;
    v_pf_desc TEXT;
    v_pf_inicio_minutos INTEGER;
    v_pf_fim_minutos INTEGER;
    v_pf_existe BOOLEAN;
BEGIN
    v_now := COALESCE(p_momento_simulado, now());
    
    SELECT (valor#>>'{}')::text INTO v_timezone 
    FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    SELECT (valor#>>'{}')::integer INTO v_janela_minutos 
    FROM public.configuracoes_globais WHERE chave = 'janela_presenca_minutos';
    IF v_janela_minutos IS NULL THEN v_janela_minutos := 30; END IF;

    v_now_local := v_now AT TIME ZONE v_timezone;
    
    v_hora_atual := extract(hour from v_now_local)::integer;
    v_minuto_atual := extract(minute from v_now_local)::integer;
    v_momento_atual_minutos := (v_hora_atual * 60) + v_minuto_atual;
    
    v_dia_hoje := extract(day from v_now_local)::integer;
    v_mes := extract(month from v_now_local)::integer;
    v_ano := extract(year from v_now_local)::integer;
    
    v_date_ontem := v_now_local::date - interval '1 day';
    v_dia_ontem := extract(day from v_date_ontem)::integer;
    v_mes_ontem := extract(month from v_date_ontem)::integer;
    v_ano_ontem := extract(year from v_date_ontem)::integer;

    -- Validate servant credentials and fetch their unit/sector
    SELECT s.id, s.unidade_id, s.setor_id, s.ignora_janela_presenca 
    INTO v_servidor_id, v_servidor_unidade_id, v_servidor_setor_id, v_ignora_janela
    FROM public.servidores s
    WHERE s.matricula = p_matricula;

    IF v_servidor_id IS NULL OR NOT public.verify_pin(v_servidor_id, p_pin_servidor) THEN
        PERFORM public.fn_log_tentativa_negada(
            v_servidor_id, 
            p_matricula, 
            p_coordenador_id, 
            'Matrícula ou PIN inválidos.', 
            NULL, NULL, NULL, NULL, NULL, NULL, NULL
        );
        RETURN jsonb_build_object('success', false, 'message', 'Matrícula ou PIN inválidos.');
    END IF;

    -- Validate coordinator permissions for this servant
    DECLARE
        v_coord_role TEXT;
        v_coord_todas_unidades BOOLEAN;
        v_coord_todos_setores BOOLEAN;
        v_has_unit_access BOOLEAN := false;
        v_has_sector_access BOOLEAN := false;
        v_has_scale_access_ontem BOOLEAN := false;
        v_has_scale_access_hoje BOOLEAN := false;
    BEGIN
        SELECT role::text, acesso_todas_unidades, acesso_todos_setores
        INTO v_coord_role, v_coord_todas_unidades, v_coord_todos_setores
        FROM public.profiles
        WHERE id = p_coordenador_id;

        IF v_coord_role = 'super_admin' THEN
            v_has_unit_access := true;
            v_has_sector_access := true;
        ELSE
            IF v_coord_todas_unidades THEN
                v_has_unit_access := true;
            ELSE
                SELECT EXISTS (
                    SELECT 1 FROM public.profile_unidades 
                    WHERE profile_id = p_coordenador_id AND unidade_id = v_servidor_unidade_id
                ) INTO v_has_unit_access;
            END IF;

            IF v_coord_todos_setores AND v_has_unit_access THEN
                v_has_sector_access := true;
            ELSIF v_coord_role = 'admin' AND v_has_unit_access THEN
                v_has_sector_access := true;
            ELSE
                SELECT EXISTS (
                    SELECT 1 FROM public.profile_setores 
                    WHERE profile_id = p_coordenador_id AND setor_id = v_servidor_setor_id
                ) INTO v_has_sector_access;
            END IF;
        END IF;

        IF NOT v_has_sector_access THEN
            SELECT EXISTS (
                SELECT 1 
                FROM public.escala_diaria ed
                JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
                WHERE em.servidor_id = v_servidor_id
                  AND em.mes = v_mes_ontem
                  AND em.ano = v_ano_ontem
                  AND ed.dia = v_dia_ontem
                  AND ed.categoria IN ('Regular', 'Plantão', 'Extra', 'Sobreaviso')
                  AND (
                      v_coord_todas_unidades OR EXISTS (
                          SELECT 1 FROM public.profile_unidades pu 
                          WHERE pu.profile_id = p_coordenador_id AND pu.unidade_id = em.unidade_id
                      )
                  )
                  AND (
                      v_coord_todos_setores OR v_coord_role = 'admin' OR EXISTS (
                          SELECT 1 FROM public.profile_setores ps 
                          WHERE ps.profile_id = p_coordenador_id AND ps.setor_id = em.setor_id
                      )
                  )
            ) INTO v_has_scale_access_ontem;

            SELECT EXISTS (
                SELECT 1 
                FROM public.escala_diaria ed
                JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
                WHERE em.servidor_id = v_servidor_id
                  AND em.mes = v_mes
                  AND em.ano = v_ano
                  AND ed.dia = v_dia_hoje
                  AND ed.categoria IN ('Regular', 'Plantão', 'Extra', 'Sobreaviso')
                  AND (
                      v_coord_todas_unidades OR EXISTS (
                          SELECT 1 FROM public.profile_unidades pu 
                          WHERE pu.profile_id = p_coordenador_id AND pu.unidade_id = em.unidade_id
                      )
                  )
                  AND (
                      v_coord_todos_setores OR v_coord_role = 'admin' OR EXISTS (
                          SELECT 1 FROM public.profile_setores ps 
                          WHERE ps.profile_id = p_coordenador_id AND ps.setor_id = em.setor_id
                      )
                  )
            ) INTO v_has_scale_access_hoje;

            IF v_has_scale_access_ontem OR v_has_scale_access_hoje THEN
                v_has_sector_access := true;
            END IF;
        END IF;

        IF NOT v_has_sector_access THEN
            PERFORM public.fn_log_tentativa_negada(
                v_servidor_id, 
                p_matricula, 
                p_coordenador_id, 
                'Sem permissão para validar este servidor nesta unidade/setor.', 
                NULL, NULL, NULL, NULL, NULL, NULL, NULL
            );
            RETURN jsonb_build_object('success', false, 'message', 'Sem permissão para validar este servidor nesta unidade/setor.');
        END IF;
    END;

    -- Check yesterday's shifts first (for overnight shift exit)
    v_s1_id := NULL; v_s2_id := NULL; v_s3_id := NULL;
    v_b1_ids := '{}'; v_b2_ids := '{}'; v_b3_ids := '{}';
    v_shifts_count := 0;

    FOR r IN 
        SELECT 
            ed.id as escala_diaria_id, 
            ed.presenca_entrada_em, 
            ed.presenca_intervalo_saida_em,
            ed.presenca_intervalo_retorno_em,
            ed.presenca_saida_em, 
            ed.categoria::text as categoria,
            dt.horas_computadas, 
            j.nome as jornada_nome, 
            j.horas_totais,
            COALESCE(j.intervalo_minutos, 60) as intervalo_minutos,
            j.intervalo_inicio_padrao,
            j.intervalo_fim_padrao,
            s.intervalo_inicio_personalizado,
            s.intervalo_fim_personalizado,
            COALESCE(u.permite_marca_intervalo, false) as permite_marca_intervalo,
            COALESCE(
                CASE WHEN ed.categoria = 'Regular' THEN
                    COALESCE(
                        CASE 
                          WHEN j.nome IS NOT NULL AND substring(j.nome from '^([0-9]+)')::integer IS NOT NULL THEN
                              substring(j.nome from '^([0-9]+)')::integer
                          ELSE NULL
                        END,
                        CASE 
                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer

                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer IS NOT NULL AND
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 11 AND 14
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
                          
                          ELSE NULL
                        END,
                        CASE 
                          WHEN dt.codigo = 'T4' THEN 14
                          WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer
                          WHEN dt.slots[1] = 'M' THEN 7
                          WHEN dt.slots[1] = 'T' THEN 13
                          WHEN dt.slots[1] = 'N' THEN 19
                          ELSE 7
                        END
                    )
                ELSE NULL END,
                CASE WHEN ed.categoria = 'Plantão' THEN
                    COALESCE(
                        CASE 
                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer

                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer IS NOT NULL AND
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 11 AND 14
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                          WHEN j.nome IS NOT NULL AND substring(j.nome from '^([0-9]+)')::integer IS NOT NULL THEN
                              substring(j.nome from '^([0-9]+)')::integer
                          
                          ELSE NULL
                        END,
                        CASE 
                          WHEN dt.codigo = 'T4' THEN 14
                          WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer
                          WHEN dt.slots[1] = 'M' THEN 7
                          WHEN dt.slots[1] = 'T' THEN 13
                          WHEN dt.slots[1] = 'N' THEN 19
                          ELSE 7
                        END
                    )
                ELSE NULL END,
                (
                    SELECT 
                        COALESCE(
                            (
                                SELECT 
                                    CASE 
                                        WHEN substring(j2.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer < substring(j2.nome from '^([0-9]+)')::integer THEN
                                            substring(j2.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer + 24
                                        ELSE
                                            substring(j2.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer
                                    END
                                FROM public.escala_diaria ed2
                                JOIN public.escala_mensal em2 ON ed2.escala_mensal_id = em2.id
                                JOIN public.jornadas j2 ON j2.id = public.obter_jornada_servidor_data(em2.servidor_id, MAKE_DATE(em2.ano, em2.mes, ed2.dia), em2.jornada_id)
                                WHERE em2.id = em.id
                                   AND ed2.dia = ed.dia
                                   AND ed2.categoria = 'Regular'
                                LIMIT 1
                            ),
                            (
                                SELECT 
                                    CASE 
                                        WHEN dt2.slots[1] = 'M' THEN 13
                                        WHEN dt2.slots[1] = 'T' THEN 19
                                        WHEN dt2.slots[1] = 'N' THEN 7 + 24
                                        WHEN dt2.slots[1] ~ '^[0-9]+$' THEN 
                                            CASE 
                                                WHEN (dt2.slots[1]::integer + dt2.horas_computadas::integer) >= 24 THEN
                                                    dt2.slots[1]::integer + dt2.horas_computadas::integer
                                                WHEN (dt2.slots[1]::integer + dt2.horas_computadas::integer) < dt2.slots[1]::integer THEN
                                                    dt2.slots[1]::integer + dt2.horas_computadas::integer + 24
                                                ELSE
                                                    dt2.slots[1]::integer + dt2.horas_computadas::integer
                                            END
                                        ELSE 19
                                    END
                                FROM public.escala_diaria ed2
                                JOIN public.dicionario_turnos dt2 ON ed2.dicionario_turnos_id = dt2.id
                                WHERE ed2.escala_mensal_id = em.id
                                   AND ed2.dia = ed.dia
                                   AND ed2.categoria = 'Plantão'
                                LIMIT 1
                            )
                        )
                ),
                CASE 
                  WHEN dt.codigo = 'T4' THEN 14
                  WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer
                  WHEN dt.slots[1] = 'M' THEN 7
                  WHEN dt.slots[1] = 'T' THEN 13
                  WHEN dt.slots[1] = 'N' THEN 19
                  ELSE 7
                END
            ) as start_hour
        FROM public.escala_diaria ed
        JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
        JOIN public.servidores s ON em.servidor_id = s.id
        JOIN public.unidades u ON em.unidade_id = u.id
        JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
        LEFT JOIN public.jornadas j ON j.id = public.obter_jornada_servidor_data(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
        WHERE em.servidor_id = v_servidor_id
          AND em.mes = v_mes_ontem
          AND em.ano = v_ano_ontem
          AND ed.dia = v_dia_ontem
          AND ed.categoria IN ('Regular', 'Plantão', 'Extra', 'Sobreaviso')
        ORDER BY start_hour ASC
    LOOP
        v_shifts_count := v_shifts_count + 1;
        
        DECLARE
            v_jornada_parsed BOOLEAN := false;
            v_jornada_end INTEGER;
            v_duration INTEGER;
            v_start_min INTEGER;
            v_end_min INTEGER;
            v_int_ini_min INTEGER;
            v_int_fim_min INTEGER;
            v_permite_int BOOLEAN;
        BEGIN
            v_start_min := r.start_hour * 60;
            
            IF r.jornada_nome IS NOT NULL AND r.categoria = 'Regular' THEN
                v_jornada_end := substring(r.jornada_nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer;
                IF v_jornada_end IS NOT NULL THEN
                    v_jornada_parsed := true;
                    IF v_jornada_end < r.start_hour THEN
                        v_end_min := (v_jornada_end + 24) * 60;
                    ELSE
                        v_end_min := v_jornada_end * 60;
                    END IF;
                END IF;
            END IF;
            
            IF NOT v_jornada_parsed THEN
                v_duration := CASE 
                    WHEN r.categoria = 'Regular' AND r.horas_totais IS NOT NULL AND r.horas_totais > 0 THEN r.horas_totais 
                    ELSE COALESCE(r.horas_computadas, 0) 
                END;
                v_end_min := v_start_min + (v_duration * 60);
            END IF;

            -- GUARD RESTAURADO (regressao de 20260804080000). NAO REMOVER.
            -- Jornadas de ate 6h nao possuem intervalo intrajornada (CLT Art. 71).
            v_permite_int := COALESCE(r.permite_marca_intervalo, false)
                AND public.fn_jornada_tem_intervalo(v_end_min - v_start_min, r.intervalo_minutos);
            IF v_permite_int THEN
                v_int_ini_min := CASE
                    WHEN r.intervalo_inicio_personalizado IS NOT NULL THEN
                        extract(hour from r.intervalo_inicio_personalizado)::integer * 60 + extract(minute from r.intervalo_inicio_personalizado)::integer
                    WHEN r.intervalo_inicio_padrao IS NOT NULL THEN
                        extract(hour from r.intervalo_inicio_padrao)::integer * 60 + extract(minute from r.intervalo_inicio_padrao)::integer
                    ELSE
                        v_start_min + 240
                END;

                v_int_fim_min := CASE
                    WHEN r.intervalo_fim_personalizado IS NOT NULL THEN
                        extract(hour from r.intervalo_fim_personalizado)::integer * 60 + extract(minute from r.intervalo_fim_personalizado)::integer
                    WHEN r.intervalo_fim_padrao IS NOT NULL THEN
                        extract(hour from r.intervalo_fim_padrao)::integer * 60 + extract(minute from r.intervalo_fim_padrao)::integer
                    ELSE
                        v_int_ini_min + COALESCE(r.intervalo_minutos, 60)
                END;
            END IF;

            IF v_shifts_count = 1 THEN
                v_s1_id := r.escala_diaria_id; v_s1_inicio := v_start_min; v_s1_fim := v_end_min; v_s1_entrada := r.presenca_entrada_em; v_s1_int_saida := r.presenca_intervalo_saida_em; v_s1_int_retorno := r.presenca_intervalo_retorno_em; v_s1_saida := r.presenca_saida_em; v_s1_cat := r.categoria; v_s1_int_ini_min := v_int_ini_min; v_s1_int_fim_min := v_int_fim_min; v_s1_permite_int := v_permite_int;
            ELSIF v_shifts_count = 2 THEN
                v_s2_id := r.escala_diaria_id; v_s2_inicio := v_start_min; v_s2_fim := v_end_min; v_s2_entrada := r.presenca_entrada_em; v_s2_int_saida := r.presenca_intervalo_saida_em; v_s2_int_retorno := r.presenca_intervalo_retorno_em; v_s2_saida := r.presenca_saida_em; v_s2_cat := r.categoria; v_s2_int_ini_min := v_int_ini_min; v_s2_int_fim_min := v_int_fim_min; v_s2_permite_int := v_permite_int;
            ELSIF v_shifts_count = 3 THEN
                v_s3_id := r.escala_diaria_id; v_s3_inicio := v_start_min; v_s3_fim := v_end_min; v_s3_entrada := r.presenca_entrada_em; v_s3_int_saida := r.presenca_intervalo_saida_em; v_s3_int_retorno := r.presenca_intervalo_retorno_em; v_s3_saida := r.presenca_saida_em; v_s3_cat := r.categoria; v_s3_int_ini_min := v_int_ini_min; v_s3_int_fim_min := v_int_fim_min; v_s3_permite_int := v_permite_int;
            END IF;
        END;
    END LOOP;

    IF v_shifts_count > 0 THEN
        IF v_shifts_count = 1 THEN
            v_blocks_count := 1;
            v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
        ELSIF v_shifts_count = 2 THEN
            IF v_s2_inicio <= v_s1_fim
               AND v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso' THEN
                v_blocks_count := 1;
                v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
                v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
                v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min); v_b1_int_fim := COALESCE(v_s1_int_fim_min, v_s2_int_fim_min); v_b1_permite_int := COALESCE(v_s1_permite_int, v_s2_permite_int, false);
            ELSE
                v_blocks_count := 2;
                v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
                v_b2_inicio := v_s2_inicio; v_b2_fim := v_s2_fim; v_b2_ids := ARRAY[v_s2_id]; v_b2_entradas := ARRAY[v_s2_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida]; v_b2_cat := v_s2_cat; v_b2_int_ini := v_s2_int_ini_min; v_b2_int_fim := v_s2_int_fim_min; v_b2_permite_int := v_s2_permite_int;
            END IF;
        ELSIF v_shifts_count >= 3 THEN
            IF v_s2_inicio <= v_s1_fim
               AND v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso' THEN
                v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
                v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
                v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min); v_b1_int_fim := COALESCE(v_s1_int_fim_min, v_s2_int_fim_min); v_b1_permite_int := COALESCE(v_s1_permite_int, v_s2_permite_int, false);
                
                IF v_s3_inicio <= v_b1_fim AND v_s3_cat <> 'Sobreaviso' THEN
                    v_blocks_count := 1;
                    v_b1_fim := GREATEST(v_b1_fim, v_s3_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id, v_s3_id]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada, v_s3_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida, v_s3_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno, v_s3_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida, v_s3_saida];
                    v_b1_cat := CASE WHEN v_s3_cat IN ('Regular', 'Plantão') THEN v_s3_cat ELSE v_b1_cat END;
                ELSE
                    v_blocks_count := 2;
                    v_b2_inicio := v_s3_inicio; v_b2_fim := v_s3_fim; v_b2_ids := ARRAY[v_s3_id]; v_b2_entradas := ARRAY[v_s3_entrada]; v_b2_int_saidas := ARRAY[v_s3_int_saida]; v_b2_int_retornos := ARRAY[v_s3_int_retorno]; v_b2_saidas := ARRAY[v_s3_saida]; v_b2_cat := v_s3_cat; v_b2_int_ini := v_s3_int_ini_min; v_b2_int_fim := v_s3_int_fim_min; v_b2_permite_int := v_s3_permite_int;
                END IF;
            ELSE
                v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
                
                IF v_s3_inicio <= v_s2_fim
                   AND v_s2_cat <> 'Sobreaviso' AND v_s3_cat <> 'Sobreaviso' THEN
                    v_blocks_count := 2;
                    v_b2_inicio := v_s2_inicio; v_b2_fim := GREATEST(v_s2_fim, v_s3_fim); v_b2_ids := ARRAY[v_s2_id, v_s3_id]; v_b2_entradas := ARRAY[v_s2_entrada, v_s3_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida, v_s3_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno, v_s3_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida, v_s3_saida];
                    v_b2_cat := CASE WHEN v_s2_cat IN ('Regular', 'Plantão') THEN v_s2_cat ELSE v_s3_cat END;
                    v_b2_int_ini := COALESCE(v_s2_int_ini_min, v_s3_int_ini_min); v_b2_int_fim := COALESCE(v_s2_int_fim_min, v_s3_int_fim_min); v_b2_permite_int := COALESCE(v_s2_permite_int, v_s3_permite_int, false);
                ELSE
                    v_blocks_count := 3;
                    v_b2_inicio := v_s2_inicio; v_b2_fim := v_s2_fim; v_b2_ids := ARRAY[v_s2_id]; v_b2_entradas := ARRAY[v_s2_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida]; v_b2_cat := v_s2_cat; v_b2_int_ini := v_s2_int_ini_min; v_b2_int_fim := v_s2_int_fim_min; v_b2_permite_int := v_s2_permite_int;
                    v_b3_inicio := v_s3_inicio; v_b3_fim := v_s3_fim; v_b3_ids := ARRAY[v_s3_id]; v_b3_entradas := ARRAY[v_s3_entrada]; v_b3_int_saidas := ARRAY[v_s3_int_saida]; v_b3_int_retornos := ARRAY[v_s3_int_retorno]; v_b3_saidas := ARRAY[v_s3_saida]; v_b3_cat := v_s3_cat; v_b3_int_ini := v_s3_int_ini_min; v_b3_int_fim := v_s3_int_fim_min; v_b3_permite_int := v_s3_permite_int;
                END IF;
            END IF;
        END IF;

        -- Check yesterday's blocks for early morning checkout
        DECLARE
            idx INTEGER;
            v_b_inicio INTEGER; v_b_fim INTEGER; v_b_ids UUID[]; v_b_entradas TIMESTAMP WITH TIME ZONE[]; v_b_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b_saidas TIMESTAMP WITH TIME ZONE[]; v_b_cat TEXT; v_b_int_ini INTEGER; v_b_int_fim INTEGER; v_b_permite_int BOOLEAN;
            v_b_total_count INTEGER;
        BEGIN
            FOR idx IN 1..v_blocks_count LOOP
                IF idx = 1 THEN
                    v_b_inicio := v_b1_inicio; v_b_fim := v_b1_fim; v_b_ids := v_b1_ids; v_b_entradas := v_b1_entradas; v_b_int_saidas := v_b1_int_saidas; v_b_int_retornos := v_b1_int_retornos; v_b_saidas := v_b1_saidas; v_b_cat := v_b1_cat; v_b_int_ini := v_b1_int_ini; v_b_int_fim := v_b1_int_fim; v_b_permite_int := v_b1_permite_int;
                ELSIF idx = 2 THEN
                    v_b_inicio := v_b2_inicio; v_b_fim := v_b2_fim; v_b_ids := v_b2_ids; v_b_entradas := v_b2_entradas; v_b_int_saidas := v_b2_int_saidas; v_b_int_retornos := v_b2_int_retornos; v_b_saidas := v_b2_saidas; v_b_cat := v_b2_cat; v_b_int_ini := v_b2_int_ini; v_b_int_fim := v_b2_int_fim; v_b_permite_int := v_b2_permite_int;
                ELSE
                    v_b_inicio := v_b3_inicio; v_b_fim := v_b3_fim; v_b_ids := v_b3_ids; v_b_entradas := v_b3_entradas; v_b_int_saidas := v_b3_int_saidas; v_b_int_retornos := v_b3_int_retornos; v_b_saidas := v_b3_saidas; v_b_cat := v_b3_cat; v_b_int_ini := v_b3_int_ini; v_b_int_fim := v_b3_int_fim; v_b_permite_int := v_b3_permite_int;
                END IF;

                v_b_total_count := array_length(v_b_ids, 1);

                IF v_b_fim > 1440 THEN
                    IF v_b_entradas[1] IS NOT NULL AND v_b_saidas[v_b_total_count] IS NULL THEN
                        IF v_ignora_janela OR (
                           (v_momento_atual_minutos + 1440) >= (v_b_fim - v_janela_minutos) AND
                           (v_momento_atual_minutos + 1440) <= (v_b_fim + v_janela_minutos)
                        ) THEN
                            PERFORM public.fn_salvar_saida_bloco(v_b_ids, v_now, p_coordenador_id, v_timezone, false);

                            SELECT escala_mensal_id INTO v_escala_mensal_id FROM public.escala_diaria WHERE id = v_b_ids[1];
                            SELECT unidade_id INTO v_unidade_id FROM public.escala_mensal WHERE id = v_escala_mensal_id;

                            IF v_b_cat = 'Sobreaviso' THEN
                                UPDATE public.logs_sobreaviso
                                SET status = 'Chegou',
                                    data_hora_chegada = v_now,
                                    tipo_validacao_chegada = 'Terminal'
                                WHERE servidor_id = v_servidor_id 
                                  AND escala_mensal_id = v_escala_mensal_id 
                                  AND dia = v_dia_ontem 
                                  AND status IN ('Aguardando', 'Aceito');

                                IF NOT FOUND THEN
                                    INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_chegada, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada, categoria)
                                    VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_ontem, v_now, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (SAÍDA) via terminal.', 'Terminal', 'Sobreaviso');
                                END IF;
                            END IF;

                            RETURN jsonb_build_object('success', true, 'message', 'Saída do plantão de ontem confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom descanso!');
                        END IF;
                    END IF;
                END IF;
            END LOOP;
        END;
    END IF;

    -- Process today's shifts
    v_s1_id := NULL; v_s2_id := NULL; v_s3_id := NULL;
    v_b1_ids := '{}'; v_b2_ids := '{}'; v_b3_ids := '{}';
    v_shifts_count := 0;

    FOR r IN 
        SELECT 
            ed.id as escala_diaria_id, 
            ed.presenca_entrada_em, 
            ed.presenca_intervalo_saida_em,
            ed.presenca_intervalo_retorno_em,
            ed.presenca_saida_em, 
            ed.categoria::text as categoria,
            dt.horas_computadas, 
            j.nome as jornada_nome, 
            j.horas_totais,
            COALESCE(j.intervalo_minutos, 60) as intervalo_minutos,
            j.intervalo_inicio_padrao,
            j.intervalo_fim_padrao,
            s.intervalo_inicio_personalizado,
            s.intervalo_fim_personalizado,
            COALESCE(u.permite_marca_intervalo, false) as permite_marca_intervalo,
            COALESCE(
                CASE WHEN ed.categoria = 'Regular' THEN
                    COALESCE(
                        CASE 
                          WHEN j.nome IS NOT NULL AND substring(j.nome from '^([0-9]+)')::integer IS NOT NULL THEN
                              substring(j.nome from '^([0-9]+)')::integer
                          ELSE NULL
                        END,
                        CASE 
                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer

                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer IS NOT NULL AND
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 11 AND 14
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
                          
                          ELSE NULL
                        END,
                        CASE 
                          WHEN dt.codigo = 'T4' THEN 14
                          WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer
                          WHEN dt.slots[1] = 'M' THEN 7
                          WHEN dt.slots[1] = 'T' THEN 13
                          WHEN dt.slots[1] = 'N' THEN 19
                          ELSE 7
                        END
                    )
                ELSE NULL END,
                CASE WHEN ed.categoria = 'Plantão' THEN
                    COALESCE(
                        CASE 
                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                          WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                          WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer

                          WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer IS NOT NULL AND
                               (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 11 AND 14
                          THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                          WHEN j.nome IS NOT NULL AND substring(j.nome from '^([0-9]+)')::integer IS NOT NULL THEN
                              substring(j.nome from '^([0-9]+)')::integer
                          
                          ELSE NULL
                        END,
                        CASE 
                          WHEN dt.codigo = 'T4' THEN 14
                          WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer
                          WHEN dt.slots[1] = 'M' THEN 7
                          WHEN dt.slots[1] = 'T' THEN 13
                          WHEN dt.slots[1] = 'N' THEN 19
                          ELSE 7
                        END
                    )
                ELSE NULL END,
                (
                    SELECT 
                        COALESCE(
                            (
                                SELECT 
                                    CASE 
                                        WHEN substring(j2.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer < substring(j2.nome from '^([0-9]+)')::integer THEN
                                            substring(j2.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer + 24
                                        ELSE
                                            substring(j2.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer
                                    END
                                FROM public.escala_diaria ed2
                                JOIN public.escala_mensal em2 ON ed2.escala_mensal_id = em2.id
                                JOIN public.jornadas j2 ON j2.id = public.obter_jornada_servidor_data(em2.servidor_id, MAKE_DATE(em2.ano, em2.mes, ed2.dia), em2.jornada_id)
                                WHERE em2.id = em.id
                                   AND ed2.dia = ed.dia
                                   AND ed2.categoria = 'Regular'
                                LIMIT 1
                            ),
                            (
                                SELECT 
                                    CASE 
                                        WHEN dt2.slots[1] = 'M' THEN 13
                                        WHEN dt2.slots[1] = 'T' THEN 19
                                        WHEN dt2.slots[1] = 'N' THEN 7 + 24
                                        WHEN dt2.slots[1] ~ '^[0-9]+$' THEN 
                                            CASE 
                                                WHEN (dt2.slots[1]::integer + dt2.horas_computadas::integer) >= 24 THEN
                                                    dt2.slots[1]::integer + dt2.horas_computadas::integer
                                                WHEN (dt2.slots[1]::integer + dt2.horas_computadas::integer) < dt2.slots[1]::integer THEN
                                                    dt2.slots[1]::integer + dt2.horas_computadas::integer + 24
                                                ELSE
                                                    dt2.slots[1]::integer + dt2.horas_computadas::integer
                                            END
                                        ELSE 19
                                    END
                                FROM public.escala_diaria ed2
                                JOIN public.dicionario_turnos dt2 ON ed2.dicionario_turnos_id = dt2.id
                                WHERE ed2.escala_mensal_id = em.id
                                   AND ed2.dia = ed.dia
                                   AND ed2.categoria = 'Plantão'
                                LIMIT 1
                            )
                        )
                ),
                CASE 
                  WHEN dt.codigo = 'T4' THEN 14
                  WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer
                  WHEN dt.slots[1] = 'M' THEN 7
                  WHEN dt.slots[1] = 'T' THEN 13
                  WHEN dt.slots[1] = 'N' THEN 19
                  ELSE 7
                END
            ) as start_hour
        FROM public.escala_diaria ed
        JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
        JOIN public.servidores s ON em.servidor_id = s.id
        JOIN public.unidades u ON em.unidade_id = u.id
        JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
        LEFT JOIN public.jornadas j ON j.id = public.obter_jornada_servidor_data(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
        WHERE em.servidor_id = v_servidor_id
          AND em.mes = v_mes
          AND em.ano = v_ano
          AND ed.dia = v_dia_hoje
          AND ed.categoria IN ('Regular', 'Plantão', 'Extra', 'Sobreaviso')
        ORDER BY start_hour ASC
    LOOP
        v_shifts_count := v_shifts_count + 1;
        
        DECLARE
            v_jornada_parsed BOOLEAN := false;
            v_jornada_end INTEGER;
            v_duration INTEGER;
            v_start_min INTEGER;
            v_end_min INTEGER;
            v_int_ini_min INTEGER;
            v_int_fim_min INTEGER;
            v_permite_int BOOLEAN;
        BEGIN
            v_start_min := r.start_hour * 60;
            
            IF r.jornada_nome IS NOT NULL AND r.categoria = 'Regular' THEN
                v_jornada_end := substring(r.jornada_nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer;
                IF v_jornada_end IS NOT NULL THEN
                    v_jornada_parsed := true;
                    IF v_jornada_end < r.start_hour THEN
                        v_end_min := (v_jornada_end + 24) * 60;
                    ELSE
                        v_end_min := v_jornada_end * 60;
                    END IF;
                END IF;
            END IF;
            
            IF NOT v_jornada_parsed THEN
                v_duration := CASE 
                    WHEN r.categoria = 'Regular' AND r.horas_totais IS NOT NULL AND r.horas_totais > 0 THEN r.horas_totais 
                    ELSE COALESCE(r.horas_computadas, 0) 
                END;
                v_end_min := v_start_min + (v_duration * 60);
            END IF;

            -- GUARD RESTAURADO (regressao de 20260804080000). NAO REMOVER.
            -- Jornadas de ate 6h nao possuem intervalo intrajornada (CLT Art. 71).
            v_permite_int := COALESCE(r.permite_marca_intervalo, false)
                AND public.fn_jornada_tem_intervalo(v_end_min - v_start_min, r.intervalo_minutos);
            IF v_permite_int THEN
                v_int_ini_min := CASE
                    WHEN r.intervalo_inicio_personalizado IS NOT NULL THEN
                        extract(hour from r.intervalo_inicio_personalizado)::integer * 60 + extract(minute from r.intervalo_inicio_personalizado)::integer
                    WHEN r.intervalo_inicio_padrao IS NOT NULL THEN
                        extract(hour from r.intervalo_inicio_padrao)::integer * 60 + extract(minute from r.intervalo_inicio_padrao)::integer
                    ELSE
                        v_start_min + 240
                END;

                v_int_fim_min := CASE
                    WHEN r.intervalo_fim_personalizado IS NOT NULL THEN
                        extract(hour from r.intervalo_fim_personalizado)::integer * 60 + extract(minute from r.intervalo_fim_personalizado)::integer
                    WHEN r.intervalo_fim_padrao IS NOT NULL THEN
                        extract(hour from r.intervalo_fim_padrao)::integer * 60 + extract(minute from r.intervalo_fim_padrao)::integer
                    ELSE
                        v_int_ini_min + COALESCE(r.intervalo_minutos, 60)
                END;
            END IF;

            IF v_shifts_count = 1 THEN
                v_s1_id := r.escala_diaria_id; v_s1_inicio := v_start_min; v_s1_fim := v_end_min; v_s1_entrada := r.presenca_entrada_em; v_s1_int_saida := r.presenca_intervalo_saida_em; v_s1_int_retorno := r.presenca_intervalo_retorno_em; v_s1_saida := r.presenca_saida_em; v_s1_cat := r.categoria; v_s1_int_ini_min := v_int_ini_min; v_s1_int_fim_min := v_int_fim_min; v_s1_permite_int := v_permite_int;
            ELSIF v_shifts_count = 2 THEN
                v_s2_id := r.escala_diaria_id; v_s2_inicio := v_start_min; v_s2_fim := v_end_min; v_s2_entrada := r.presenca_entrada_em; v_s2_int_saida := r.presenca_intervalo_saida_em; v_s2_int_retorno := r.presenca_intervalo_retorno_em; v_s2_saida := r.presenca_saida_em; v_s2_cat := r.categoria; v_s2_int_ini_min := v_int_ini_min; v_s2_int_fim_min := v_int_fim_min; v_s2_permite_int := v_permite_int;
            ELSIF v_shifts_count = 3 THEN
                v_s3_id := r.escala_diaria_id; v_s3_inicio := v_start_min; v_s3_fim := v_end_min; v_s3_entrada := r.presenca_entrada_em; v_s3_int_saida := r.presenca_intervalo_saida_em; v_s3_int_retorno := r.presenca_intervalo_retorno_em; v_s3_saida := r.presenca_saida_em; v_s3_cat := r.categoria; v_s3_int_ini_min := v_int_ini_min; v_s3_int_fim_min := v_int_fim_min; v_s3_permite_int := v_permite_int;
            END IF;
        END;
    END LOOP;

    IF v_shifts_count = 0 THEN
        PERFORM public.fn_log_tentativa_negada(
            v_servidor_id, 
            p_matricula, 
            p_coordenador_id, 
            'Sem escala agendada para hoje.', 
            NULL, NULL, NULL, NULL, NULL, NULL, NULL
        );
        RETURN jsonb_build_object('success', false, 'message', 'Sem escala agendada para hoje.');
    END IF;

    -- Merge today's shifts into blocks
    IF v_shifts_count = 1 THEN
        v_blocks_count := 1;
        v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
    ELSIF v_shifts_count = 2 THEN
        IF v_s2_inicio <= v_s1_fim
               AND v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso' THEN
            v_blocks_count := 1;
            v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
            v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
            v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min); v_b1_int_fim := COALESCE(v_s1_int_fim_min, v_s2_int_fim_min); v_b1_permite_int := COALESCE(v_s1_permite_int, v_s2_permite_int, false);
        ELSE
            v_blocks_count := 2;
            v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
            v_b2_inicio := v_s2_inicio; v_b2_fim := v_s2_fim; v_b2_ids := ARRAY[v_s2_id]; v_b2_entradas := ARRAY[v_s2_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida]; v_b2_cat := v_s2_cat; v_b2_int_ini := v_s2_int_ini_min; v_b2_int_fim := v_s2_int_fim_min; v_b2_permite_int := v_s2_permite_int;
        END IF;
    ELSIF v_shifts_count >= 3 THEN
        IF v_s2_inicio <= v_s1_fim
               AND v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso' THEN
            v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
            v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
            v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min); v_b1_int_fim := COALESCE(v_s1_int_fim_min, v_s2_int_fim_min); v_b1_permite_int := COALESCE(v_s1_permite_int, v_s2_permite_int, false);
            
            IF v_s3_inicio <= v_b1_fim AND v_s3_cat <> 'Sobreaviso' THEN
                v_blocks_count := 1;
                v_b1_fim := GREATEST(v_b1_fim, v_s3_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id, v_s3_id]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada, v_s3_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida, v_s3_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno, v_s3_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida, v_s3_saida];
                v_b1_cat := CASE WHEN v_s3_cat IN ('Regular', 'Plantão') THEN v_s3_cat ELSE v_b1_cat END;
            ELSE
                v_blocks_count := 2;
                v_b2_inicio := v_s3_inicio; v_b2_fim := v_s3_fim; v_b2_ids := ARRAY[v_s3_id]; v_b2_entradas := ARRAY[v_s3_entrada]; v_b2_int_saidas := ARRAY[v_s3_int_saida]; v_b2_int_retornos := ARRAY[v_s3_int_retorno]; v_b2_saidas := ARRAY[v_s3_saida]; v_b2_cat := v_s3_cat; v_b2_int_ini := v_s3_int_ini_min; v_b2_int_fim := v_s3_int_fim_min; v_b2_permite_int := v_s3_permite_int;
            END IF;
        ELSE
            v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
            
            IF v_s3_inicio <= v_s2_fim
                   AND v_s2_cat <> 'Sobreaviso' AND v_s3_cat <> 'Sobreaviso' THEN
                v_blocks_count := 2;
                v_b2_inicio := v_s2_inicio; v_b2_fim := GREATEST(v_s2_fim, v_s3_fim); v_b2_ids := ARRAY[v_s2_id, v_s3_id]; v_b2_entradas := ARRAY[v_s2_entrada, v_s3_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida, v_s3_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno, v_s3_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida, v_s3_saida];
                v_b2_cat := CASE WHEN v_s2_cat IN ('Regular', 'Plantão') THEN v_s2_cat ELSE v_s3_cat END;
                v_b2_int_ini := COALESCE(v_s2_int_ini_min, v_s3_int_ini_min); v_b2_int_fim := COALESCE(v_s2_int_fim_min, v_s3_int_fim_min); v_b2_permite_int := COALESCE(v_s2_permite_int, v_s3_permite_int, false);
            ELSE
                v_blocks_count := 3;
                v_b2_inicio := v_s2_inicio; v_b2_fim := v_s2_fim; v_b2_ids := ARRAY[v_s2_id]; v_b2_entradas := ARRAY[v_s2_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida]; v_b2_cat := v_s2_cat; v_b2_int_ini := v_s2_int_ini_min; v_b2_int_fim := v_s2_int_fim_min; v_b2_permite_int := v_s2_permite_int;
                v_b3_inicio := v_s3_inicio; v_b3_fim := v_s3_fim; v_b3_ids := ARRAY[v_s3_id]; v_b3_entradas := ARRAY[v_s3_entrada]; v_b3_int_saidas := ARRAY[v_s3_int_saida]; v_b3_int_retornos := ARRAY[v_s3_int_retorno]; v_b3_saidas := ARRAY[v_s3_saida]; v_b3_cat := v_s3_cat; v_b3_int_ini := v_s3_int_ini_min; v_b3_int_fim := v_s3_int_fim_min; v_b3_permite_int := v_s3_permite_int;
            END IF;
        END IF;
    END IF;

    -- Evaluate blocks for checkin, interval exit, interval return, or checkout
    DECLARE
        idx INTEGER;
        v_b_inicio INTEGER; v_b_fim INTEGER; v_b_ids UUID[]; v_b_entradas TIMESTAMP WITH TIME ZONE[]; v_b_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b_saidas TIMESTAMP WITH TIME ZONE[]; v_b_cat TEXT; v_b_int_ini INTEGER; v_b_int_fim INTEGER; v_b_permite_int BOOLEAN;
        v_b_total_count INTEGER;
        
        v_matched_action TEXT := NULL;
        v_matched_ids UUID[] := '{}';
        v_matched_cat TEXT := NULL;
        v_closest_inicio_formatted TEXT := NULL;
        v_closest_fim_formatted TEXT := NULL;
    BEGIN
        FOR idx IN 1..v_blocks_count LOOP
            IF idx = 1 THEN
                v_b_inicio := v_b1_inicio; v_b_fim := v_b1_fim; v_b_ids := v_b1_ids; v_b_entradas := v_b1_entradas; v_b_int_saidas := v_b1_int_saidas; v_b_int_retornos := v_b1_int_retornos; v_b_saidas := v_b1_saidas; v_b_cat := v_b1_cat; v_b_int_ini := v_b1_int_ini; v_b_int_fim := v_b1_int_fim; v_b_permite_int := v_b1_permite_int;
            ELSIF idx = 2 THEN
                v_b_inicio := v_b2_inicio; v_b_fim := v_b2_fim; v_b_ids := v_b2_ids; v_b_entradas := v_b2_entradas; v_b_int_saidas := v_b2_int_saidas; v_b_int_retornos := v_b2_int_retornos; v_b_saidas := v_b2_saidas; v_b_cat := v_b2_cat; v_b_int_ini := v_b2_int_ini; v_b_int_fim := v_b2_int_fim; v_b_permite_int := v_b2_permite_int;
            ELSE
                v_b_inicio := v_b3_inicio; v_b_fim := v_b3_fim; v_b_ids := v_b3_ids; v_b_entradas := v_b3_entradas; v_b_int_saidas := v_b3_int_saidas; v_b_int_retornos := v_b3_int_retornos; v_b_saidas := v_b3_saidas; v_b_cat := v_b3_cat; v_b_int_ini := v_b3_int_ini; v_b_int_fim := v_b3_int_fim; v_b_permite_int := v_b3_permite_int;
            END IF;

            v_b_total_count := array_length(v_b_ids, 1);

            -- Step 1: Checkin (first shift entry is NULL and tap matches 1st period start)
            IF v_b_entradas[1] IS NULL THEN
                v_closest_inicio_formatted := lpad((v_b_inicio / 60)::text, 2, '0') || ':' || lpad((v_b_inicio % 60)::text, 2, '0');
                
                IF v_ignora_janela OR (
                   v_momento_atual_minutos >= (v_b_inicio - v_janela_minutos) AND 
                   v_momento_atual_minutos <= (v_b_inicio + v_janela_minutos)
                ) THEN
                    v_matched_action := 'checkin';
                    v_matched_ids := v_b_ids;
                    v_matched_cat := v_b_cat;
                    EXIT;
                END IF;
            END IF;

            -- Step 2: Interval Exit (Saída Almoço)
            IF v_b_permite_int AND v_b_int_saidas[1] IS NULL AND v_b_int_ini IS NOT NULL THEN
                IF v_ignora_janela OR (
                   v_momento_atual_minutos >= (v_b_int_ini - v_janela_minutos) AND 
                   v_momento_atual_minutos <= (v_b_int_ini + v_janela_minutos)
                ) THEN
                    v_matched_action := 'intervalo_saida';
                    v_matched_ids := v_b_ids;
                    v_matched_cat := v_b_cat;
                    EXIT;
                END IF;
            END IF;

            -- Step 3: Interval Return / 2nd Period Checkin (Retorno Almoço / Entrada Tarde)
            IF v_b_permite_int AND v_b_int_retornos[1] IS NULL AND v_b_int_fim IS NOT NULL THEN
                IF v_ignora_janela OR (
                   v_momento_atual_minutos >= (v_b_int_fim - v_janela_minutos) AND 
                   v_momento_atual_minutos <= (v_b_int_fim + v_janela_minutos)
                ) THEN
                    v_matched_action := 'intervalo_retorno';
                    v_matched_ids := v_b_ids;
                    v_matched_cat := v_b_cat;
                    EXIT;
                END IF;
            END IF;

            -- Step 4: Checkout (last shift exit is NULL and tap matches final exit time)
            IF v_b_saidas[v_b_total_count] IS NULL THEN
                v_closest_fim_formatted := lpad(((v_b_fim % 1440) / 60)::text, 2, '0') || ':' || lpad((v_b_fim % 60)::text, 2, '0');

                IF v_ignora_janela OR (
                   v_momento_atual_minutos >= (v_b_fim - v_janela_minutos) AND 
                   v_momento_atual_minutos <= (v_b_fim + v_janela_minutos)
                ) THEN
                    v_matched_action := 'checkout';
                    v_matched_ids := v_b_ids;
                    v_matched_cat := v_b_cat;
                    EXIT;
                END IF;
            END IF;
        END LOOP;

        -- Fallback: If no exact window matched and free checkin applies (ignora_janela)
        IF v_matched_action IS NULL THEN
            FOR idx IN 1..v_blocks_count LOOP
                IF idx = 1 THEN
                    v_b_inicio := v_b1_inicio; v_b_fim := v_b1_fim; v_b_ids := v_b1_ids; v_b_entradas := v_b1_entradas; v_b_saidas := v_b1_saidas; v_b_cat := v_b1_cat;
                ELSIF idx = 2 THEN
                    v_b_inicio := v_b2_inicio; v_b_fim := v_b2_fim; v_b_ids := v_b2_ids; v_b_entradas := v_b2_entradas; v_b_saidas := v_b2_saidas; v_b_cat := v_b2_cat;
                ELSE
                    v_b_inicio := v_b3_inicio; v_b_fim := v_b3_fim; v_b_ids := v_b3_ids; v_b_entradas := v_b3_entradas; v_b_saidas := v_b3_saidas; v_b_cat := v_b3_cat;
                END IF;

                v_b_total_count := array_length(v_b_ids, 1);

                IF v_b_entradas[1] IS NULL THEN
                    IF v_ignora_janela THEN
                        v_matched_action := 'checkin';
                        v_matched_ids := v_b_ids;
                        v_matched_cat := v_b_cat;
                        EXIT;
                    END IF;
                ELSIF v_b_saidas[v_b_total_count] IS NULL THEN
                    IF v_ignora_janela THEN
                        v_matched_action := 'checkout';
                        v_matched_ids := v_b_ids;
                        v_matched_cat := v_b_cat;
                        EXIT;
                    END IF;
                END IF;
            END LOOP;
        END IF;

        IF v_matched_action IS NULL THEN
            PERFORM public.fn_log_tentativa_negada(
                v_servidor_id, 
                p_matricula, 
                p_coordenador_id, 
                'Fora da janela de presença permitida.', 
                v_closest_inicio_formatted, v_closest_fim_formatted, NULL, NULL, NULL, NULL, NULL
            );
            RETURN jsonb_build_object('success', false, 'message', 'Fora da janela de presença permitida.');
        END IF;

        -- Process the matched action
        IF v_matched_action = 'checkin' THEN
            SELECT escala_mensal_id INTO v_escala_mensal_id FROM public.escala_diaria WHERE id = v_matched_ids[1];
            SELECT unidade_id INTO v_unidade_id FROM public.escala_mensal WHERE id = v_escala_mensal_id;

            UPDATE public.escala_diaria 
            SET presenca_entrada_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id 
            WHERE id = ANY(v_matched_ids);
            
            IF v_matched_cat = 'Sobreaviso' THEN
                UPDATE public.logs_sobreaviso
                SET status = 'Chegou',
                    data_hora_chegada = v_now,
                    tipo_validacao_chegada = 'Terminal'
                WHERE servidor_id = v_servidor_id 
                  AND escala_mensal_id = v_escala_mensal_id 
                  AND dia = v_dia_hoje 
                  AND status IN ('Aguardando', 'Aceito');

                IF NOT FOUND THEN
                    INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_chegada, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada, categoria)
                    VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_hoje, v_now, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (ENTRADA) via terminal.', 'Terminal', 'Sobreaviso');
                END IF;
            END IF;
            
            RETURN jsonb_build_object('success', true, 'message', 'Entrada confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom plantão!');

        ELSIF v_matched_action = 'intervalo_saida' THEN
            UPDATE public.escala_diaria
            SET presenca_intervalo_saida_em = v_now, confirmado_por_id = p_coordenador_id
            WHERE id = ANY(v_matched_ids);

            RETURN jsonb_build_object('success', true, 'message', 'Saída para o intervalo confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom almoço!');

        ELSIF v_matched_action = 'intervalo_retorno' THEN
            UPDATE public.escala_diaria
            SET presenca_intervalo_retorno_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id
            WHERE id = ANY(v_matched_ids);

            RETURN jsonb_build_object('success', true, 'message', 'Retorno do intervalo / Entrada do 2º Período confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom trabalho!');
            
        ELSIF v_matched_action = 'checkout' THEN
            SELECT escala_mensal_id INTO v_escala_mensal_id FROM public.escala_diaria WHERE id = v_matched_ids[1];
            SELECT unidade_id INTO v_unidade_id FROM public.escala_mensal WHERE id = v_escala_mensal_id;

            PERFORM public.fn_salvar_saida_bloco(v_matched_ids, v_now, p_coordenador_id, v_timezone, false);
            
            IF v_matched_cat = 'Sobreaviso' THEN
                UPDATE public.logs_sobreaviso
                SET status = 'Chegou',
                    data_hora_chegada = v_now,
                    tipo_validacao_chegada = 'Terminal'
                WHERE servidor_id = v_servidor_id 
                  AND escala_mensal_id = v_escala_mensal_id 
                  AND dia = v_dia_hoje 
                  AND status IN ('Aguardando', 'Aceito');

                IF NOT FOUND THEN
                    INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_chegada, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada, categoria)
                    VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_hoje, v_now, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (SAÍDA) via terminal.', 'Terminal', 'Sobreaviso');
                END IF;
            END IF;
            
            RETURN jsonb_build_object('success', true, 'message', 'Saída confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom descanso!');
        END IF;
    END;

EXCEPTION WHEN OTHERS THEN
    PERFORM public.fn_log_tentativa_negada(
        v_servidor_id, 
        p_matricula, 
        p_coordenador_id, 
        SQLERRM, 
        NULL, NULL, NULL, NULL, NULL, NULL, NULL
    );
    RETURN jsonb_build_object('success', false, 'message', 'Erro interno ao processar confirmação de presença: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 2. RECREATE fn_confirmar_presenca_manual WITH JORNADA-BASED START HOUR INHERITANCE
CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca_manual(
    p_escala_mensal_id uuid,
    p_dia integer,
    p_categoria text,
    p_tipo text,
    p_validador_id uuid,
    p_justificativa text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
    v_servidor_id UUID;
    v_unidade_id UUID;
    v_mes INTEGER;
    v_ano INTEGER;
    v_timezone TEXT;
    
    v_start_hour INTEGER;
    v_jornada_nome TEXT;
    v_horas_totais INTEGER;
    v_horas_computadas INTEGER;
    v_slots TEXT[];
    v_turno_codigo TEXT;
    v_intervalo_minutos INTEGER;
    
    v_jornada_parsed BOOLEAN := false;
    v_jornada_end INTEGER;
    v_duration INTEGER;
    
    v_start_timestamp_local TIMESTAMP;
    v_end_timestamp_local TIMESTAMP;
    v_target_timestamp TIMESTAMP WITH TIME ZONE;
    v_existing_entrada TIMESTAMP WITH TIME ZONE;
    v_existing_saida_int TIMESTAMP WITH TIME ZONE;
    v_motivo_log TEXT;
BEGIN
    -- 1. Fetch metadata from escala_mensal
    SELECT servidor_id, unidade_id, mes, ano INTO v_servidor_id, v_unidade_id, v_mes, v_ano
    FROM public.escala_mensal
    WHERE id = p_escala_mensal_id;
    
    IF v_servidor_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Escala mensal não encontrada.');
    END IF;

    -- Block future presence validation
    IF MAKE_DATE(v_ano, v_mes, p_dia) > CURRENT_DATE THEN
        RETURN jsonb_build_object('success', false, 'message', 'Não é possível validar presenças para datas futuras.');
    END IF;

    -- 2. Fetch timezone
    SELECT (valor#>>'{}')::text INTO v_timezone 
    FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    -- 3. Fetch start hour and shift parameters
    SELECT 
        dt.horas_computadas,
        dt.slots,
        j.horas_totais,
        dt.codigo as turno_codigo,
        j.nome as jornada_nome,
        COALESCE(j.intervalo_minutos, 60) as intervalo_minutos,
        COALESCE(
            CASE WHEN ed.categoria = 'Regular' THEN
                COALESCE(
                    CASE 
                      WHEN j.nome IS NOT NULL AND substring(j.nome from '^([0-9]+)')::integer IS NOT NULL THEN
                          substring(j.nome from '^([0-9]+)')::integer
                      ELSE NULL
                    END,
                    CASE 
                      WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                      WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 17 AND 20
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                      WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                      WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer

                      WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer IS NOT NULL AND
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 11 AND 14
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
                      
                      ELSE NULL
                    END,
                    CASE 
                      WHEN dt.codigo = 'T4' THEN 14
                      WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer
                      WHEN dt.slots[1] = 'M' THEN 7
                      WHEN dt.slots[1] = 'T' THEN 13
                      WHEN dt.slots[1] = 'N' THEN 19
                      ELSE 7
                    END
                )
            ELSE NULL END,
            CASE WHEN ed.categoria = 'Plantão' THEN
                COALESCE(
                    CASE 
                      WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 11 AND 15
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                      WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 17 AND 20
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                      WHEN (dt.codigo LIKE 'N%' OR dt.slots[1] = 'N') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer BETWEEN 17 AND 20
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer

                      WHEN (dt.codigo LIKE 'M%' OR dt.slots[1] = 'M') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 12 AND 15
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer - dt.horas_computadas::integer

                      WHEN (dt.codigo LIKE 'T%' OR dt.slots[1] = 'T') AND 
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer IS NOT NULL AND
                           (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer BETWEEN 11 AND 14
                      THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer

                      WHEN j.nome IS NOT NULL AND substring(j.nome from '^([0-9]+)')::integer IS NOT NULL THEN
                          substring(j.nome from '^([0-9]+)')::integer
                      
                      ELSE NULL
                    END,
                    CASE 
                      WHEN dt.codigo = 'T4' THEN 14
                      WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer
                      WHEN dt.slots[1] = 'M' THEN 7
                      WHEN dt.slots[1] = 'T' THEN 13
                      WHEN dt.slots[1] = 'N' THEN 19
                      ELSE 7
                    END
                )
            ELSE NULL END,
            -- Se for Extra, busca o término do turno Regular ou Plantão do mesmo dia com tratamento de meia-noite
            (
                SELECT 
                    COALESCE(
                        (
                            SELECT 
                                CASE 
                                    WHEN substring(j2.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer < substring(j2.nome from '^([0-9]+)')::integer THEN
                                        substring(j2.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer + 24
                                    ELSE
                                        substring(j2.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer
                                END
                            FROM public.escala_diaria ed2
                            JOIN public.escala_mensal em2 ON ed2.escala_mensal_id = em2.id
                            JOIN public.jornadas j2 ON j2.id = public.obter_jornada_servidor_data(em2.servidor_id, MAKE_DATE(em2.ano, em2.mes, ed2.dia), em2.jornada_id)
                            WHERE em2.id = em.id
                               AND ed2.dia = ed.dia
                               AND ed2.categoria = 'Regular'
                            LIMIT 1
                        ),
                        (
                            SELECT 
                                CASE 
                                    WHEN dt2.slots[1] = 'M' THEN 13
                                    WHEN dt2.slots[1] = 'T' THEN 19
                                    WHEN dt2.slots[1] = 'N' THEN 7 + 24 -- N cruza a meia-noite
                                    WHEN dt2.slots[1] ~ '^[0-9]+$' THEN 
                                        CASE 
                                            WHEN (dt2.slots[1]::integer + dt2.horas_computadas::integer) >= 24 THEN
                                                dt2.slots[1]::integer + dt2.horas_computadas::integer
                                            WHEN (dt2.slots[1]::integer + dt2.horas_computadas::integer) < dt2.slots[1]::integer THEN
                                                dt2.slots[1]::integer + dt2.horas_computadas::integer + 24
                                            ELSE
                                                dt2.slots[1]::integer + dt2.horas_computadas::integer
                                        END
                                    ELSE 19
                                END
                            FROM public.escala_diaria ed2
                            JOIN public.dicionario_turnos dt2 ON ed2.dicionario_turnos_id = dt2.id
                            WHERE ed2.escala_mensal_id = em.id
                               AND ed2.dia = ed.dia
                               AND ed2.categoria = 'Plantão'
                            LIMIT 1
                        )
                    )
                FROM public.escala_diaria ed
                JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
                WHERE em.id = p_escala_mensal_id AND ed.dia = p_dia AND ed.categoria = p_categoria
                LIMIT 1
            ),
            7
        ) as start_hour
    INTO v_horas_computadas, v_slots, v_horas_totais, v_turno_codigo, v_jornada_nome, v_intervalo_minutos, v_start_hour
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
    LEFT JOIN public.jornadas j ON j.id = public.obter_jornada_servidor_data(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
    WHERE em.id = p_escala_mensal_id AND ed.dia = p_dia AND ed.categoria = p_categoria
    LIMIT 1;

    IF v_start_hour IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Registro de escala diária não encontrado.');
    END IF;

    -- Calculate scheduled start and end timestamps
    v_start_timestamp_local := MAKE_DATE(v_ano, v_mes, p_dia) + (v_start_hour || ' hours')::interval;
    
    IF v_jornada_nome IS NOT NULL AND p_categoria = 'Regular' THEN
        v_jornada_end := substring(v_jornada_nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer;
        IF v_jornada_end IS NOT NULL THEN
            v_jornada_parsed := true;
            IF v_jornada_end < v_start_hour THEN
                v_end_timestamp_local := MAKE_DATE(v_ano, v_mes, p_dia) + ( (v_jornada_end + 24) || ' hours')::interval;
            ELSE
                v_end_timestamp_local := MAKE_DATE(v_ano, v_mes, p_dia) + (v_jornada_end || ' hours')::interval;
            END IF;
        END IF;
    END IF;

    IF NOT v_jornada_parsed THEN
        v_duration := CASE 
            WHEN p_categoria = 'Regular' AND v_horas_totais IS NOT NULL AND v_horas_totais > 0 THEN v_horas_totais 
            ELSE COALESCE(v_horas_computadas, 0) 
        END;
        v_end_timestamp_local := v_start_timestamp_local + (v_duration || ' hours')::interval;
    END IF;

    -- Update presence based on scope
    IF p_tipo = 'completo' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = v_start_timestamp_local AT TIME ZONE v_timezone,
            presenca_saida_em = v_end_timestamp_local AT TIME ZONE v_timezone,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria;
        
        v_motivo_log := 'Validação Manual (Dia Completo)';

    ELSIF p_tipo = 'entrada' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = v_start_timestamp_local AT TIME ZONE v_timezone,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria;
        
        v_motivo_log := 'Validação Manual (Entrada / 1º Turno)';

    ELSIF p_tipo = 'saida' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_saida_em = v_end_timestamp_local AT TIME ZONE v_timezone,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria;
        
        v_motivo_log := 'Validação Manual (Saída / 2º Turno)';

    ELSIF p_tipo = 'periodo_1' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = v_start_timestamp_local AT TIME ZONE v_timezone,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria;
        
        v_motivo_log := 'Validação Manual (1º Período / Entrada Tarde/Noite)';

    ELSIF p_tipo = 'periodo_2' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_saida_em = v_end_timestamp_local AT TIME ZONE v_timezone,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria;
        
        v_motivo_log := 'Validação Manual (2º Período / Saída Tarde/Noite)';

    ELSIF p_tipo = 'intervalo_saida' THEN
        -- GUARD: jornadas de ate 6h nao possuem intervalo intrajornada (CLT Art. 71).
        -- Cobre tambem fn_confirmar_presenca_manual_bulk, que delega para esta funcao.
        IF NOT public.fn_jornada_tem_intervalo((COALESCE(v_horas_totais, 0) * 60)::integer, v_intervalo_minutos) THEN
            RETURN jsonb_build_object('success', false, 'message',
                'Jornada de ' || COALESCE(v_horas_totais::text, '?') || 'h nao possui intervalo intrajornada.');
        END IF;

        UPDATE public.escala_diaria
        SET presenca_intervalo_saida_em = (v_start_timestamp_local + (4 || ' hours')::interval) AT TIME ZONE v_timezone,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria;
        
        v_motivo_log := 'Validação Manual (Saída Intervalo)';

    ELSIF p_tipo = 'intervalo_retorno' THEN
        -- GUARD: jornadas de ate 6h nao possuem intervalo intrajornada (CLT Art. 71).
        IF NOT public.fn_jornada_tem_intervalo((COALESCE(v_horas_totais, 0) * 60)::integer, v_intervalo_minutos) THEN
            RETURN jsonb_build_object('success', false, 'message',
                'Jornada de ' || COALESCE(v_horas_totais::text, '?') || 'h nao possui intervalo intrajornada.');
        END IF;

        SELECT presenca_entrada_em, presenca_intervalo_saida_em INTO v_existing_entrada, v_existing_saida_int
        FROM public.escala_diaria
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria;

        v_target_timestamp := (v_start_timestamp_local + (5 || ' hours')::interval) AT TIME ZONE v_timezone;

        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = COALESCE(v_existing_entrada, (v_start_timestamp_local + (5 || ' hours')::interval) AT TIME ZONE v_timezone),
            presenca_intervalo_retorno_em = v_target_timestamp,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria;
        
        v_motivo_log := 'Validação Manual (Retorno Intervalo / Entrada 2º Período)';

    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'Tipo de presença inválido.');
    END IF;

    -- 4. Audit logging for Sobreaviso if applicable
    IF p_categoria = 'Sobreaviso' THEN
        UPDATE public.logs_sobreaviso
        SET status = 'Chegou',
            data_hora_chegada = now(),
            data_hora_validacao = now(),
            validacao_manual = true,
            validado_por = p_validador_id,
            justificativa = p_justificativa,
            tipo_validacao_chegada = 'Manual'
        WHERE servidor_id = v_servidor_id 
          AND escala_mensal_id = p_escala_mensal_id 
          AND dia = p_dia 
          AND status IN ('Aguardando', 'Aceito');

        IF NOT FOUND THEN
            INSERT INTO public.logs_sobreaviso (
                servidor_id, unidade_id, escala_mensal_id, dia, 
                data_hora_acionamento, data_hora_chegada, data_hora_validacao, 
                validacao_manual, validado_por, status, justificativa, motivo_acionamento, tipo_validacao_chegada, categoria
            ) VALUES (
                v_servidor_id, v_unidade_id, p_escala_mensal_id, p_dia, 
                now(), now(), now(), 
                true, p_validador_id, 'Chegou', p_justificativa, v_motivo_log, 'Manual', 'Sobreaviso'
            );
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'message', 'Presença confirmada manualmente com sucesso.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
