-- Migration: Validacao manual volta a marcar as flags _manual e para de sobrescrever batida real
-- Data: 2026-08-07
--
-- CONTEXTO
--   Terceira e quarta quebras originadas em 20260804080000_fix_shift_n_18h_jornada_start.sql,
--   encontradas ao investigar o erro "operator does not exist: escala_categoria = text"
--   (corrigido em 20260807060000) e a ausencia das colunas de auditoria (20260807070000).
--
-- QUEBRA 3 - flags _manual deixaram de ser gravadas
--   Ate 20260804050000 cada passo marcava sua flag correspondente
--   (presenca_entrada_manual, presenca_saida_manual, presenca_intervalo_saida_manual,
--   presenca_intervalo_retorno_manual). A partir de 20260804080000 nenhuma delas e escrita.
--   ScaleGrid.tsx usa essas flags para diferenciar horario sintetico de batida de terminal:
--
--     is_entrada_manual:          ed.presenca_entrada_manual ?? !!ed.confirmado_por_id
--     is_intervalo_saida_manual:  !!ed.presenca_intervalo_saida_manual
--
--   Entrada e saida tem fallback por confirmado_por_id, mas as DUAS flags de intervalo nao
--   tem: um intervalo validado manualmente apareceria na grade como batida real.
--
-- QUEBRA 4 - validacao manual sobrescrevia batida real (a mais grave)
--   20260804050000 gravava COALESCE(presenca_entrada_em, <sintetico>), preservando a batida
--   ja existente. 20260804080000 passou a atribuir o horario sintetico direto, sem COALESCE.
--   Validar "Dia Completo" para quem ja bateu o ponto substituiria a batida real por um
--   horario redondo derivado da jornada - exatamente o que CLAUDE.md armadilha 5 proibe.
--
--   NENHUM DADO FOI CORROMPIDO. As quebras 1 e 2 abortavam a funcao antes de qualquer
--   UPDATE, entao a validacao manual nunca chegou a executar desde 04/08/2026. Por isso
--   esta migration precisa ser aplicada JUNTO com 20260807070000: criar as colunas sem
--   corrigir o COALESCE destravaria a funcao no estado em que ela destroi batidas reais.
--
-- O QUE NAO MUDA
--   Os passos 'completo' e 'periodo_1' continuam SEM gravar marcas de intervalo. Isso e
--   intencional e nao deve ser revertido: a gravacao automatica de intervalo produziu 31
--   marcacoes indevidas em jornadas de ate 6h, limpas em 20260806010000 (CLT Art. 71).
--
--   Tambem permanecem intactos o cast ::public.escala_categoria (20260807060000), o guard
--   fn_jornada_tem_intervalo, o guard de Sobreaviso que nao escreve em escala_diaria
--   (20260807020000) e o alinhamento de start_hour pela jornada.
--
-- COMO ESTE ARQUIVO FOI GERADO
--   Copia literal de 20260807060000 com 9 substituicoes pontuais aplicadas por script, com
--   contagem de ocorrencias verificada e conferida por diff. O corpo nao foi redigitado.
--   Ver CLAUDE.md armadilha 1.
--
-- CONFERENCIA APOS APLICAR
--   Validar um passo manual e confirmar que a flag correspondente ficou true e que uma
--   batida real pre-existente nao foi alterada:
--
--   SELECT dia, presenca_entrada_em, presenca_entrada_manual,
--          presenca_intervalo_saida_em, presenca_intervalo_saida_manual,
--          presenca_saida_em, presenca_saida_manual, justificativa_manual
--     FROM escala_diaria
--    WHERE escala_mensal_id = '<uuid>' AND dia = <dia>;

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
            presenca_entrada_em = COALESCE(presenca_entrada_em, v_start_timestamp_local AT TIME ZONE v_timezone),
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            presenca_saida_em = COALESCE(presenca_saida_em, v_end_timestamp_local AT TIME ZONE v_timezone),
            presenca_saida_manual = CASE WHEN presenca_saida_em IS NULL THEN true ELSE presenca_saida_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Dia Completo)';

    ELSIF p_tipo = 'entrada' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = COALESCE(presenca_entrada_em, v_start_timestamp_local AT TIME ZONE v_timezone),
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Entrada / 1º Turno)';

    ELSIF p_tipo = 'saida' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_saida_em = COALESCE(presenca_saida_em, v_end_timestamp_local AT TIME ZONE v_timezone),
            presenca_saida_manual = CASE WHEN presenca_saida_em IS NULL THEN true ELSE presenca_saida_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (Saída / 2º Turno)';

    ELSIF p_tipo = 'periodo_1' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_entrada_em = COALESCE(presenca_entrada_em, v_start_timestamp_local AT TIME ZONE v_timezone),
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            confirmado_por_id = p_validador_id,
            justificativa_manual = p_justificativa,
            confirmacao_manual = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
        v_motivo_log := 'Validação Manual (1º Período / Entrada Tarde/Noite)';

    ELSIF p_tipo = 'periodo_2' THEN
        UPDATE public.escala_diaria
        SET presenca_confirmada = true,
            presenca_saida_em = COALESCE(presenca_saida_em, v_end_timestamp_local AT TIME ZONE v_timezone),
            presenca_saida_manual = CASE WHEN presenca_saida_em IS NULL THEN true ELSE presenca_saida_manual END,
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
        SET presenca_intervalo_saida_em = COALESCE(presenca_intervalo_saida_em, (v_start_timestamp_local + (4 || ' hours')::interval) AT TIME ZONE v_timezone),
            presenca_intervalo_saida_manual = CASE WHEN presenca_intervalo_saida_em IS NULL THEN true ELSE presenca_intervalo_saida_manual END,
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
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            presenca_intervalo_retorno_em = COALESCE(presenca_intervalo_retorno_em, v_target_timestamp),
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
