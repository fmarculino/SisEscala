-- Migration: Add Interval Presence Support (Flexivel vs Rigido) per Unit
-- Description: Adds interval settings to unidades, jornadas, servidores, and escala_diaria. Updates fn_confirmar_presenca_manual and fn_reverter_presenca_manual.

-- 1. ADD COLUMNS TO UNIDADES
ALTER TABLE public.unidades 
ADD COLUMN IF NOT EXISTS permite_marca_intervalo BOOLEAN DEFAULT FALSE NOT NULL;

ALTER TABLE public.unidades 
ADD COLUMN IF NOT EXISTS tipo_intervalo TEXT DEFAULT 'flexivel';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unidades_tipo_intervalo_check'
    ) THEN
        ALTER TABLE public.unidades ADD CONSTRAINT unidades_tipo_intervalo_check CHECK (tipo_intervalo IN ('flexivel', 'rigido'));
    END IF;
END $$;

ALTER TABLE public.unidades 
ADD COLUMN IF NOT EXISTS tolerancia_intervalo_minutos INTEGER DEFAULT 5 NOT NULL;

-- 2. ADD COLUMNS TO JORNADAS
ALTER TABLE public.jornadas 
ADD COLUMN IF NOT EXISTS intervalo_inicio_padrao TIME NULL;

ALTER TABLE public.jornadas 
ADD COLUMN IF NOT EXISTS intervalo_fim_padrao TIME NULL;

-- 3. ADD COLUMNS TO SERVIDORES
ALTER TABLE public.servidores 
ADD COLUMN IF NOT EXISTS intervalo_inicio_personalizado TIME NULL;

ALTER TABLE public.servidores 
ADD COLUMN IF NOT EXISTS intervalo_fim_personalizado TIME NULL;

-- 4. ADD COLUMNS TO ESCALA_DIARIA
ALTER TABLE public.escala_diaria 
ADD COLUMN IF NOT EXISTS presenca_intervalo_saida_em TIMESTAMP WITH TIME ZONE NULL;

ALTER TABLE public.escala_diaria 
ADD COLUMN IF NOT EXISTS presenca_intervalo_retorno_em TIMESTAMP WITH TIME ZONE NULL;

ALTER TABLE public.escala_diaria 
ADD COLUMN IF NOT EXISTS intervalo_nao_usufruido BOOLEAN DEFAULT FALSE;

ALTER TABLE public.escala_diaria 
ADD COLUMN IF NOT EXISTS presenca_intervalo_saida_manual BOOLEAN DEFAULT FALSE;

ALTER TABLE public.escala_diaria 
ADD COLUMN IF NOT EXISTS presenca_intervalo_retorno_manual BOOLEAN DEFAULT FALSE;

-- 5. RECREATE fn_confirmar_presenca_manual WITH INTERVAL TYPES
CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca_manual(
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
BEGIN
    -- 1. Fetch metadata from escala_mensal
    SELECT servidor_id, unidade_id, mes, ano INTO v_servidor_id, v_unidade_id, v_mes, v_ano
    FROM public.escala_mensal
    WHERE id = p_escala_mensal_id;
    
    IF v_servidor_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Escala mensal não encontrada.');
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
        SET presenca_entrada_em = v_target_timestamp,
            confirmado_por_id = p_validador_id,
            presenca_confirmada = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;

    ELSIF p_tipo = 'intervalo_saida' THEN
        v_start_timestamp_local := make_timestamp(v_ano, v_mes, p_dia, v_start_hour + 4, 0, 0);
        v_target_timestamp := v_start_timestamp_local AT TIME ZONE v_timezone;
        
        UPDATE public.escala_diaria
        SET presenca_intervalo_saida_em = v_target_timestamp,
            presenca_intervalo_saida_manual = true,
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
        SET presenca_intervalo_retorno_em = v_target_timestamp,
            presenca_intervalo_retorno_manual = true,
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
        SET presenca_saida_em = v_target_timestamp,
            confirmado_por_id = p_validador_id,
            presenca_confirmada = true
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria = p_categoria::public.escala_categoria;
        
    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'Tipo de validação inválido.');
    END IF;

    -- 5. Insert log record
    INSERT INTO public.logs_sobreaviso (
        servidor_id, unidade_id, escala_mensal_id, dia,
        data_hora_acionamento, data_hora_validacao, validacao_manual,
        validado_por, status, motivo_acionamento, tipo_validacao_chegada, categoria
    ) VALUES (
        v_servidor_id, v_unidade_id, p_escala_mensal_id, p_dia,
        v_target_timestamp, now(), true, p_validador_id, 'Chegou',
        'Validação Manual (' || p_categoria || ' - ' || p_tipo || ')', 'Manual', p_categoria
    );

    RETURN jsonb_build_object('success', true, 'message', 'Presença validada manualmente com sucesso.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6. RECREATE fn_reverter_presenca_manual WITH INTERVAL TYPES
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
        SET presenca_entrada_em = NULL
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
        SET presenca_saida_em = NULL
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
