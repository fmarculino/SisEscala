-- Migration: Corrige comparacao enum x text em fn_confirmar_presenca_manual
-- Data: 2026-08-07
--
-- SINTOMA
--   Ao validar presenca manualmente pela grade, o coordenador recebia:
--     ERROR: operator does not exist: escala_categoria = text
--   A validacao manual (individual e em massa) ficou inteiramente quebrada.
--
-- CAUSA
--   escala_diaria.categoria e do tipo enum public.escala_categoria, enquanto o parametro
--   da funcao e p_categoria text. Postgres nao tem operador = entre enum e text.
--   Ate 20260804050000_fix_shift_t_12h_jornada_start.sql a comparacao usava o cast
--   p_categoria::public.escala_categoria. Ao recriar a funcao inteira em
--   20260804080000_fix_shift_n_18h_jornada_start.sql o cast foi perdido, e a regressao se
--   propagou por copia para 20260806000000, 20260807000000, 20260807020000 e 20260807050000.
--
--   E a terceira regressao originada em 20260804080000 (as outras duas: alinhamento
--   dinamico de hora extra e guard de intervalo). Ver CLAUDE.md armadilha 1.
--
--   Nao houve erro de build nem de deploy porque plpgsql so resolve operadores em tempo
--   de execucao do statement.
--
-- CORRECAO
--   Todas as 10 comparacoes passam a usar p_categoria::public.escala_categoria, que e a
--   forma ja adotada em fn_confirmar_presenca_manual_bulk (20260804020000). O cast no
--   parametro (e nao na coluna) preserva o uso de indice sobre categoria.
--
--   fn_confirmar_presenca_manual_bulk apenas delega para esta funcao, entao nao precisa
--   ser recriada: corrigir aqui corrige a validacao em massa junto.
--
--   fn_reverter_presenca_manual nao foi afetada: sua ultima definicao e
--   20260804040000_fix_manual_presence_overloads.sql, que usa categoria::text = p_categoria.
--
-- ATENCAO AO RECRIAR ESTA FUNCAO NO FUTURO
--   Preserve os casts ::public.escala_categoria, o guard de Sobreaviso (que nao escreve em
--   escala_diaria) e o alinhamento de start_hour pela jornada. Ver CLAUDE.md armadilha 1.
--
-- Baseada em: 20260807050000_support_flexible_interval_per_servidor.sql
--   (copia literal do bloco da funcao manual, com substituicao pontual do operador)
--
-- CONFERENCIA APOS APLICAR
--   Deve retornar 0 linhas (nenhuma comparacao sem cast sobrevivendo):
--
--   SELECT p.proname
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname LIKE 'fn_confirmar_presenca%'
--      AND p.prosrc ~ 'categoria = p_categoria([^:]|$)';

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
                WHERE em.id = p_escala_mensal_id AND ed.dia = p_dia AND ed.categoria = p_categoria::public.escala_categoria
                LIMIT 1
            ),
            7
        ) as start_hour
    INTO v_horas_computadas, v_slots, v_horas_totais, v_turno_codigo, v_jornada_nome, v_intervalo_minutos, v_start_hour
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

    -- Update presence based on scope
    IF p_categoria = 'Sobreaviso' THEN
        -- Sobreaviso NAO marca presenca em escala_diaria.
        -- O registro de chegada e feito exclusivamente em logs_sobreaviso (secao 4 abaixo).
        v_motivo_log := 'Validação Manual (Sobreaviso)';

    ELSIF p_tipo = 'completo' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = v_start_timestamp_local AT TIME ZONE v_timezone,
            presenca_saida_em = v_end_timestamp_local AT TIME ZONE v_timezone,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Dia Completo)';

    ELSIF p_tipo = 'entrada' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = v_start_timestamp_local AT TIME ZONE v_timezone,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Entrada / 1º Turno)';

    ELSIF p_tipo = 'saida' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_saida_em = v_end_timestamp_local AT TIME ZONE v_timezone,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Saída / 2º Turno)';

    ELSIF p_tipo = 'periodo_1' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = v_start_timestamp_local AT TIME ZONE v_timezone,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (1º Período / Entrada Tarde/Noite)';

    ELSIF p_tipo = 'periodo_2' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_saida_em = v_end_timestamp_local AT TIME ZONE v_timezone,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
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
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Saída Intervalo)';

    ELSIF p_tipo = 'intervalo_retorno' THEN
        -- GUARD: jornadas de ate 6h nao possuem intervalo intrajornada (CLT Art. 71).
        IF NOT public.fn_jornada_tem_intervalo((COALESCE(v_horas_totais, 0) * 60)::integer, v_intervalo_minutos) THEN
            RETURN jsonb_build_object('success', false, 'message',
                'Jornada de ' || COALESCE(v_horas_totais::text, '?') || 'h nao possui intervalo intrajornada.');
        END IF;

        SELECT presenca_entrada_em, presenca_intervalo_saida_em INTO v_existing_entrada, v_existing_saida_int
        FROM public.escala_diaria
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;

        v_target_timestamp := (v_start_timestamp_local + (5 || ' hours')::interval) AT TIME ZONE v_timezone;

        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = COALESCE(v_existing_entrada, (v_start_timestamp_local + (5 || ' hours')::interval) AT TIME ZONE v_timezone),
            presenca_intervalo_retorno_em = v_target_timestamp,
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
