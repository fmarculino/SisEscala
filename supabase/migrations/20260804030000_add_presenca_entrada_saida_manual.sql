-- Migration: Add missing presenca_entrada_manual and presenca_saida_manual columns to escala_diaria and fix function overloading
-- Description: Adds presenca_entrada_manual and presenca_saida_manual columns to escala_diaria, drops old 5-parameter overloaded function, and updates fn_confirmar_presenca_manual and fn_reverter_presenca_manual.

-- 1. ADD MISSING COLUMNS TO ESCALA_DIARIA
ALTER TABLE public.escala_diaria 
ADD COLUMN IF NOT EXISTS presenca_entrada_manual BOOLEAN DEFAULT FALSE;

ALTER TABLE public.escala_diaria 
ADD COLUMN IF NOT EXISTS presenca_saida_manual BOOLEAN DEFAULT FALSE;

-- 2. DROP OLD OVERLOADED FUNCTION (5-parameter version causing PGRST203 ambiguity)
DROP FUNCTION IF EXISTS public.fn_confirmar_presenca_manual(uuid, integer, text, text, uuid);

-- 3. RECREATE 6-PARAMETER FUNCTION WITH JUSTIFICATIVA DEFAULT NULL
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
            CASE WHEN ed.categoria = 'Regular' THEN substring(j.nome from '^([0-9]+)')::integer ELSE NULL END,
            CASE 
              WHEN dt.codigo = 'T4' THEN 14
              WHEN dt.slots[1] ~ '^[0-9]+$' THEN dt.slots[1]::integer
              WHEN dt.slots[1] = 'M' THEN 7
              WHEN dt.slots[1] = 'T' THEN 13
              WHEN dt.slots[1] = 'N' THEN 19
              ELSE 7
            END
        ) as start_hour,
        ed.presenca_entrada_em,
        ed.presenca_intervalo_saida_em
    INTO 
        v_horas_computadas, v_slots, v_horas_totais, v_turno_codigo, v_jornada_nome, v_intervalo_minutos, v_start_hour, v_existing_entrada, v_existing_saida_int
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
    LEFT JOIN public.jornadas j ON j.id = public.obter_jornada_servidor_data(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
    WHERE em.id = p_escala_mensal_id
      AND ed.dia = p_dia
      AND ed.categoria = p_categoria::public.escala_categoria;

    IF v_start_hour IS NULL THEN
        v_start_hour := 7;
    END IF;

    -- 4. Calculate target local timestamp based on p_tipo
    IF p_tipo = 'entrada' THEN
        v_start_timestamp_local := make_timestamp(v_ano, v_mes, p_dia, v_start_hour, 0, 0);
        v_target_timestamp := v_start_timestamp_local AT TIME ZONE v_timezone;
        
        UPDATE public.escala_diaria
        SET presenca_entrada_em = COALESCE(presenca_entrada_em, v_target_timestamp),
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            confirmado_por_id = p_validador_id,
            presenca_confirmada = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;

    ELSIF p_tipo = 'intervalo_saida' THEN
        v_start_timestamp_local := make_timestamp(v_ano, v_mes, p_dia, v_start_hour + 4, 0, 0);
        v_target_timestamp := v_start_timestamp_local AT TIME ZONE v_timezone;
        
        UPDATE public.escala_diaria
        SET presenca_intervalo_saida_em = COALESCE(presenca_intervalo_saida_em, v_target_timestamp),
            presenca_intervalo_saida_manual = CASE WHEN presenca_intervalo_saida_em IS NULL THEN true ELSE presenca_intervalo_saida_manual END,
            confirmado_por_id = p_validador_id,
            presenca_confirmada = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;

    ELSIF p_tipo = 'intervalo_retorno' THEN
        IF v_existing_saida_int IS NOT NULL THEN
            v_target_timestamp := v_existing_saida_int + (v_intervalo_minutos || ' minutes')::interval;
        ELSE
            v_start_timestamp_local := make_timestamp(v_ano, v_mes, p_dia, v_start_hour + 4, 0, 0) + (v_intervalo_minutos || ' minutes')::interval;
            v_target_timestamp := v_start_timestamp_local AT TIME ZONE v_timezone;
        END IF;
        
        UPDATE public.escala_diaria
        SET presenca_intervalo_retorno_em = COALESCE(presenca_intervalo_retorno_em, v_target_timestamp),
            presenca_intervalo_retorno_manual = CASE WHEN presenca_intervalo_retorno_em IS NULL THEN true ELSE presenca_intervalo_retorno_manual END,
            confirmado_por_id = p_validador_id,
            presenca_confirmada = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
    ELSIF p_tipo = 'saida' THEN
        v_start_timestamp_local := make_timestamp(v_ano, v_mes, p_dia, v_start_hour, 0, 0);
        
        IF v_jornada_nome IS NOT NULL AND p_categoria = 'Regular' AND substring(v_jornada_nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer IS NOT NULL THEN
            v_jornada_end := substring(v_jornada_nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer;
            IF v_jornada_end < v_start_hour THEN
                v_end_timestamp_local := make_timestamp(v_ano, v_mes, p_dia, v_jornada_end, 0, 0) + interval '1 day';
            ELSE
                v_end_timestamp_local := make_timestamp(v_ano, v_mes, p_dia, v_jornada_end, 0, 0);
            END IF;
        ELSE
            v_duration := CASE 
                WHEN p_categoria = 'Regular' AND v_horas_totais IS NOT NULL AND v_horas_totais > 0 THEN v_horas_totais 
                ELSE COALESCE(v_horas_computadas, 0) 
            END;
            v_end_timestamp_local := v_start_timestamp_local + (v_duration || ' hours')::interval;
        END IF;
        
        v_target_timestamp := v_end_timestamp_local AT TIME ZONE v_timezone;
        
        UPDATE public.escala_diaria
        SET presenca_saida_em = COALESCE(presenca_saida_em, v_target_timestamp),
            presenca_saida_manual = CASE WHEN presenca_saida_em IS NULL THEN true ELSE presenca_saida_manual END,
            confirmado_por_id = p_validador_id,
            presenca_confirmada = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
    ELSIF p_tipo = 'completo' THEN
        v_start_timestamp_local := make_timestamp(v_ano, v_mes, p_dia, v_start_hour, 0, 0);
        
        IF v_jornada_nome IS NOT NULL AND p_categoria = 'Regular' AND substring(v_jornada_nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer IS NOT NULL THEN
            v_jornada_end := substring(v_jornada_nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer;
            IF v_jornada_end < v_start_hour THEN
                v_end_timestamp_local := make_timestamp(v_ano, v_mes, p_dia, v_jornada_end, 0, 0) + interval '1 day';
            ELSE
                v_end_timestamp_local := make_timestamp(v_ano, v_mes, p_dia, v_jornada_end, 0, 0);
            END IF;
        ELSE
            v_duration := CASE 
                WHEN p_categoria = 'Regular' AND v_horas_totais IS NOT NULL AND v_horas_totais > 0 THEN v_horas_totais 
                ELSE COALESCE(v_horas_computadas, 0) 
            END;
            v_end_timestamp_local := v_start_timestamp_local + (v_duration || ' hours')::interval;
        END IF;
        
        v_target_timestamp := v_start_timestamp_local AT TIME ZONE v_timezone;
        
        UPDATE public.escala_diaria
        SET presenca_entrada_em = COALESCE(presenca_entrada_em, v_target_timestamp),
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            presenca_intervalo_saida_em = COALESCE(presenca_intervalo_saida_em, (make_timestamp(v_ano, v_mes, p_dia, v_start_hour + 4, 0, 0)) AT TIME ZONE v_timezone),
            presenca_intervalo_saida_manual = CASE WHEN presenca_intervalo_saida_em IS NULL THEN true ELSE presenca_intervalo_saida_manual END,
            presenca_intervalo_retorno_em = COALESCE(presenca_intervalo_retorno_em, (make_timestamp(v_ano, v_mes, p_dia, v_start_hour + 4, 0, 0) + (v_intervalo_minutos || ' minutes')::interval) AT TIME ZONE v_timezone),
            presenca_intervalo_retorno_manual = CASE WHEN presenca_intervalo_retorno_em IS NULL THEN true ELSE presenca_intervalo_retorno_manual END,
            presenca_saida_em = COALESCE(presenca_saida_em, v_end_timestamp_local AT TIME ZONE v_timezone),
            presenca_saida_manual = CASE WHEN presenca_saida_em IS NULL THEN true ELSE presenca_saida_manual END,
            confirmado_por_id = p_validador_id,
            presenca_confirmada = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;

    ELSIF p_tipo = 'periodo_1' THEN
        v_start_timestamp_local := make_timestamp(v_ano, v_mes, p_dia, v_start_hour, 0, 0);
        v_target_timestamp := v_start_timestamp_local AT TIME ZONE v_timezone;
        
        UPDATE public.escala_diaria
        SET presenca_entrada_em = COALESCE(presenca_entrada_em, v_target_timestamp),
            presenca_entrada_manual = CASE WHEN presenca_entrada_em IS NULL THEN true ELSE presenca_entrada_manual END,
            presenca_intervalo_saida_em = COALESCE(presenca_intervalo_saida_em, (make_timestamp(v_ano, v_mes, p_dia, v_start_hour + 4, 0, 0)) AT TIME ZONE v_timezone),
            presenca_intervalo_saida_manual = CASE WHEN presenca_intervalo_saida_em IS NULL THEN true ELSE presenca_intervalo_saida_manual END,
            confirmado_por_id = p_validador_id,
            presenca_confirmada = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;

    ELSIF p_tipo = 'periodo_2' THEN
        v_start_timestamp_local := make_timestamp(v_ano, v_mes, p_dia, v_start_hour, 0, 0);
        
        IF v_jornada_nome IS NOT NULL AND p_categoria = 'Regular' AND substring(v_jornada_nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer IS NOT NULL THEN
            v_jornada_end := substring(v_jornada_nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')::integer;
            IF v_jornada_end < v_start_hour THEN
                v_end_timestamp_local := make_timestamp(v_ano, v_mes, p_dia, v_jornada_end, 0, 0) + interval '1 day';
            ELSE
                v_end_timestamp_local := make_timestamp(v_ano, v_mes, p_dia, v_jornada_end, 0, 0);
            END IF;
        ELSE
            v_duration := CASE 
                WHEN p_categoria = 'Regular' AND v_horas_totais IS NOT NULL AND v_horas_totais > 0 THEN v_horas_totais 
                ELSE COALESCE(v_horas_computadas, 0) 
            END;
            v_end_timestamp_local := v_start_timestamp_local + (v_duration || ' hours')::interval;
        END IF;

        UPDATE public.escala_diaria
        SET presenca_intervalo_retorno_em = COALESCE(presenca_intervalo_retorno_em, (make_timestamp(v_ano, v_mes, p_dia, v_start_hour + 4, 0, 0) + (v_intervalo_minutos || ' minutes')::interval) AT TIME ZONE v_timezone),
            presenca_intervalo_retorno_manual = CASE WHEN presenca_intervalo_retorno_em IS NULL THEN true ELSE presenca_intervalo_retorno_manual END,
            presenca_saida_em = COALESCE(presenca_saida_em, v_end_timestamp_local AT TIME ZONE v_timezone),
            presenca_saida_manual = CASE WHEN presenca_saida_em IS NULL THEN true ELSE presenca_saida_manual END,
            confirmado_por_id = p_validador_id,
            presenca_confirmada = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;

    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'Tipo de validação inválido.');
    END IF;

    -- 5. Insert log record ONLY for Sobreaviso category
    IF p_categoria = 'Sobreaviso' THEN
        v_motivo_log := 'Validação Manual (' || p_categoria || ' - ' || p_tipo || ')';
        IF p_justificativa IS NOT NULL AND trim(p_justificativa) <> '' THEN
            v_motivo_log := v_motivo_log || ' - Justificativa: ' || trim(p_justificativa);
        END IF;

        UPDATE public.logs_sobreaviso
        SET status = 'Chegou',
            data_hora_chegada = COALESCE(v_target_timestamp, now()),
            data_hora_validacao = now(),
            validacao_manual = true,
            validado_por = p_validador_id,
            motivo_acionamento = v_motivo_log,
            tipo_validacao_chegada = 'Manual'
        WHERE servidor_id = v_servidor_id 
          AND escala_mensal_id = p_escala_mensal_id 
          AND dia = p_dia;

        IF NOT FOUND THEN
            INSERT INTO public.logs_sobreaviso (
                servidor_id, unidade_id, escala_mensal_id, dia,
                data_hora_acionamento, data_hora_chegada, data_hora_validacao, validacao_manual,
                validado_por, status, motivo_acionamento, tipo_validacao_chegada, categoria
            ) VALUES (
                v_servidor_id, v_unidade_id, p_escala_mensal_id, p_dia,
                COALESCE(v_target_timestamp, now()), COALESCE(v_target_timestamp, now()), now(), true, p_validador_id, 'Chegou',
                v_motivo_log, 'Manual', 'Sobreaviso'
            );
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'message', 'Presença validada manualmente com sucesso.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. RECREATE fn_reverter_presenca_manual WITH PROPER MANUAL RESET
CREATE OR REPLACE FUNCTION public.fn_reverter_presenca_manual(
    p_escala_mensal_id uuid,
    p_dia integer,
    p_categoria text,
    p_tipo text,
    p_validador_id uuid
)
RETURNS jsonb AS $$
DECLARE
    v_servidor_id UUID;
    v_unidade_id UUID;
BEGIN
    SELECT servidor_id, unidade_id INTO v_servidor_id, v_unidade_id
    FROM public.escala_mensal WHERE id = p_escala_mensal_id;

    IF p_tipo = 'entrada' THEN
        UPDATE public.escala_diaria
        SET presenca_entrada_em = NULL, presenca_entrada_manual = false
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
    ELSIF p_tipo = 'intervalo_saida' THEN
        UPDATE public.escala_diaria
        SET presenca_intervalo_saida_em = NULL, presenca_intervalo_saida_manual = false
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
    ELSIF p_tipo = 'intervalo_retorno' THEN
        UPDATE public.escala_diaria
        SET presenca_intervalo_retorno_em = NULL, presenca_intervalo_retorno_manual = false
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
    ELSIF p_tipo = 'saida' THEN
        UPDATE public.escala_diaria
        SET presenca_saida_em = NULL, presenca_saida_manual = false
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'Tipo de reversão inválido.');
    END IF;

    -- Update presenca_confirmada to false if all times are NULL
    UPDATE public.escala_diaria
    SET presenca_confirmada = false, confirmado_por_id = NULL
    WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria
      AND presenca_entrada_em IS NULL AND presenca_intervalo_saida_em IS NULL 
      AND presenca_intervalo_retorno_em IS NULL AND presenca_saida_em IS NULL;

    RETURN jsonb_build_object('success', true, 'message', 'Presença revertida com sucesso.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
