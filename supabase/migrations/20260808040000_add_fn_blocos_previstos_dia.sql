-- Migration: Extrai fn_blocos_previstos_dia de fn_confirmar_presenca (Fase 2)
-- Data: 2026-08-08
--
-- OBJETIVO
--   Disponibilizar, como funcao consultavel, o calculo de "quais blocos de trabalho um servidor
--   tem previstos num dia" - hoje trancado dentro de fn_confirmar_presenca. E o conhecimento de
--   dominio mais caro do repositorio: fusao de blocos contiguos, isolamento do Sobreaviso,
--   alinhamento de Extra, jornada que cruza a meia-noite, intervalo personalizado por servidor
--   e o guard do Art. 71 da CLT.
--
--   A reconciliacao de marcacoes (proximas migrations) precisa exatamente disso: dada uma batida
--   solta do relogio, a que passo de que bloco ela pertence.
--
-- POR QUE NAO CHAMAR fn_confirmar_presenca
--   Ela e um PORTAO, nao um calculador: valida credencial, exige janela de tolerancia, loga
--   tentativa negada, escreve em escala_diaria e depende do "agora". Uma batida vinda de um REP-C
--   e retroativa e NAO PODE ser rejeitada - o registro existe independentemente de encaixar na
--   escala. Essa e a diferenca legal entre o terminal e um REP certificado.
--
-- POR QUE DUPLICAR EM VEZ DE REFATORAR fn_confirmar_presenca AGORA
--   CLAUDE.md armadilha 1: seis regressoes reais ja aconteceram por recopiar o corpo dessa
--   funcao, cinco delas saidas de uma unica migration. O custo de errar fn_confirmar_presenca
--   (terminal de ponto parado, folha errada) e muito maior que o custo de manter duas copias
--   por alguns meses. A convergencia so acontece depois que fn_conferir_reconciliacao provar,
--   sobre meses de dados reais, que as duas concordam.
--
--   ESTA MIGRATION NAO TOCA EM fn_confirmar_presenca.
--
-- COMO ESTE CORPO FOI PRODUZIDO
--   Por copia mecanica via script (scratchpad/gen_blocos.js), conforme CLAUDE.md regra 2 -
--   nao foi redigitado. O script extrai a regiao do cursor de HOJE de 20260807050000, aplica
--   UMA substituicao (remover o bloco que loga tentativa negada, que usa parametros do terminal)
--   e aborta se qualquer contagem divergir. Foram verificados:
--     - 8 guards "<> 'Sobreaviso'" na fusao de blocos
--     - o guard public.fn_jornada_tem_intervalo(...)
--     - o filtro ed.categoria IN ('Regular', 'Plantao', 'Extra')
--     - o ORDER BY start_hour ASC
--     - o fallback de intervalo em inicio + 240 min
--   O diff entre a regiao original e a copiada esta no rodape desta migration.
--
-- ESTA MIGRATION NAO MUDA NENHUM COMPORTAMENTO
--   Cria uma funcao nova que ninguem chama ainda.

DROP FUNCTION IF EXISTS public.fn_blocos_previstos_dia(uuid, date);

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
    permite_intervalo         boolean
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
    v_s1_id UUID; v_s1_inicio INTEGER; v_s1_fim INTEGER; v_s1_entrada TIMESTAMP WITH TIME ZONE; v_s1_int_saida TIMESTAMP WITH TIME ZONE; v_s1_int_retorno TIMESTAMP WITH TIME ZONE; v_s1_saida TIMESTAMP WITH TIME ZONE; v_s1_cat TEXT; v_s1_int_ini_min INTEGER; v_s1_int_fim_min INTEGER; v_s1_permite_int BOOLEAN;
    v_s2_id UUID; v_s2_inicio INTEGER; v_s2_fim INTEGER; v_s2_entrada TIMESTAMP WITH TIME ZONE; v_s2_int_saida TIMESTAMP WITH TIME ZONE; v_s2_int_retorno TIMESTAMP WITH TIME ZONE; v_s2_saida TIMESTAMP WITH TIME ZONE; v_s2_cat TEXT; v_s2_int_ini_min INTEGER; v_s2_int_fim_min INTEGER; v_s2_permite_int BOOLEAN;
    v_s3_id UUID; v_s3_inicio INTEGER; v_s3_fim INTEGER; v_s3_entrada TIMESTAMP WITH TIME ZONE; v_s3_int_saida TIMESTAMP WITH TIME ZONE; v_s3_int_retorno TIMESTAMP WITH TIME ZONE; v_s3_saida TIMESTAMP WITH TIME ZONE; v_s3_cat TEXT; v_s3_int_ini_min INTEGER; v_s3_int_fim_min INTEGER; v_s3_permite_int BOOLEAN;

    -- Blocos contiguos resultantes da fusao (ate 3).
    v_b1_inicio INTEGER; v_b1_fim INTEGER; v_b1_ids UUID[]; v_b1_entradas TIMESTAMP WITH TIME ZONE[]; v_b1_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b1_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b1_saidas TIMESTAMP WITH TIME ZONE[]; v_b1_cat TEXT; v_b1_int_ini INTEGER; v_b1_int_fim INTEGER; v_b1_permite_int BOOLEAN;
    v_b2_inicio INTEGER; v_b2_fim INTEGER; v_b2_ids UUID[]; v_b2_entradas TIMESTAMP WITH TIME ZONE[]; v_b2_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b2_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b2_saidas TIMESTAMP WITH TIME ZONE[]; v_b2_cat TEXT; v_b2_int_ini INTEGER; v_b2_int_fim INTEGER; v_b2_permite_int BOOLEAN;
    v_b3_inicio INTEGER; v_b3_fim INTEGER; v_b3_ids UUID[]; v_b3_entradas TIMESTAMP WITH TIME ZONE[]; v_b3_int_saidas TIMESTAMP WITH TIME ZONE[]; v_b3_int_retornos TIMESTAMP WITH TIME ZONE[]; v_b3_saidas TIMESTAMP WITH TIME ZONE[]; v_b3_cat TEXT; v_b3_int_ini INTEGER; v_b3_int_fim INTEGER; v_b3_permite_int BOOLEAN;
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
        -- Sem escala no dia: nenhum bloco previsto. A funcao original logava tentativa
        -- negada aqui; esta e de consulta e apenas nao devolve linhas.
        RETURN;
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
        RETURN NEXT;
    END IF;

    RETURN;
