-- ============================================================================
-- Migration: as funcoes de presenca passam a resolver o intervalo pela FONTE UNICA
-- Data: 2026-08-22
--
-- Companheira obrigatoria de 20260822120000, que cria dicionario_turnos.intervalo_minutos,
-- fn_intervalo_minimo_legal e fn_intervalo_previsto_minutos. O diagnostico completo, os numeros
-- de producao e a base legal estao no cabecalho daquele arquivo - nao repetir aqui.
--
-- O QUE MUDA, EM UMA FRASE
--   Os cursores paravam de resolver o intervalo com COALESCE(j.intervalo_minutos, 60) - a
--   jornada REGULAR do servidor, aplicada a QUALQUER categoria. Agora carregam os dois cadastros
--   crus (jornada e turno) e delegam a decisao a public.fn_intervalo_previsto_minutos, que ja
--   tem em maos a DURACAO EFETIVA do turno.
--
-- ⚠️ GERADO POR scratchpad/gen_intervalo_plantao.js - NAO EDITAR A MAO.
--   As tres funcoes sao copia mecanica das versoes vigentes; o script aborta se qualquer
--   contagem de ocorrencia divergir. Para mudar qualquer coisa aqui, mude o script e regere.
--   CLAUDE.md armadilha 1: seis regressoes reais ja sairam de redigitar corpo de funcao a mao.
--
-- ⚠️ TODOS OS GUARDS EXISTENTES CONTINUAM NO LUGAR e sao conferidos pelo script:
--   os 14+ guards <> 'Sobreaviso' das fusoes de bloco, o guard de escopo de
--   fn_blocos_previstos_dia, fn_jornada_tem_intervalo, fn_ajuste_intervalo_flexivel, o piso de
--   meia-noite, a regra do dono, os slots de fronteira e o encaixe do intervalo dentro do turno.
--
-- ORIGEM DE CADA FUNCAO (nao e o mesmo arquivo para as tres)
--   fn_confirmar_presenca        <- 20260819220000
--   fn_blocos_previstos_dia      <- 20260819220000
--   fn_confirmar_presenca_manual <- 20260809000000
-- ============================================================================


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
    v_intervalo_flexivel BOOLEAN;
    
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
    v_s1_id UUID; v_s1_inicio INTEGER; v_s1_fim INTEGER; v_s1_entrada TIMESTAMP WITH TIME ZONE; v_s1_int_saida TIMESTAMP WITH TIME ZONE; v_s1_int_retorno TIMESTAMP WITH TIME ZONE; v_s1_saida TIMESTAMP WITH TIME ZONE; v_s1_cat TEXT; v_s1_int_ini_min INTEGER; v_s1_int_fim_min INTEGER; v_s1_permite_int BOOLEAN; v_s1_dobra_diurna BOOLEAN;
    v_s2_id UUID; v_s2_inicio INTEGER; v_s2_fim INTEGER; v_s2_entrada TIMESTAMP WITH TIME ZONE; v_s2_int_saida TIMESTAMP WITH TIME ZONE; v_s2_int_retorno TIMESTAMP WITH TIME ZONE; v_s2_saida TIMESTAMP WITH TIME ZONE; v_s2_cat TEXT; v_s2_int_ini_min INTEGER; v_s2_int_fim_min INTEGER; v_s2_permite_int BOOLEAN; v_s2_dobra_diurna BOOLEAN;
    v_s3_id UUID; v_s3_inicio INTEGER; v_s3_fim INTEGER; v_s3_entrada TIMESTAMP WITH TIME ZONE; v_s3_int_saida TIMESTAMP WITH TIME ZONE; v_s3_int_retorno TIMESTAMP WITH TIME ZONE; v_s3_saida TIMESTAMP WITH TIME ZONE; v_s3_cat TEXT; v_s3_int_ini_min INTEGER; v_s3_int_fim_min INTEGER; v_s3_permite_int BOOLEAN; v_s3_dobra_diurna BOOLEAN;

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
    SELECT s.id, s.unidade_id, s.setor_id, s.ignora_janela_presenca, COALESCE(s.intervalo_flexivel, false)
    INTO v_servidor_id, v_servidor_unidade_id, v_servidor_setor_id, v_ignora_janela, v_intervalo_flexivel
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
            -- Os DOIS cadastros, CRUS. A resolucao (qual deles vale, e o piso legal do Art. 71)
            -- acontece em public.fn_intervalo_previsto_minutos, que precisa da duracao EFETIVA
            -- do turno - e essa so existe depois do calculo de v_start_min/v_end_min, abaixo.
            -- Ver 20260822120000.
            --
            -- NAO voltar a resolver aqui. Era exatamente o COALESCE(j.intervalo_minutos, 60)
            -- aplicado a QUALQUER categoria que fazia o zero de uma jornada de 6h suprimir o
            -- intervalo de um plantao de 12h (106 lancamentos medidos em 22/08/2026).
            j.intervalo_minutos as jornada_intervalo_minutos,
            dt.intervalo_minutos as turno_intervalo_minutos,
            j.intervalo_inicio_padrao,
            j.intervalo_fim_padrao,
            s.intervalo_inicio_personalizado,
            s.intervalo_fim_personalizado,
            COALESCE(u.permite_marca_intervalo, false) as permite_marca_intervalo,
            -- Marca o plantao diurno que cai em dia de jornada noturna. Um turno marcado assim
            -- NAO FUNDE com nenhum outro bloco: sao duas jornadas de 12h, cada uma com seu
            -- proprio intervalo, e um bloco so carrega UM intervalo
            -- (v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min)). Fundir apagaria
            -- o intervalo da segunda jornada. NAO REMOVER.
            (ed.categoria = 'Plantão'
             AND COALESCE(dt.slots[1], '') IN ('M', 'T')
             AND (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer
               < (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
            ) as dobra_diurna,
            COALESCE(
                -- NIVEL 1 da cadeia de precedencia de horario (o mais alto). Ver
                -- docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md
                --
                -- Hora que o COORDENADOR informou ao escalar. E o unico nivel capaz de resolver os
                -- codigos em que o codigo do turno da a duracao e o periodo, mas nao a hora:
                -- T4, N4, N6, M7 ("M2 sao 2h em qualquer ponto da manha").
                --
                -- NULL por padrao em toda linha existente, entao nao muda NADA ate alguem preencher.
                --
                -- NAO vale para Regular: la o nome da jornada continua mandando, e mexer nisso
                -- afetaria folha de ponto e motor de compliance. NAO REMOVER ESTA CONDICAO.
                CASE WHEN ed.categoria <> 'Regular'
                     THEN extract(hour from ed.hora_inicio_prevista)::integer END,
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
                        -- NIVEL 2 da cadeia de precedencia de horario. Ver
                        -- docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md
                        --
                        -- Ancora fixa do codigo do turno (M, T, N, MT). Devolve NULL para os outros 60
                        -- codigos, entao a cascata abaixo continua valendo sem nenhuma mudanca.
                        --
                        -- SO VALE QUANDO NAO HA TURNO REGULAR NO DIA. Havendo Regular, o plantao e
                        -- sequencia do expediente e o alinhamento da cascata esta correto - forcar a
                        -- ancora ali sobreporia o plantao ao turno Regular (medido em 49 dias reais de
                        -- producao em 08/08/2026). NAO REMOVER ESTA CONDICAO.
                        -- NIVEL 2-A da cadeia de precedencia. Ver
                        -- docs/planos/2026-08-09-plantao-diurno-em-jornada-noturna.md
                        --
                        -- ESPELHO DA JORNADA NOTURNA. Quando o Regular do dia CRUZA A MEIA-NOITE
                        -- (18H AS 06H), o plantao de periodo diurno NAO e sequencia do expediente:
                        -- ele vem ANTES dele. A cascata legada alinhava o plantao pelo INICIO da
                        -- jornada (18:00) e o sobrepunha inteiro ao Regular. A ancora correta e o
                        -- FIM da jornada - a "manha" de quem faz noite comeca quando a noite dela
                        -- terminaria (06:00).
                        --
                        -- Vale so para slots[1] em (M, T), o codigo que declara o periodo. Codigo de
                        -- duracao livre (slots[1] numerico) continua resolvendo pelo NIVEL 1, acima.
                        -- Fica ACIMA do nivel 2 porque a ancora fixa do dicionario (MT = 07:00) nao
                        -- conhece a jornada do servidor e erraria por uma hora.
                        CASE WHEN COALESCE(dt.slots[1], '') IN ('M', 'T')
                                  AND (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer
                                    < (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
                             THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer END,
                        CASE WHEN public.fn_obter_horario_regular_dia(em.id, ed.dia) IS NULL
                             THEN extract(hour from dt.horario_inicio)::integer END,
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
          -- Sobreaviso NAO marca presenca: fica fora da montagem de blocos.
          -- Seu ciclo vive em logs_sobreaviso. NAO REINCLUIR.
          AND ed.categoria IN ('Regular', 'Plantão', 'Extra')
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
            v_int_dur INTEGER;
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
            -- Trabalho continuo de ate 6h nao possui intervalo intrajornada (CLT Art. 71,
            -- caput; decisao do usuario em 22/08/2026: ate 6h registra so entrada e saida).
            --
            -- ⚠️ AS DUAS PONTAS SAO DO TURNO, NAO DA JORNADA REGULAR DO SERVIDOR:
            --   duracao  = v_end_min - v_start_min, que para Plantao/Extra ja vinha do turno;
            --   intervalo= fn_intervalo_previsto_minutos, que passou a vir do turno tambem.
            -- Ate 20260822120000 so a primeira era. O intervalo_minutos = 0 de uma jornada de
            -- 6h anulava este guard inteiro num plantao de 12h.
            v_permite_int := COALESCE(r.permite_marca_intervalo, false)
                AND public.fn_jornada_tem_intervalo(
                        v_end_min - v_start_min,
                        public.fn_intervalo_previsto_minutos(
                            r.categoria, v_end_min - v_start_min,
                            r.jornada_intervalo_minutos, r.turno_intervalo_minutos));
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
                        v_int_ini_min + public.fn_intervalo_previsto_minutos(
                            r.categoria, v_end_min - v_start_min,
                            r.jornada_intervalo_minutos, r.turno_intervalo_minutos)
                END;

                -- O intervalo previsto tem que cair DENTRO do turno. jornadas.intervalo_*_padrao
                -- e HORA ABSOLUTA (12:00), entao num plantao 19:00 -> 07:00 ele nascia antes da
                -- propria entrada. Medido em 9 blocos de agosto/2026, todos plantao noturno; e o
                -- que deixava a linha do plantao com intervalo as 13:02 e entrada as 19:03.
                -- Ver 20260819220000.
                --
                -- 1. Turno que cruza a meia-noite: a hora absoluta do padrao pode pertencer ao
                --    dia seguinte. 22:00 num turno 19:00 -> 07:00 ja esta certo; 01:00 e 01:00
                --    do dia seguinte, e so somar um dia resolve.
                IF v_int_ini_min < v_start_min AND (v_int_ini_min + 1440) <= v_end_min THEN
                    v_int_ini_min := v_int_ini_min + 1440;
                    v_int_fim_min := v_int_fim_min + 1440;
                END IF;

                -- 2. Ainda fora do turno: o padrao da jornada nao serve para ESTE turno. Cai
                --    para o relativo (o mesmo fallback de quem nao tem padrao), preservando a
                --    DURACAO que o padrao definia — 12:00-14:00 continua valendo 2h.
                IF v_int_ini_min < v_start_min OR v_int_fim_min > v_end_min THEN
                    v_int_dur     := GREATEST(COALESCE(v_int_fim_min - v_int_ini_min, 0),
                                              public.fn_intervalo_previsto_minutos(
                                                  r.categoria, v_end_min - v_start_min,
                                                  r.jornada_intervalo_minutos, r.turno_intervalo_minutos));
                    v_int_ini_min := v_start_min + 240;
                    v_int_fim_min := v_int_ini_min + v_int_dur;

                    -- Nao cabe nem com o relativo (turno curto): centraliza no turno.
                    IF v_int_fim_min > v_end_min THEN
                        v_int_ini_min := v_start_min + GREATEST(((v_end_min - v_start_min) - v_int_dur) / 2, 0);
                        v_int_fim_min := v_int_ini_min + v_int_dur;
                    END IF;
                END IF;
            END IF;

            IF v_shifts_count = 1 THEN
                v_s1_id := r.escala_diaria_id; v_s1_inicio := v_start_min; v_s1_fim := v_end_min; v_s1_entrada := r.presenca_entrada_em; v_s1_int_saida := r.presenca_intervalo_saida_em; v_s1_int_retorno := r.presenca_intervalo_retorno_em; v_s1_saida := r.presenca_saida_em; v_s1_cat := r.categoria; v_s1_int_ini_min := v_int_ini_min; v_s1_int_fim_min := v_int_fim_min; v_s1_permite_int := v_permite_int; v_s1_dobra_diurna := COALESCE(r.dobra_diurna, false);
            ELSIF v_shifts_count = 2 THEN
                v_s2_id := r.escala_diaria_id; v_s2_inicio := v_start_min; v_s2_fim := v_end_min; v_s2_entrada := r.presenca_entrada_em; v_s2_int_saida := r.presenca_intervalo_saida_em; v_s2_int_retorno := r.presenca_intervalo_retorno_em; v_s2_saida := r.presenca_saida_em; v_s2_cat := r.categoria; v_s2_int_ini_min := v_int_ini_min; v_s2_int_fim_min := v_int_fim_min; v_s2_permite_int := v_permite_int; v_s2_dobra_diurna := COALESCE(r.dobra_diurna, false);
            ELSIF v_shifts_count = 3 THEN
                v_s3_id := r.escala_diaria_id; v_s3_inicio := v_start_min; v_s3_fim := v_end_min; v_s3_entrada := r.presenca_entrada_em; v_s3_int_saida := r.presenca_intervalo_saida_em; v_s3_int_retorno := r.presenca_intervalo_retorno_em; v_s3_saida := r.presenca_saida_em; v_s3_cat := r.categoria; v_s3_int_ini_min := v_int_ini_min; v_s3_int_fim_min := v_int_fim_min; v_s3_permite_int := v_permite_int; v_s3_dobra_diurna := COALESCE(r.dobra_diurna, false);
            END IF;
        END;
    END LOOP;

    IF v_shifts_count > 0 THEN
        IF v_shifts_count = 1 THEN
            v_blocks_count := 1;
            v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
        ELSIF v_shifts_count = 2 THEN
            IF v_s2_inicio <= v_s1_fim
               AND v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso'
               AND NOT v_s1_dobra_diurna AND NOT v_s2_dobra_diurna THEN
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
               AND v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso'
               AND NOT v_s1_dobra_diurna AND NOT v_s2_dobra_diurna THEN
                v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
                v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
                v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min); v_b1_int_fim := COALESCE(v_s1_int_fim_min, v_s2_int_fim_min); v_b1_permite_int := COALESCE(v_s1_permite_int, v_s2_permite_int, false);
                
                IF v_s3_inicio <= v_b1_fim AND v_s3_cat <> 'Sobreaviso' AND NOT v_s3_dobra_diurna THEN
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
                   AND v_s2_cat <> 'Sobreaviso' AND v_s3_cat <> 'Sobreaviso'
                   AND NOT v_s2_dobra_diurna AND NOT v_s3_dobra_diurna THEN
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
                           (v_momento_atual_minutos + 1440) >= (v_b_fim + public.fn_ajuste_intervalo_flexivel(v_intervalo_flexivel, v_b_int_saidas[1], v_b_int_retornos[1], v_b_int_fim - v_b_int_ini) - v_janela_minutos) AND
                           (v_momento_atual_minutos + 1440) <= (v_b_fim + public.fn_ajuste_intervalo_flexivel(v_intervalo_flexivel, v_b_int_saidas[1], v_b_int_retornos[1], v_b_int_fim - v_b_int_ini) + v_janela_minutos)
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
            -- Os DOIS cadastros, CRUS. A resolucao (qual deles vale, e o piso legal do Art. 71)
            -- acontece em public.fn_intervalo_previsto_minutos, que precisa da duracao EFETIVA
            -- do turno - e essa so existe depois do calculo de v_start_min/v_end_min, abaixo.
            -- Ver 20260822120000.
            --
            -- NAO voltar a resolver aqui. Era exatamente o COALESCE(j.intervalo_minutos, 60)
            -- aplicado a QUALQUER categoria que fazia o zero de uma jornada de 6h suprimir o
            -- intervalo de um plantao de 12h (106 lancamentos medidos em 22/08/2026).
            j.intervalo_minutos as jornada_intervalo_minutos,
            dt.intervalo_minutos as turno_intervalo_minutos,
            j.intervalo_inicio_padrao,
            j.intervalo_fim_padrao,
            s.intervalo_inicio_personalizado,
            s.intervalo_fim_personalizado,
            COALESCE(u.permite_marca_intervalo, false) as permite_marca_intervalo,
            -- Marca o plantao diurno que cai em dia de jornada noturna. Um turno marcado assim
            -- NAO FUNDE com nenhum outro bloco: sao duas jornadas de 12h, cada uma com seu
            -- proprio intervalo, e um bloco so carrega UM intervalo
            -- (v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min)). Fundir apagaria
            -- o intervalo da segunda jornada. NAO REMOVER.
            (ed.categoria = 'Plantão'
             AND COALESCE(dt.slots[1], '') IN ('M', 'T')
             AND (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer
               < (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
            ) as dobra_diurna,
            COALESCE(
                -- NIVEL 1 da cadeia de precedencia de horario (o mais alto). Ver
                -- docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md
                --
                -- Hora que o COORDENADOR informou ao escalar. E o unico nivel capaz de resolver os
                -- codigos em que o codigo do turno da a duracao e o periodo, mas nao a hora:
                -- T4, N4, N6, M7 ("M2 sao 2h em qualquer ponto da manha").
                --
                -- NULL por padrao em toda linha existente, entao nao muda NADA ate alguem preencher.
                --
                -- NAO vale para Regular: la o nome da jornada continua mandando, e mexer nisso
                -- afetaria folha de ponto e motor de compliance. NAO REMOVER ESTA CONDICAO.
                CASE WHEN ed.categoria <> 'Regular'
                     THEN extract(hour from ed.hora_inicio_prevista)::integer END,
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
                        -- NIVEL 2 da cadeia de precedencia de horario. Ver
                        -- docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md
                        --
                        -- Ancora fixa do codigo do turno (M, T, N, MT). Devolve NULL para os outros 60
                        -- codigos, entao a cascata abaixo continua valendo sem nenhuma mudanca.
                        --
                        -- SO VALE QUANDO NAO HA TURNO REGULAR NO DIA. Havendo Regular, o plantao e
                        -- sequencia do expediente e o alinhamento da cascata esta correto - forcar a
                        -- ancora ali sobreporia o plantao ao turno Regular (medido em 49 dias reais de
                        -- producao em 08/08/2026). NAO REMOVER ESTA CONDICAO.
                        -- NIVEL 2-A da cadeia de precedencia. Ver
                        -- docs/planos/2026-08-09-plantao-diurno-em-jornada-noturna.md
                        --
                        -- ESPELHO DA JORNADA NOTURNA. Quando o Regular do dia CRUZA A MEIA-NOITE
                        -- (18H AS 06H), o plantao de periodo diurno NAO e sequencia do expediente:
                        -- ele vem ANTES dele. A cascata legada alinhava o plantao pelo INICIO da
                        -- jornada (18:00) e o sobrepunha inteiro ao Regular. A ancora correta e o
                        -- FIM da jornada - a "manha" de quem faz noite comeca quando a noite dela
                        -- terminaria (06:00).
                        --
                        -- Vale so para slots[1] em (M, T), o codigo que declara o periodo. Codigo de
                        -- duracao livre (slots[1] numerico) continua resolvendo pelo NIVEL 1, acima.
                        -- Fica ACIMA do nivel 2 porque a ancora fixa do dicionario (MT = 07:00) nao
                        -- conhece a jornada do servidor e erraria por uma hora.
                        CASE WHEN COALESCE(dt.slots[1], '') IN ('M', 'T')
                                  AND (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer
                                    < (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
                             THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer END,
                        CASE WHEN public.fn_obter_horario_regular_dia(em.id, ed.dia) IS NULL
                             THEN extract(hour from dt.horario_inicio)::integer END,
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
          -- Sobreaviso NAO marca presenca: fica fora da montagem de blocos.
          -- Seu ciclo vive em logs_sobreaviso. NAO REINCLUIR.
          AND ed.categoria IN ('Regular', 'Plantão', 'Extra')
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
            v_int_dur INTEGER;
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
            -- Trabalho continuo de ate 6h nao possui intervalo intrajornada (CLT Art. 71,
            -- caput; decisao do usuario em 22/08/2026: ate 6h registra so entrada e saida).
            --
            -- ⚠️ AS DUAS PONTAS SAO DO TURNO, NAO DA JORNADA REGULAR DO SERVIDOR:
            --   duracao  = v_end_min - v_start_min, que para Plantao/Extra ja vinha do turno;
            --   intervalo= fn_intervalo_previsto_minutos, que passou a vir do turno tambem.
            -- Ate 20260822120000 so a primeira era. O intervalo_minutos = 0 de uma jornada de
            -- 6h anulava este guard inteiro num plantao de 12h.
            v_permite_int := COALESCE(r.permite_marca_intervalo, false)
                AND public.fn_jornada_tem_intervalo(
                        v_end_min - v_start_min,
                        public.fn_intervalo_previsto_minutos(
                            r.categoria, v_end_min - v_start_min,
                            r.jornada_intervalo_minutos, r.turno_intervalo_minutos));
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
                        v_int_ini_min + public.fn_intervalo_previsto_minutos(
                            r.categoria, v_end_min - v_start_min,
                            r.jornada_intervalo_minutos, r.turno_intervalo_minutos)
                END;

                -- O intervalo previsto tem que cair DENTRO do turno. jornadas.intervalo_*_padrao
                -- e HORA ABSOLUTA (12:00), entao num plantao 19:00 -> 07:00 ele nascia antes da
                -- propria entrada. Medido em 9 blocos de agosto/2026, todos plantao noturno; e o
                -- que deixava a linha do plantao com intervalo as 13:02 e entrada as 19:03.
                -- Ver 20260819220000.
                --
                -- 1. Turno que cruza a meia-noite: a hora absoluta do padrao pode pertencer ao
                --    dia seguinte. 22:00 num turno 19:00 -> 07:00 ja esta certo; 01:00 e 01:00
                --    do dia seguinte, e so somar um dia resolve.
                IF v_int_ini_min < v_start_min AND (v_int_ini_min + 1440) <= v_end_min THEN
                    v_int_ini_min := v_int_ini_min + 1440;
                    v_int_fim_min := v_int_fim_min + 1440;
                END IF;

                -- 2. Ainda fora do turno: o padrao da jornada nao serve para ESTE turno. Cai
                --    para o relativo (o mesmo fallback de quem nao tem padrao), preservando a
                --    DURACAO que o padrao definia — 12:00-14:00 continua valendo 2h.
                IF v_int_ini_min < v_start_min OR v_int_fim_min > v_end_min THEN
                    v_int_dur     := GREATEST(COALESCE(v_int_fim_min - v_int_ini_min, 0),
                                              public.fn_intervalo_previsto_minutos(
                                                  r.categoria, v_end_min - v_start_min,
                                                  r.jornada_intervalo_minutos, r.turno_intervalo_minutos));
                    v_int_ini_min := v_start_min + 240;
                    v_int_fim_min := v_int_ini_min + v_int_dur;

                    -- Nao cabe nem com o relativo (turno curto): centraliza no turno.
                    IF v_int_fim_min > v_end_min THEN
                        v_int_ini_min := v_start_min + GREATEST(((v_end_min - v_start_min) - v_int_dur) / 2, 0);
                        v_int_fim_min := v_int_ini_min + v_int_dur;
                    END IF;
                END IF;
            END IF;

            IF v_shifts_count = 1 THEN
                v_s1_id := r.escala_diaria_id; v_s1_inicio := v_start_min; v_s1_fim := v_end_min; v_s1_entrada := r.presenca_entrada_em; v_s1_int_saida := r.presenca_intervalo_saida_em; v_s1_int_retorno := r.presenca_intervalo_retorno_em; v_s1_saida := r.presenca_saida_em; v_s1_cat := r.categoria; v_s1_int_ini_min := v_int_ini_min; v_s1_int_fim_min := v_int_fim_min; v_s1_permite_int := v_permite_int; v_s1_dobra_diurna := COALESCE(r.dobra_diurna, false);
            ELSIF v_shifts_count = 2 THEN
                v_s2_id := r.escala_diaria_id; v_s2_inicio := v_start_min; v_s2_fim := v_end_min; v_s2_entrada := r.presenca_entrada_em; v_s2_int_saida := r.presenca_intervalo_saida_em; v_s2_int_retorno := r.presenca_intervalo_retorno_em; v_s2_saida := r.presenca_saida_em; v_s2_cat := r.categoria; v_s2_int_ini_min := v_int_ini_min; v_s2_int_fim_min := v_int_fim_min; v_s2_permite_int := v_permite_int; v_s2_dobra_diurna := COALESCE(r.dobra_diurna, false);
            ELSIF v_shifts_count = 3 THEN
                v_s3_id := r.escala_diaria_id; v_s3_inicio := v_start_min; v_s3_fim := v_end_min; v_s3_entrada := r.presenca_entrada_em; v_s3_int_saida := r.presenca_intervalo_saida_em; v_s3_int_retorno := r.presenca_intervalo_retorno_em; v_s3_saida := r.presenca_saida_em; v_s3_cat := r.categoria; v_s3_int_ini_min := v_int_ini_min; v_s3_int_fim_min := v_int_fim_min; v_s3_permite_int := v_permite_int; v_s3_dobra_diurna := COALESCE(r.dobra_diurna, false);
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
               AND v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso'
               AND NOT v_s1_dobra_diurna AND NOT v_s2_dobra_diurna THEN
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
               AND v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso'
               AND NOT v_s1_dobra_diurna AND NOT v_s2_dobra_diurna THEN
            v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
            v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
            v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min); v_b1_int_fim := COALESCE(v_s1_int_fim_min, v_s2_int_fim_min); v_b1_permite_int := COALESCE(v_s1_permite_int, v_s2_permite_int, false);
            
            IF v_s3_inicio <= v_b1_fim AND v_s3_cat <> 'Sobreaviso' AND NOT v_s3_dobra_diurna THEN
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
                   AND v_s2_cat <> 'Sobreaviso' AND v_s3_cat <> 'Sobreaviso'
                   AND NOT v_s2_dobra_diurna AND NOT v_s3_dobra_diurna THEN
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
        
        v_fim_efetivo INTEGER;
        v_matched_action TEXT := NULL;
        v_matched_ids UUID[] := '{}';
        v_matched_cat TEXT := NULL;
        v_matched_idx INTEGER := NULL;
        v_transicao BOOLEAN := false;
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
                IF v_ignora_janela
                   -- Intervalo flexivel: qualquer momento apos a entrada, mas antes de abrir
                   -- a janela de saida final (senao a saida do expediente viraria intervalo).
                   OR (v_intervalo_flexivel
                       AND v_b_entradas[1] IS NOT NULL
                       AND v_momento_atual_minutos > v_b_inicio
                       AND v_momento_atual_minutos < (v_b_fim - v_janela_minutos))
                   OR (NOT v_intervalo_flexivel AND
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
                IF v_ignora_janela
                   -- Intervalo flexivel: qualquer momento, desde que a saida ja tenha ocorrido.
                   OR (v_intervalo_flexivel AND v_b_int_saidas[1] IS NOT NULL)
                   OR (NOT v_intervalo_flexivel AND
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
                v_fim_efetivo := v_b_fim + public.fn_ajuste_intervalo_flexivel(v_intervalo_flexivel, v_b_int_saidas[1], v_b_int_retornos[1], v_b_int_fim - v_b_int_ini);
                v_closest_fim_formatted := lpad(((v_fim_efetivo % 1440) / 60)::text, 2, '0') || ':' || lpad((v_fim_efetivo % 60)::text, 2, '0');

                IF v_ignora_janela OR (
                   v_momento_atual_minutos >= (v_fim_efetivo - v_janela_minutos) AND
                   v_momento_atual_minutos <= (v_fim_efetivo + v_janela_minutos)
                ) THEN
                    v_matched_action := 'checkout';
                    v_matched_idx := idx;
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
                    v_matched_idx := idx;
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

            -- BATIDA DE TRANSICAO (09/08/2026). Ver
            -- docs/planos/2026-08-09-plantao-diurno-em-jornada-noturna.md
            --
            -- Dois blocos encostados (fim do bloco i == inicio do bloco i+1) sao duas
            -- jornadas seguidas sem intervalo entre elas: o servidor sai de uma e entra na
            -- outra no mesmo instante. Uma batida so responde pelos dois passos.
            --
            -- O horario gravado na entrada do bloco seguinte e a BATIDA REAL, nunca o
            -- previsto - e o oposto de fabricar timestamp (Portaria 671/2021, vedacao 2).
            -- Sem esta regra o servidor teria de bater duas vezes no mesmo minuto, e quem
            -- esquecesse a segunda deixaria a jornada seguinte sem entrada.
            IF v_matched_idx = 1 AND v_blocks_count >= 2
                   AND v_b2_inicio = v_b1_fim AND v_b2_entradas[1] IS NULL THEN
                UPDATE public.escala_diaria
                SET presenca_entrada_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id
                WHERE id = ANY(v_b2_ids);
                v_transicao := true;
            ELSIF v_matched_idx = 2 AND v_blocks_count >= 3
                   AND v_b3_inicio = v_b2_fim AND v_b3_entradas[1] IS NULL THEN
                UPDATE public.escala_diaria
                SET presenca_entrada_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id
                WHERE id = ANY(v_b3_ids);
                v_transicao := true;
            END IF;
            
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
            
            RETURN jsonb_build_object('success', true, 'message',
                CASE WHEN v_transicao
                     THEN 'Saída do turno e entrada do turno seguinte confirmadas às ' || to_char(v_now_local, 'HH24:MI') || '. Bom trabalho!'
                     ELSE 'Saída confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom descanso!'
                END);
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


-- ============================================================================
-- fn_blocos_previstos_dia - copia de 20260819200000 + a mesma insercao (1 sitio)
--
-- (A linha acima substitui um cabecalho que veio junto no recorte de 20260809000000 e falava de
--  fn_confirmar_presenca_manual, que NAO e recriada aqui. Comentario SQL, sem efeito no que foi
--  executado — corrigido so para o arquivo nao mentir sobre o proprio conteudo.)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_blocos_previstos_dia(
    p_servidor_id uuid,
    p_data        date
)
RETURNS TABLE (
    bloco_ordem               integer,
    escala_diaria_ids         uuid[],
    categoria                 text,
    inicio_previsto           timestamptz,
    fim_previsto              timestamptz,
    intervalo_inicio_previsto timestamptz,
    intervalo_fim_previsto    timestamptz,
    permite_intervalo         boolean,
    -- O previsto de CADA turno fundido neste bloco, na mesma ordem de escala_diaria_ids.
    -- Um bloco com 2 turnos tem 1 fronteira interna: turnos_fim[1] = turnos_inicio[2]. E ali
    -- que a batida de transicao acontece. Ver 20260819200000.
    turnos_inicio             timestamptz[],
    turnos_fim                timestamptz[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fnbloco$
DECLARE
    v_timezone TEXT;
    v_servidor_id UUID;
    v_dia_hoje INTEGER;
    v_mes INTEGER;
    v_ano INTEGER;
    r RECORD;
    v_shifts_count INTEGER := 0;
    v_blocks_count INTEGER := 0;

    -- Turnos individuais do dia (ate 3), na ordem de start_hour.
    v_s1_id UUID; v_s1_inicio INTEGER; v_s1_fim INTEGER; v_s1_entrada TIMESTAMP WITH TIME ZONE; v_s1_int_saida TIMESTAMP WITH TIME ZONE; v_s1_int_retorno TIMESTAMP WITH TIME ZONE; v_s1_saida TIMESTAMP WITH TIME ZONE; v_s1_cat TEXT; v_s1_int_ini_min INTEGER; v_s1_int_fim_min INTEGER; v_s1_permite_int BOOLEAN; v_s1_dobra_diurna BOOLEAN;
    v_s2_id UUID; v_s2_inicio INTEGER; v_s2_fim INTEGER; v_s2_entrada TIMESTAMP WITH TIME ZONE; v_s2_int_saida TIMESTAMP WITH TIME ZONE; v_s2_int_retorno TIMESTAMP WITH TIME ZONE; v_s2_saida TIMESTAMP WITH TIME ZONE; v_s2_cat TEXT; v_s2_int_ini_min INTEGER; v_s2_int_fim_min INTEGER; v_s2_permite_int BOOLEAN; v_s2_dobra_diurna BOOLEAN;
    v_s3_id UUID; v_s3_inicio INTEGER; v_s3_fim INTEGER; v_s3_entrada TIMESTAMP WITH TIME ZONE; v_s3_int_saida TIMESTAMP WITH TIME ZONE; v_s3_int_retorno TIMESTAMP WITH TIME ZONE; v_s3_saida TIMESTAMP WITH TIME ZONE; v_s3_cat TEXT; v_s3_int_ini_min INTEGER; v_s3_int_fim_min INTEGER; v_s3_permite_int BOOLEAN; v_s3_dobra_diurna BOOLEAN;

    -- Blocos contiguos resultantes da fusao (ate 3).
    v_b1_inicio INTEGER; v_b1_fim INTEGER; v_b1_ids UUID[]; v_b1_entradas TIMESTAMP WITH TIME ZONE[]; v_b1_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b1_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b1_saidas TIMESTAMP WITH TIME ZONE[]; v_b1_cat TEXT; v_b1_int_ini INTEGER; v_b1_int_fim INTEGER; v_b1_permite_int BOOLEAN;
    v_b2_inicio INTEGER; v_b2_fim INTEGER; v_b2_ids UUID[]; v_b2_entradas TIMESTAMP WITH TIME ZONE[]; v_b2_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b2_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b2_saidas TIMESTAMP WITH TIME ZONE[]; v_b2_cat TEXT; v_b2_int_ini INTEGER; v_b2_int_fim INTEGER; v_b2_permite_int BOOLEAN;
    v_b3_inicio INTEGER; v_b3_fim INTEGER; v_b3_ids UUID[]; v_b3_entradas TIMESTAMP WITH TIME ZONE[]; v_b3_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b3_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b3_saidas TIMESTAMP WITH TIME ZONE[]; v_b3_cat TEXT; v_b3_int_ini INTEGER; v_b3_int_fim INTEGER; v_b3_permite_int BOOLEAN;
    -- Previsto de cada turno fundido, para a batida de transicao (20260819200000).
    v_b1_turnos_ini INTEGER[]; v_b1_turnos_fim INTEGER[];
    v_b2_turnos_ini INTEGER[]; v_b2_turnos_fim INTEGER[];
    v_b3_turnos_ini INTEGER[]; v_b3_turnos_fim INTEGER[];
BEGIN
    -- Timezone: mesma fonte e mesmo fallback de fn_confirmar_presenca.
    SELECT (valor#>>'{}')::text INTO v_timezone
    FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    -- Alimenta as variaveis que a regiao copiada espera. E isso que permite copiar o cursor
    -- verbatim, sem renomear nada dentro dele.
    v_servidor_id := p_servidor_id;
    v_dia_hoje    := extract(day   from p_data)::integer;
    v_mes         := extract(month from p_data)::integer;
    v_ano         := extract(year  from p_data)::integer;

    -- ESCOPO (12/08/2026, CLAUDE.md "Pendencias que bloqueiam a Fase 5", item 3). Antes desta
    -- checagem, qualquer authenticated podia consultar a projecao de presenca de QUALQUER
    -- servidor, sabendo so o UUID - GRANT liberado, nenhum guard.
    --
    -- service_role bypassa (auth.uid() IS NULL): e o caminho de toda chamada administrativa/
    -- manual da cadeia de reconciliacao (fn_alocar_marcacoes_dia, fn_projecao_marcacoes_dia,
    -- fn_conferir_reconciliacao, fn_reconciliar_marcacoes_dia - a unica que escreve). Nenhuma
    -- delas ganha guard proprio: por serem envelopes LATERAL desta funcao, herdam a checagem
    -- daqui.
    --
    -- Checa por ESCALA (escala_mensal do servidor no mes/ano consultado), NAO pela lotacao
    -- atual (servidores.unidade_id/setor_id): um servidor externo adicionado a escala de outra
    -- unidade (v1.2.4) tem que continuar visivel para quem gerencia AQUELA escala, mesmo fora
    -- da propria lotacao. fn_unidade_no_escopo sozinha nao basta - so verifica
    -- profile_unidades; fn_unidade_alcancavel_por_setor cobre quem so tem profile_setores sem a
    -- unidade-pai vinculada (piloto da TI, ver CLAUDE.md).
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM public.escala_mensal em_escopo
         WHERE em_escopo.servidor_id = p_servidor_id
           AND em_escopo.ano = v_ano
           AND em_escopo.mes = v_mes
           AND (
               public.fn_unidade_no_escopo(em_escopo.unidade_id)
               OR public.fn_unidade_alcancavel_por_setor(em_escopo.unidade_id)
           )
    ) THEN
        RAISE EXCEPTION 'Sem permissão para acessar a escala deste servidor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

-- ============================================================================
-- INICIO DA REGIAO COPIADA DE 20260807050000 (cursor de hoje + fusao de blocos)
-- Nao editar a mao. Alterar aqui exige regerar pelo script.
-- ============================================================================
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
            -- Os DOIS cadastros, CRUS. A resolucao (qual deles vale, e o piso legal do Art. 71)
            -- acontece em public.fn_intervalo_previsto_minutos, que precisa da duracao EFETIVA
            -- do turno - e essa so existe depois do calculo de v_start_min/v_end_min, abaixo.
            -- Ver 20260822120000.
            --
            -- NAO voltar a resolver aqui. Era exatamente o COALESCE(j.intervalo_minutos, 60)
            -- aplicado a QUALQUER categoria que fazia o zero de uma jornada de 6h suprimir o
            -- intervalo de um plantao de 12h (106 lancamentos medidos em 22/08/2026).
            j.intervalo_minutos as jornada_intervalo_minutos,
            dt.intervalo_minutos as turno_intervalo_minutos,
            j.intervalo_inicio_padrao,
            j.intervalo_fim_padrao,
            s.intervalo_inicio_personalizado,
            s.intervalo_fim_personalizado,
            COALESCE(u.permite_marca_intervalo, false) as permite_marca_intervalo,
            -- Marca o plantao diurno que cai em dia de jornada noturna. Um turno marcado assim
            -- NAO FUNDE com nenhum outro bloco: sao duas jornadas de 12h, cada uma com seu
            -- proprio intervalo, e um bloco so carrega UM intervalo
            -- (v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min)). Fundir apagaria
            -- o intervalo da segunda jornada. NAO REMOVER.
            (ed.categoria = 'Plantão'
             AND COALESCE(dt.slots[1], '') IN ('M', 'T')
             AND (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer
               < (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
            ) as dobra_diurna,
            COALESCE(
                -- NIVEL 1 da cadeia de precedencia de horario (o mais alto). Ver
                -- docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md
                --
                -- Hora que o COORDENADOR informou ao escalar. E o unico nivel capaz de resolver os
                -- codigos em que o codigo do turno da a duracao e o periodo, mas nao a hora:
                -- T4, N4, N6, M7 ("M2 sao 2h em qualquer ponto da manha").
                --
                -- NULL por padrao em toda linha existente, entao nao muda NADA ate alguem preencher.
                --
                -- NAO vale para Regular: la o nome da jornada continua mandando, e mexer nisso
                -- afetaria folha de ponto e motor de compliance. NAO REMOVER ESTA CONDICAO.
                CASE WHEN ed.categoria <> 'Regular'
                     THEN extract(hour from ed.hora_inicio_prevista)::integer END,
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
                        -- NIVEL 2 da cadeia de precedencia de horario. Ver
                        -- docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md
                        --
                        -- Ancora fixa do codigo do turno (M, T, N, MT). Devolve NULL para os outros 60
                        -- codigos, entao a cascata abaixo continua valendo sem nenhuma mudanca.
                        --
                        -- SO VALE QUANDO NAO HA TURNO REGULAR NO DIA. Havendo Regular, o plantao e
                        -- sequencia do expediente e o alinhamento da cascata esta correto - forcar a
                        -- ancora ali sobreporia o plantao ao turno Regular (medido em 49 dias reais de
                        -- producao em 08/08/2026). NAO REMOVER ESTA CONDICAO.
                        -- NIVEL 2-A da cadeia de precedencia. Ver
                        -- docs/planos/2026-08-09-plantao-diurno-em-jornada-noturna.md
                        --
                        -- ESPELHO DA JORNADA NOTURNA. Quando o Regular do dia CRUZA A MEIA-NOITE
                        -- (18H AS 06H), o plantao de periodo diurno NAO e sequencia do expediente:
                        -- ele vem ANTES dele. A cascata legada alinhava o plantao pelo INICIO da
                        -- jornada (18:00) e o sobrepunha inteiro ao Regular. A ancora correta e o
                        -- FIM da jornada - a "manha" de quem faz noite comeca quando a noite dela
                        -- terminaria (06:00).
                        --
                        -- Vale so para slots[1] em (M, T), o codigo que declara o periodo. Codigo de
                        -- duracao livre (slots[1] numerico) continua resolvendo pelo NIVEL 1, acima.
                        -- Fica ACIMA do nivel 2 porque a ancora fixa do dicionario (MT = 07:00) nao
                        -- conhece a jornada do servidor e erraria por uma hora.
                        CASE WHEN COALESCE(dt.slots[1], '') IN ('M', 'T')
                                  AND (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer
                                    < (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
                             THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer END,
                        CASE WHEN public.fn_obter_horario_regular_dia(em.id, ed.dia) IS NULL
                             THEN extract(hour from dt.horario_inicio)::integer END,
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
          -- Sobreaviso NAO marca presenca: fica fora da montagem de blocos.
          -- Seu ciclo vive em logs_sobreaviso. NAO REINCLUIR.
          AND ed.categoria IN ('Regular', 'Plantão', 'Extra')
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
            v_int_dur INTEGER;
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
            -- Trabalho continuo de ate 6h nao possui intervalo intrajornada (CLT Art. 71,
            -- caput; decisao do usuario em 22/08/2026: ate 6h registra so entrada e saida).
            --
            -- ⚠️ AS DUAS PONTAS SAO DO TURNO, NAO DA JORNADA REGULAR DO SERVIDOR:
            --   duracao  = v_end_min - v_start_min, que para Plantao/Extra ja vinha do turno;
            --   intervalo= fn_intervalo_previsto_minutos, que passou a vir do turno tambem.
            -- Ate 20260822120000 so a primeira era. O intervalo_minutos = 0 de uma jornada de
            -- 6h anulava este guard inteiro num plantao de 12h.
            v_permite_int := COALESCE(r.permite_marca_intervalo, false)
                AND public.fn_jornada_tem_intervalo(
                        v_end_min - v_start_min,
                        public.fn_intervalo_previsto_minutos(
                            r.categoria, v_end_min - v_start_min,
                            r.jornada_intervalo_minutos, r.turno_intervalo_minutos));
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
                        v_int_ini_min + public.fn_intervalo_previsto_minutos(
                            r.categoria, v_end_min - v_start_min,
                            r.jornada_intervalo_minutos, r.turno_intervalo_minutos)
                END;

                -- O intervalo previsto tem que cair DENTRO do turno. jornadas.intervalo_*_padrao
                -- e HORA ABSOLUTA (12:00), entao num plantao 19:00 -> 07:00 ele nascia antes da
                -- propria entrada. Medido em 9 blocos de agosto/2026, todos plantao noturno; e o
                -- que deixava a linha do plantao com intervalo as 13:02 e entrada as 19:03.
                -- Ver 20260819220000.
                --
                -- 1. Turno que cruza a meia-noite: a hora absoluta do padrao pode pertencer ao
                --    dia seguinte. 22:00 num turno 19:00 -> 07:00 ja esta certo; 01:00 e 01:00
                --    do dia seguinte, e so somar um dia resolve.
                IF v_int_ini_min < v_start_min AND (v_int_ini_min + 1440) <= v_end_min THEN
                    v_int_ini_min := v_int_ini_min + 1440;
                    v_int_fim_min := v_int_fim_min + 1440;
                END IF;

                -- 2. Ainda fora do turno: o padrao da jornada nao serve para ESTE turno. Cai
                --    para o relativo (o mesmo fallback de quem nao tem padrao), preservando a
                --    DURACAO que o padrao definia — 12:00-14:00 continua valendo 2h.
                IF v_int_ini_min < v_start_min OR v_int_fim_min > v_end_min THEN
                    v_int_dur     := GREATEST(COALESCE(v_int_fim_min - v_int_ini_min, 0),
                                              public.fn_intervalo_previsto_minutos(
                                                  r.categoria, v_end_min - v_start_min,
                                                  r.jornada_intervalo_minutos, r.turno_intervalo_minutos));
                    v_int_ini_min := v_start_min + 240;
                    v_int_fim_min := v_int_ini_min + v_int_dur;

                    -- Nao cabe nem com o relativo (turno curto): centraliza no turno.
                    IF v_int_fim_min > v_end_min THEN
                        v_int_ini_min := v_start_min + GREATEST(((v_end_min - v_start_min) - v_int_dur) / 2, 0);
                        v_int_fim_min := v_int_ini_min + v_int_dur;
                    END IF;
                END IF;
            END IF;

            IF v_shifts_count = 1 THEN
                v_s1_id := r.escala_diaria_id; v_s1_inicio := v_start_min; v_s1_fim := v_end_min; v_s1_entrada := r.presenca_entrada_em; v_s1_int_saida := r.presenca_intervalo_saida_em; v_s1_int_retorno := r.presenca_intervalo_retorno_em; v_s1_saida := r.presenca_saida_em; v_s1_cat := r.categoria; v_s1_int_ini_min := v_int_ini_min; v_s1_int_fim_min := v_int_fim_min; v_s1_permite_int := v_permite_int; v_s1_dobra_diurna := COALESCE(r.dobra_diurna, false);
            ELSIF v_shifts_count = 2 THEN
                v_s2_id := r.escala_diaria_id; v_s2_inicio := v_start_min; v_s2_fim := v_end_min; v_s2_entrada := r.presenca_entrada_em; v_s2_int_saida := r.presenca_intervalo_saida_em; v_s2_int_retorno := r.presenca_intervalo_retorno_em; v_s2_saida := r.presenca_saida_em; v_s2_cat := r.categoria; v_s2_int_ini_min := v_int_ini_min; v_s2_int_fim_min := v_int_fim_min; v_s2_permite_int := v_permite_int; v_s2_dobra_diurna := COALESCE(r.dobra_diurna, false);
            ELSIF v_shifts_count = 3 THEN
                v_s3_id := r.escala_diaria_id; v_s3_inicio := v_start_min; v_s3_fim := v_end_min; v_s3_entrada := r.presenca_entrada_em; v_s3_int_saida := r.presenca_intervalo_saida_em; v_s3_int_retorno := r.presenca_intervalo_retorno_em; v_s3_saida := r.presenca_saida_em; v_s3_cat := r.categoria; v_s3_int_ini_min := v_int_ini_min; v_s3_int_fim_min := v_int_fim_min; v_s3_permite_int := v_permite_int; v_s3_dobra_diurna := COALESCE(r.dobra_diurna, false);
            END IF;
        END;
    END LOOP;

    IF v_shifts_count = 0 THEN
        -- Sem escala no dia: nenhum bloco previsto. A funcao original logava tentativa
        -- negada aqui; esta e de consulta e apenas nao devolve linhas.
        RETURN;
    END IF;

    -- Merge today's shifts into blocks
    IF v_shifts_count = 1 THEN
        v_blocks_count := 1;
        v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
    ELSIF v_shifts_count = 2 THEN
        IF v_s2_inicio <= v_s1_fim
               AND v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso'
               AND NOT v_s1_dobra_diurna AND NOT v_s2_dobra_diurna THEN
            v_blocks_count := 1;
            v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio, v_s2_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim, v_s2_fim]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
            v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
            v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min); v_b1_int_fim := COALESCE(v_s1_int_fim_min, v_s2_int_fim_min); v_b1_permite_int := COALESCE(v_s1_permite_int, v_s2_permite_int, false);
        ELSE
            v_blocks_count := 2;
            v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
            v_b2_inicio := v_s2_inicio; v_b2_fim := v_s2_fim; v_b2_ids := ARRAY[v_s2_id]; v_b2_turnos_ini := ARRAY[v_s2_inicio]; v_b2_turnos_fim := ARRAY[v_s2_fim]; v_b2_entradas := ARRAY[v_s2_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida]; v_b2_cat := v_s2_cat; v_b2_int_ini := v_s2_int_ini_min; v_b2_int_fim := v_s2_int_fim_min; v_b2_permite_int := v_s2_permite_int;
        END IF;
    ELSIF v_shifts_count >= 3 THEN
        IF v_s2_inicio <= v_s1_fim
               AND v_s1_cat <> 'Sobreaviso' AND v_s2_cat <> 'Sobreaviso'
               AND NOT v_s1_dobra_diurna AND NOT v_s2_dobra_diurna THEN
            v_b1_inicio := v_s1_inicio; v_b1_fim := GREATEST(v_s1_fim, v_s2_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio, v_s2_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim, v_s2_fim]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida];
            v_b1_cat := CASE WHEN v_s1_cat IN ('Regular', 'Plantão') THEN v_s1_cat ELSE v_s2_cat END;
            v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min); v_b1_int_fim := COALESCE(v_s1_int_fim_min, v_s2_int_fim_min); v_b1_permite_int := COALESCE(v_s1_permite_int, v_s2_permite_int, false);
            
            IF v_s3_inicio <= v_b1_fim AND v_s3_cat <> 'Sobreaviso' AND NOT v_s3_dobra_diurna THEN
                v_blocks_count := 1;
                v_b1_fim := GREATEST(v_b1_fim, v_s3_fim); v_b1_ids := ARRAY[v_s1_id, v_s2_id, v_s3_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio, v_s2_inicio, v_s3_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim, v_s2_fim, v_s3_fim]; v_b1_entradas := ARRAY[v_s1_entrada, v_s2_entrada, v_s3_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida, v_s2_int_saida, v_s3_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno, v_s2_int_retorno, v_s3_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida, v_s2_saida, v_s3_saida];
                v_b1_cat := CASE WHEN v_s3_cat IN ('Regular', 'Plantão') THEN v_s3_cat ELSE v_b1_cat END;
            ELSE
                v_blocks_count := 2;
                v_b2_inicio := v_s3_inicio; v_b2_fim := v_s3_fim; v_b2_ids := ARRAY[v_s3_id]; v_b2_turnos_ini := ARRAY[v_s3_inicio]; v_b2_turnos_fim := ARRAY[v_s3_fim]; v_b2_entradas := ARRAY[v_s3_entrada]; v_b2_int_saidas := ARRAY[v_s3_int_saida]; v_b2_int_retornos := ARRAY[v_s3_int_retorno]; v_b2_saidas := ARRAY[v_s3_saida]; v_b2_cat := v_s3_cat; v_b2_int_ini := v_s3_int_ini_min; v_b2_int_fim := v_s3_int_fim_min; v_b2_permite_int := v_s3_permite_int;
            END IF;
        ELSE
            v_b1_inicio := v_s1_inicio; v_b1_fim := v_s1_fim; v_b1_ids := ARRAY[v_s1_id]; v_b1_turnos_ini := ARRAY[v_s1_inicio]; v_b1_turnos_fim := ARRAY[v_s1_fim]; v_b1_entradas := ARRAY[v_s1_entrada]; v_b1_int_saidas := ARRAY[v_s1_int_saida]; v_b1_int_retornos := ARRAY[v_s1_int_retorno]; v_b1_saidas := ARRAY[v_s1_saida]; v_b1_cat := v_s1_cat; v_b1_int_ini := v_s1_int_ini_min; v_b1_int_fim := v_s1_int_fim_min; v_b1_permite_int := v_s1_permite_int;
            
            IF v_s3_inicio <= v_s2_fim
                   AND v_s2_cat <> 'Sobreaviso' AND v_s3_cat <> 'Sobreaviso'
                   AND NOT v_s2_dobra_diurna AND NOT v_s3_dobra_diurna THEN
                v_blocks_count := 2;
                v_b2_inicio := v_s2_inicio; v_b2_fim := GREATEST(v_s2_fim, v_s3_fim); v_b2_ids := ARRAY[v_s2_id, v_s3_id]; v_b2_turnos_ini := ARRAY[v_s2_inicio, v_s3_inicio]; v_b2_turnos_fim := ARRAY[v_s2_fim, v_s3_fim]; v_b2_entradas := ARRAY[v_s2_entrada, v_s3_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida, v_s3_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno, v_s3_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida, v_s3_saida];
                v_b2_cat := CASE WHEN v_s2_cat IN ('Regular', 'Plantão') THEN v_s2_cat ELSE v_s3_cat END;
                v_b2_int_ini := COALESCE(v_s2_int_ini_min, v_s3_int_ini_min); v_b2_int_fim := COALESCE(v_s2_int_fim_min, v_s3_int_fim_min); v_b2_permite_int := COALESCE(v_s2_permite_int, v_s3_permite_int, false);
            ELSE
                v_blocks_count := 3;
                v_b2_inicio := v_s2_inicio; v_b2_fim := v_s2_fim; v_b2_ids := ARRAY[v_s2_id]; v_b2_turnos_ini := ARRAY[v_s2_inicio]; v_b2_turnos_fim := ARRAY[v_s2_fim]; v_b2_entradas := ARRAY[v_s2_entrada]; v_b2_int_saidas := ARRAY[v_s2_int_saida]; v_b2_int_retornos := ARRAY[v_s2_int_retorno]; v_b2_saidas := ARRAY[v_s2_saida]; v_b2_cat := v_s2_cat; v_b2_int_ini := v_s2_int_ini_min; v_b2_int_fim := v_s2_int_fim_min; v_b2_permite_int := v_s2_permite_int;
                v_b3_inicio := v_s3_inicio; v_b3_fim := v_s3_fim; v_b3_ids := ARRAY[v_s3_id]; v_b3_turnos_ini := ARRAY[v_s3_inicio]; v_b3_turnos_fim := ARRAY[v_s3_fim]; v_b3_entradas := ARRAY[v_s3_entrada]; v_b3_int_saidas := ARRAY[v_s3_int_saida]; v_b3_int_retornos := ARRAY[v_s3_int_retorno]; v_b3_saidas := ARRAY[v_s3_saida]; v_b3_cat := v_s3_cat; v_b3_int_ini := v_s3_int_ini_min; v_b3_int_fim := v_s3_int_fim_min; v_b3_permite_int := v_s3_permite_int;
            END IF;
        END IF;
    END IF;

-- ============================================================================
-- FIM DA REGIAO COPIADA
-- ============================================================================

    -- Emite os blocos como linhas. Minutos desde a meia-noite viram timestamptz na data
    -- pedida; valores acima de 1440 atravessam a meia-noite naturalmente via make_interval.
    IF v_blocks_count >= 1 THEN
        bloco_ordem               := 1;
        escala_diaria_ids         := v_b1_ids;
        categoria                 := v_b1_cat;
        inicio_previsto           := (p_data::timestamp + make_interval(mins => v_b1_inicio)) AT TIME ZONE v_timezone;
        fim_previsto              := (p_data::timestamp + make_interval(mins => v_b1_fim))    AT TIME ZONE v_timezone;
        permite_intervalo         := COALESCE(v_b1_permite_int, false);
        intervalo_inicio_previsto := CASE WHEN COALESCE(v_b1_permite_int, false) AND v_b1_int_ini IS NOT NULL
                                          THEN (p_data::timestamp + make_interval(mins => v_b1_int_ini)) AT TIME ZONE v_timezone END;
        intervalo_fim_previsto    := CASE WHEN COALESCE(v_b1_permite_int, false) AND v_b1_int_fim IS NOT NULL
                                          THEN (p_data::timestamp + make_interval(mins => v_b1_int_fim)) AT TIME ZONE v_timezone END;
        turnos_inicio             := ARRAY(SELECT (p_data::timestamp + make_interval(mins => x.v)) AT TIME ZONE v_timezone
                                             FROM unnest(v_b1_turnos_ini) WITH ORDINALITY AS x(v, ord) ORDER BY x.ord);
        turnos_fim                := ARRAY(SELECT (p_data::timestamp + make_interval(mins => x.v)) AT TIME ZONE v_timezone
                                             FROM unnest(v_b1_turnos_fim) WITH ORDINALITY AS x(v, ord) ORDER BY x.ord);
        RETURN NEXT;
    END IF;

    IF v_blocks_count >= 2 THEN
        bloco_ordem               := 2;
        escala_diaria_ids         := v_b2_ids;
        categoria                 := v_b2_cat;
        inicio_previsto           := (p_data::timestamp + make_interval(mins => v_b2_inicio)) AT TIME ZONE v_timezone;
        fim_previsto              := (p_data::timestamp + make_interval(mins => v_b2_fim))    AT TIME ZONE v_timezone;
        permite_intervalo         := COALESCE(v_b2_permite_int, false);
        intervalo_inicio_previsto := CASE WHEN COALESCE(v_b2_permite_int, false) AND v_b2_int_ini IS NOT NULL
                                          THEN (p_data::timestamp + make_interval(mins => v_b2_int_ini)) AT TIME ZONE v_timezone END;
        intervalo_fim_previsto    := CASE WHEN COALESCE(v_b2_permite_int, false) AND v_b2_int_fim IS NOT NULL
                                          THEN (p_data::timestamp + make_interval(mins => v_b2_int_fim)) AT TIME ZONE v_timezone END;
        turnos_inicio             := ARRAY(SELECT (p_data::timestamp + make_interval(mins => x.v)) AT TIME ZONE v_timezone
                                             FROM unnest(v_b2_turnos_ini) WITH ORDINALITY AS x(v, ord) ORDER BY x.ord);
        turnos_fim                := ARRAY(SELECT (p_data::timestamp + make_interval(mins => x.v)) AT TIME ZONE v_timezone
                                             FROM unnest(v_b2_turnos_fim) WITH ORDINALITY AS x(v, ord) ORDER BY x.ord);
        RETURN NEXT;
    END IF;

    IF v_blocks_count >= 3 THEN
        bloco_ordem               := 3;
        escala_diaria_ids         := v_b3_ids;
        categoria                 := v_b3_cat;
        inicio_previsto           := (p_data::timestamp + make_interval(mins => v_b3_inicio)) AT TIME ZONE v_timezone;
        fim_previsto              := (p_data::timestamp + make_interval(mins => v_b3_fim))    AT TIME ZONE v_timezone;
        permite_intervalo         := COALESCE(v_b3_permite_int, false);
        intervalo_inicio_previsto := CASE WHEN COALESCE(v_b3_permite_int, false) AND v_b3_int_ini IS NOT NULL
                                          THEN (p_data::timestamp + make_interval(mins => v_b3_int_ini)) AT TIME ZONE v_timezone END;
        intervalo_fim_previsto    := CASE WHEN COALESCE(v_b3_permite_int, false) AND v_b3_int_fim IS NOT NULL
                                          THEN (p_data::timestamp + make_interval(mins => v_b3_int_fim)) AT TIME ZONE v_timezone END;
        turnos_inicio             := ARRAY(SELECT (p_data::timestamp + make_interval(mins => x.v)) AT TIME ZONE v_timezone
                                             FROM unnest(v_b3_turnos_ini) WITH ORDINALITY AS x(v, ord) ORDER BY x.ord);
        turnos_fim                := ARRAY(SELECT (p_data::timestamp + make_interval(mins => x.v)) AT TIME ZONE v_timezone
                                             FROM unnest(v_b3_turnos_fim) WITH ORDINALITY AS x(v, ord) ORDER BY x.ord);
        RETURN NEXT;
    END IF;

    RETURN;
END;
$fnbloco$;

COMMENT ON FUNCTION public.fn_blocos_previstos_dia(uuid, date) IS
    'Blocos de trabalho previstos de um servidor num dia, com janela de intervalo (sempre '
    'dentro do turno) e o previsto de cada turno fundido (turnos_inicio/turnos_fim), que e onde '
    'mora a batida de transicao. Corpo copiado mecanicamente de fn_confirmar_presenca - regerar '
    'pelo script, nunca editar a mao. Sobreaviso fica de fora por construcao.';

GRANT EXECUTE ON FUNCTION public.fn_blocos_previstos_dia(uuid, date) TO authenticated, service_role;


-- ============================================================================
-- fn_confirmar_presenca_manual - copia de 20260809000000 + a resolucao por fonte unica
--
-- Ela NAO estava em 20260819220000: a versao vigente dela e mais antiga que a das outras duas.
-- Corrigir so o lado do terminal deixaria a validacao manual do coordenador ainda gravando
-- 2 passos num plantao de 12h, e dizendo "Jornada de 6h nao possui intervalo intrajornada" -
-- afirmacao falsa sobre um dia de 12h.
-- ============================================================================

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
    -- Resolvido (fonte unica); os dois crus vem do SELECT abaixo. Ver 20260822120000.
    v_intervalo_minutos INTEGER;
    v_jornada_intervalo_minutos INTEGER;
    v_turno_intervalo_minutos INTEGER;
    
    v_jornada_parsed BOOLEAN := false;
    v_jornada_end INTEGER;
    v_duration INTEGER;
    
    v_start_timestamp_local TIMESTAMP;
    v_end_timestamp_local TIMESTAMP;
    v_target_timestamp TIMESTAMP WITH TIME ZONE;
    v_existing_entrada TIMESTAMP WITH TIME ZONE;
    v_existing_saida_int TIMESTAMP WITH TIME ZONE;
    v_motivo_log TEXT;

    -- Horarios previstos de cada passo e as batidas reais recusadas correspondentes.
    v_tem_intervalo BOOLEAN;
    v_permite_marca_intervalo BOOLEAN;
    v_prev_entrada TIMESTAMP WITH TIME ZONE;
    v_prev_int_saida TIMESTAMP WITH TIME ZONE;
    v_prev_int_retorno TIMESTAMP WITH TIME ZONE;
    v_prev_saida TIMESTAMP WITH TIME ZONE;
    v_real_entrada TIMESTAMP WITH TIME ZONE;
    v_real_int_saida TIMESTAMP WITH TIME ZONE;
    v_real_int_retorno TIMESTAMP WITH TIME ZONE;
    v_real_saida TIMESTAMP WITH TIME ZONE;
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
        -- Os DOIS cadastros, CRUS. Resolvidos por fn_intervalo_previsto_minutos logo depois
        -- do calculo de v_end_timestamp_local, que e quem sabe a duracao efetiva do turno.
        -- Ver 20260822120000. NAO voltar a resolver aqui.
        j.intervalo_minutos as jornada_intervalo_minutos,
        dt.intervalo_minutos as turno_intervalo_minutos,
        COALESCE(
            -- NIVEL 1 da cadeia de precedencia de horario (o mais alto). Ver
            -- docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md
            --
            -- Hora que o COORDENADOR informou ao escalar. E o unico nivel capaz de resolver os
            -- codigos em que o codigo do turno da a duracao e o periodo, mas nao a hora:
            -- T4, N4, N6, M7 ("M2 sao 2h em qualquer ponto da manha").
            --
            -- NULL por padrao em toda linha existente, entao nao muda NADA ate alguem preencher.
            --
            -- NAO vale para Regular: la o nome da jornada continua mandando, e mexer nisso
            -- afetaria folha de ponto e motor de compliance. NAO REMOVER ESTA CONDICAO.
            CASE WHEN ed.categoria <> 'Regular'
                 THEN extract(hour from ed.hora_inicio_prevista)::integer END,
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
                    -- NIVEL 2 da cadeia de precedencia de horario. Ver
                    -- docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md
                    --
                    -- Ancora fixa do codigo do turno (M, T, N, MT). Devolve NULL para os outros 60
                    -- codigos, entao a cascata abaixo continua valendo sem nenhuma mudanca.
                    --
                    -- SO VALE QUANDO NAO HA TURNO REGULAR NO DIA. Havendo Regular, o plantao e
                    -- sequencia do expediente e o alinhamento da cascata esta correto - forcar a
                    -- ancora ali sobreporia o plantao ao turno Regular (medido em 49 dias reais de
                    -- producao em 08/08/2026). NAO REMOVER ESTA CONDICAO.
                    -- NIVEL 2-A da cadeia de precedencia. Ver
                    -- docs/planos/2026-08-09-plantao-diurno-em-jornada-noturna.md
                    --
                    -- ESPELHO DA JORNADA NOTURNA. Quando o Regular do dia CRUZA A MEIA-NOITE
                    -- (18H AS 06H), o plantao de periodo diurno NAO e sequencia do expediente:
                    -- ele vem ANTES dele. A cascata legada alinhava o plantao pelo INICIO da
                    -- jornada (18:00) e o sobrepunha inteiro ao Regular. A ancora correta e o
                    -- FIM da jornada - a "manha" de quem faz noite comeca quando a noite dela
                    -- terminaria (06:00).
                    --
                    -- Vale so para slots[1] em (M, T), o codigo que declara o periodo. Codigo de
                    -- duracao livre (slots[1] numerico) continua resolvendo pelo NIVEL 1, acima.
                    -- Fica ACIMA do nivel 2 porque a ancora fixa do dicionario (MT = 07:00) nao
                    -- conhece a jornada do servidor e erraria por uma hora.
                    CASE WHEN COALESCE(dt.slots[1], '') IN ('M', 'T')
                              AND (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer
                                < (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'start_hour')::integer
                         THEN (public.fn_obter_horario_regular_dia(em.id, ed.dia)->>'end_hour')::integer END,
                    CASE WHEN public.fn_obter_horario_regular_dia(em.id, ed.dia) IS NULL
                         THEN extract(hour from dt.horario_inicio)::integer END,
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
                WHERE em.id = p_escala_mensal_id AND ed.dia = p_dia AND ed.categoria = p_categoria::public.escala_categoria
                LIMIT 1
            ),
            7
        ) as start_hour
    INTO v_horas_computadas, v_slots, v_horas_totais, v_turno_codigo, v_jornada_nome, v_jornada_intervalo_minutos, v_turno_intervalo_minutos, v_start_hour
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
    LEFT JOIN public.jornadas j ON j.id = public.obter_jornada_servidor_data(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
    WHERE em.id = p_escala_mensal_id AND ed.dia = p_dia AND ed.categoria = p_categoria::public.escala_categoria
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

    -- Intervalo previsto DESTE turno. FONTE UNICA (20260822120000): Regular le a jornada,
    -- Plantao/Extra le o dicionario de turnos, e os dois passam pelo piso legal do Art. 71
    -- caput aplicado sobre a DURACAO EFETIVA calculada acima - a mesma duracao que o guard
    -- v_tem_intervalo usa, para os dois nunca discordarem.
    v_intervalo_minutos := public.fn_intervalo_previsto_minutos(
        p_categoria,
        (EXTRACT(EPOCH FROM (v_end_timestamp_local - v_start_timestamp_local)) / 60)::integer,
        v_jornada_intervalo_minutos,
        v_turno_intervalo_minutos);

    -- Horarios previstos de cada passo. Servem para gravar o horario sintetico E para
    -- localizar, em logs_tentativas_presenca, a batida real que foi recusada por bug.
    v_prev_entrada     := v_start_timestamp_local AT TIME ZONE v_timezone;
    v_prev_saida       := v_end_timestamp_local AT TIME ZONE v_timezone;
    v_prev_int_saida   := (v_start_timestamp_local + (4 || ' hours')::interval) AT TIME ZONE v_timezone;
    v_prev_int_retorno := v_prev_int_saida + (COALESCE(v_intervalo_minutos, 60) || ' minutes')::interval;

    -- Espelha exatamente a condicao que ScaleGrid.tsx usa para desenhar 4 segmentos em vez
    -- de 2 (isUnitInterval). Gravar intervalo fora dela produziria dado invisivel na grade.
    --   1. so Regular e Plantao tem os passos de intervalo;
    --   2. a unidade precisa permitir a marcacao;
    --   3. CLT Art. 71: jornada de ate 6h nao tem intervalo.
    -- A duracao sai do horario efetivo calculado acima, e nao de v_horas_totais: para
    -- Plantao e Extra, v_horas_totais e da jornada Regular do servidor e nao descreve a
    -- duracao do turno (ver CLAUDE.md, regra de intervalo intrajornada).
    SELECT COALESCE(u.permite_marca_intervalo, false)
      INTO v_permite_marca_intervalo
      FROM public.unidades u
     WHERE u.id = v_unidade_id;

    v_tem_intervalo := p_categoria IN ('Regular', 'Plantão')
        AND COALESCE(v_permite_marca_intervalo, false)
        AND COALESCE(public.fn_jornada_tem_intervalo(
                (EXTRACT(EPOCH FROM (v_end_timestamp_local - v_start_timestamp_local)) / 60)::integer,
                v_intervalo_minutos), false);

    -- Batida real recusada tem precedencia sobre o horario sintetico (CLAUDE.md armadilha 7).
    -- Sobreaviso nao entra: nao marca presenca e nunca usou o terminal.
    IF p_categoria <> 'Sobreaviso' THEN
        SELECT r.entrada, r.int_saida, r.int_retorno, r.saida
          INTO v_real_entrada, v_real_int_saida, v_real_int_retorno, v_real_saida
          FROM public.fn_batidas_reais_recusadas(
                   v_servidor_id, v_prev_entrada, v_prev_int_saida,
                   v_prev_int_retorno, v_prev_saida, v_tem_intervalo) r;
    END IF;

    -- Update presence based on scope
    IF p_categoria = 'Sobreaviso' THEN
        -- Sobreaviso NAO marca presenca em escala_diaria.
        -- O registro de chegada e feito exclusivamente em logs_sobreaviso (secao 4 abaixo).
        v_motivo_log := 'Validação Manual (Sobreaviso)';

    ELSIF p_tipo = 'completo' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = COALESCE(presenca_entrada_em, v_real_entrada, v_prev_entrada),
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            presenca_intervalo_saida_em = CASE WHEN v_tem_intervalo
                THEN COALESCE(presenca_intervalo_saida_em, v_real_int_saida, v_prev_int_saida)
                ELSE presenca_intervalo_saida_em END,
            presenca_intervalo_saida_manual = CASE WHEN v_tem_intervalo AND presenca_intervalo_saida_em IS NULL
                THEN true ELSE presenca_intervalo_saida_manual END,
            presenca_intervalo_retorno_em = CASE WHEN v_tem_intervalo
                THEN COALESCE(presenca_intervalo_retorno_em, v_real_int_retorno, v_prev_int_retorno)
                ELSE presenca_intervalo_retorno_em END,
            presenca_intervalo_retorno_manual = CASE WHEN v_tem_intervalo AND presenca_intervalo_retorno_em IS NULL
                THEN true ELSE presenca_intervalo_retorno_manual END,
            presenca_saida_em = COALESCE(presenca_saida_em, v_real_saida, v_prev_saida),
            presenca_saida_manual = CASE WHEN presenca_saida_em IS NULL THEN true ELSE presenca_saida_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Dia Completo)';

    ELSIF p_tipo = 'entrada' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = COALESCE(presenca_entrada_em, v_real_entrada, v_prev_entrada),
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Entrada / 1º Turno)';

    ELSIF p_tipo = 'saida' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_saida_em = COALESCE(presenca_saida_em, v_real_saida, v_prev_saida),
            presenca_saida_manual = CASE WHEN presenca_saida_em IS NULL THEN true ELSE presenca_saida_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Saída / 2º Turno)';

    ELSIF p_tipo = 'periodo_1' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = COALESCE(presenca_entrada_em, v_real_entrada, v_prev_entrada),
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            presenca_intervalo_saida_em = CASE WHEN v_tem_intervalo
                THEN COALESCE(presenca_intervalo_saida_em, v_real_int_saida, v_prev_int_saida)
                ELSE presenca_intervalo_saida_em END,
            presenca_intervalo_saida_manual = CASE WHEN v_tem_intervalo AND presenca_intervalo_saida_em IS NULL
                THEN true ELSE presenca_intervalo_saida_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (1º Período / Entrada Tarde/Noite)';

    ELSIF p_tipo = 'periodo_2' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_intervalo_retorno_em = CASE WHEN v_tem_intervalo
                THEN COALESCE(presenca_intervalo_retorno_em, v_real_int_retorno, v_prev_int_retorno)
                ELSE presenca_intervalo_retorno_em END,
            presenca_intervalo_retorno_manual = CASE WHEN v_tem_intervalo AND presenca_intervalo_retorno_em IS NULL
                THEN true ELSE presenca_intervalo_retorno_manual END,
            presenca_saida_em = COALESCE(presenca_saida_em, v_real_saida, v_prev_saida),
            presenca_saida_manual = CASE WHEN presenca_saida_em IS NULL THEN true ELSE presenca_saida_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (2º Período / Saída Tarde/Noite)';

    ELSIF p_tipo = 'intervalo_saida' THEN
        -- GUARD: trabalho continuo de ate 6h nao possui intervalo intrajornada (CLT Art. 71,
        -- caput). A duracao e a do TURNO, nao a da jornada Regular do servidor - ver
        -- v_intervalo_minutos acima e 20260822120000.
        -- Cobre tambem fn_confirmar_presenca_manual_bulk, que delega para esta funcao.
        IF NOT v_tem_intervalo THEN
            RETURN jsonb_build_object('success', false, 'message',
                'Turno de ' || ROUND(EXTRACT(EPOCH FROM (v_end_timestamp_local - v_start_timestamp_local)) / 3600)::text ||
                'h não possui intervalo intrajornada — a regra vale acima de 6h (CLT Art. 71, caput).');
        END IF;

        UPDATE public.escala_diaria
        SET presenca_intervalo_saida_em = COALESCE(presenca_intervalo_saida_em, v_real_int_saida, v_prev_int_saida),
            presenca_intervalo_saida_manual = CASE WHEN presenca_intervalo_saida_em IS NULL THEN true ELSE presenca_intervalo_saida_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Saída Intervalo)';

    ELSIF p_tipo = 'intervalo_retorno' THEN
        -- GUARD: trabalho continuo de ate 6h nao possui intervalo intrajornada (CLT Art. 71,
        -- caput). A duracao e a do TURNO, nao a da jornada Regular do servidor - ver
        -- v_intervalo_minutos acima e 20260822120000.
        IF NOT v_tem_intervalo THEN
            RETURN jsonb_build_object('success', false, 'message',
                'Turno de ' || ROUND(EXTRACT(EPOCH FROM (v_end_timestamp_local - v_start_timestamp_local)) / 3600)::text ||
                'h não possui intervalo intrajornada — a regra vale acima de 6h (CLT Art. 71, caput).');
        END IF;

        SELECT presenca_entrada_em, presenca_intervalo_saida_em INTO v_existing_entrada, v_existing_saida_int
        FROM public.escala_diaria
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;

        v_target_timestamp := (v_start_timestamp_local + (5 || ' hours')::interval) AT TIME ZONE v_timezone;

        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = COALESCE(v_existing_entrada, (v_start_timestamp_local + (5 || ' hours')::interval) AT TIME ZONE v_timezone),
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            presenca_intervalo_retorno_em = COALESCE(presenca_intervalo_retorno_em, v_real_int_retorno, v_target_timestamp),
            presenca_intervalo_retorno_manual = CASE WHEN presenca_intervalo_retorno_em IS NULL THEN true ELSE presenca_intervalo_retorno_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
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