END;
$fnbloco$;

COMMENT ON FUNCTION public.fn_blocos_previstos_dia(uuid, date) IS
    'Blocos de trabalho previstos de um servidor num dia, com janela de intervalo. Corpo copiado '
    'mecanicamente de fn_confirmar_presenca (20260807050000) - regerar pelo script, nunca editar a mao. '
    'Sobreaviso fica de fora por construcao.';

GRANT EXECUTE ON FUNCTION public.fn_blocos_previstos_dia(uuid, date) TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--
--   1) Um servidor com jornada diurna simples deve devolver 1 bloco com intervalo:
--
--   SELECT * FROM public.fn_blocos_previstos_dia(
--       (SELECT em.servidor_id FROM public.escala_mensal em
--         JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
--        WHERE em.mes = 8 AND em.ano = 2026 AND ed.categoria = 'Regular' LIMIT 1),
--       '2026-08-05'::date);
--
--   2) PORTAO - a funcao nova tem que concordar com o que o terminal ja aceitou.
--      Para toda batida de ENTRADA real registrada em 08/2026, o inicio previsto do bloco
--      correspondente deve estar a menos de uma janela de distancia. Divergencia grande
--      significa que a extracao mudou o calculo:
--
--   WITH reais AS (
--       SELECT em.servidor_id,
--              make_date(em.ano, em.mes, ed.dia) AS data,
--              ed.presenca_entrada_em
--         FROM public.escala_diaria ed
--         JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--        WHERE em.mes = 8 AND em.ano = 2026
--          AND ed.presenca_entrada_em IS NOT NULL
--          AND COALESCE(ed.presenca_entrada_manual, false) = false
--   )
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE b.inicio_previsto IS NULL) AS sem_bloco,
--          round(avg(abs(extract(epoch FROM (r.presenca_entrada_em - b.inicio_previsto)) / 60))) AS erro_medio_min,
--          max(abs(extract(epoch FROM (r.presenca_entrada_em - b.inicio_previsto)) / 60)) AS erro_max_min
--     FROM reais r
--     LEFT JOIN LATERAL (
--         SELECT inicio_previsto FROM public.fn_blocos_previstos_dia(r.servidor_id, r.data)
--          ORDER BY abs(extract(epoch FROM (r.presenca_entrada_em - inicio_previsto))) LIMIT 1
--     ) b ON true;
--
--   Esperado: sem_bloco = 0 e erro_medio_min pequeno (a batida cai perto do inicio previsto).
--   Um erro_max_min alto isolado costuma ser plantao que cruza a meia-noite - inspecione antes
--   de concluir que ha bug.
--
--   3) Sobreaviso nunca pode aparecer:
--
--   SELECT count(*) FROM (
--       SELECT (public.fn_blocos_previstos_dia(em.servidor_id, make_date(em.ano, em.mes, ed.dia))).*
--         FROM public.escala_diaria ed
--         JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--        WHERE em.mes = 8 AND em.ano = 2026 AND ed.categoria = 'Sobreaviso'
--   ) x WHERE categoria = 'Sobreaviso';
--   -- esperado: 0
