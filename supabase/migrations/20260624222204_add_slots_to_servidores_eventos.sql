-- Migration: Add Slots to Servidores Eventos and Update Validations
-- Description: Adds slots column to servidores_eventos and updates functions to handle partial day absences.

-- 1. Add slots column
ALTER TABLE public.servidores_eventos ADD COLUMN IF NOT EXISTS slots TEXT[] DEFAULT NULL;

-- 2. Update fn_check_shift_conflicts to handle partial absences
CREATE OR REPLACE FUNCTION public.fn_check_shift_conflicts(
    p_servidor_id UUID,
    p_dia INTEGER,
    p_mes INTEGER,
    p_ano INTEGER,
    p_turno_id UUID,
    p_categoria TEXT DEFAULT 'Regular'
)
RETURNS TABLE(conflito BOOLEAN, mensagem TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_turno_slots TEXT[];
    v_conflito_id UUID;
    v_conflito_codigo TEXT;
    v_conflito_unidade TEXT;
    v_conflito_setor TEXT;
    v_afastamento_nome TEXT;
    v_afastamento_slots TEXT[];
    v_permitir_plantao BOOLEAN;
BEGIN
    -- 1. Buscar os slots do turno proposto
    SELECT slots INTO v_turno_slots
    FROM public.dicionario_turnos
    WHERE id = p_turno_id;

    -- 2. Verificar se o servidor possui algum afastamento/evento ativo no dia especificado que conflite nos slots
    SELECT te.nome, se.slots INTO v_afastamento_nome, v_afastamento_slots
    FROM public.servidores_eventos se
    JOIN public.tipos_eventos te ON te.id = se.tipo_evento_id
    WHERE se.servidor_id = p_servidor_id
      AND MAKE_DATE(p_ano, p_mes, p_dia) >= se.data_inicio
      AND MAKE_DATE(p_ano, p_mes, p_dia) <= se.data_fim
      AND (
        se.slots IS NULL 
        OR array_length(se.slots, 1) IS NULL
        OR se.slots && v_turno_slots
      )
    LIMIT 1;

    -- Se o servidor possuir um afastamento/evento conflitante
    IF v_afastamento_nome IS NOT NULL THEN
        SELECT COALESCE((valor#>>'{}')::boolean, false) INTO v_permitir_plantao
        FROM public.configuracoes_globais
        WHERE chave = 'permitir_plantao_extra_durante_eventos';

        IF p_categoria = 'Regular' OR NOT v_permitir_plantao THEN
            RETURN QUERY SELECT TRUE, format('Servidor está em afastamento/evento (%s)%s.', 
                v_afastamento_nome,
                CASE 
                    WHEN v_afastamento_slots IS NOT NULL THEN format(' no período: %s', array_to_string(v_afastamento_slots, ', '))
                    ELSE ''
                END
            );
            RETURN;
        END IF;
    END IF;

    -- 3. Verificar conflito de escala diária existente (mesmo dia, outra unidade/setor, slots sobrepostos)
    SELECT 
        ed.id, 
        dt.codigo, 
        u.nome, 
        ds.nome
    INTO 
        v_conflito_id, 
        v_conflito_codigo, 
        v_conflito_unidade, 
        v_conflito_setor
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
    JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
    JOIN public.unidades u ON u.id = em.unidade_id
    JOIN public.setores s ON s.id = em.setor_id
    JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id
    WHERE em.servidor_id = p_servidor_id
      AND em.mes = p_mes
      AND em.ano = p_ano
      AND ed.dia = p_dia
      AND dt.slots && v_turno_slots
    LIMIT 1;

    IF v_conflito_id IS NOT NULL THEN
        RETURN QUERY SELECT TRUE, format('Conflito com o turno %s no setor %s (%s).', v_conflito_codigo, v_conflito_setor, v_conflito_unidade);
        RETURN;
    END IF;

    RETURN QUERY SELECT FALSE, ''::text;
END;
$function$;

-- 3. Update fn_prevent_shift_during_event trigger function
CREATE OR REPLACE FUNCTION public.fn_prevent_shift_during_event()
RETURNS trigger AS $$
DECLARE
    v_servidor_id UUID;
    v_mes INT;
    v_ano INT;
    v_afastamento_nome TEXT;
    v_permitir_plantao BOOLEAN;
    v_shift_date DATE;
    v_turno_slots TEXT[];
BEGIN
    SELECT servidor_id, mes, ano INTO v_servidor_id, v_mes, v_ano
    FROM public.escala_mensal
    WHERE id = NEW.escala_mensal_id;

    IF v_servidor_id IS NULL THEN
        RETURN NEW;
    END IF;

    v_shift_date := MAKE_DATE(v_ano, v_mes, NEW.dia);

    -- Buscar slots do turno sendo agendado
    SELECT slots INTO v_turno_slots
    FROM public.dicionario_turnos
    WHERE id = NEW.dicionario_turnos_id;

    -- Verificar se o servidor possui algum afastamento ativo e que coincida nos slots
    SELECT te.nome INTO v_afastamento_nome
    FROM public.servidores_eventos se
    JOIN public.tipos_eventos te ON te.id = se.tipo_evento_id
    WHERE se.servidor_id = v_servidor_id
      AND v_shift_date >= se.data_inicio
      AND v_shift_date <= se.data_fim
      AND (
        se.slots IS NULL 
        OR array_length(se.slots, 1) IS NULL
        OR se.slots && v_turno_slots
      )
    LIMIT 1;

    IF v_afastamento_nome IS NOT NULL THEN
        SELECT COALESCE((valor#>>'{}')::boolean, false) INTO v_permitir_plantao
        FROM public.configuracoes_globais
        WHERE chave = 'permitir_plantao_extra_durante_eventos';

        IF NEW.categoria = 'Regular' OR NOT v_permitir_plantao THEN
            RAISE EXCEPTION 'Não é permitido escalar o servidor no dia % pois ele está em afastamento/evento (%s).', NEW.dia, v_afastamento_nome;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. Update fn_prevent_event_during_shift trigger function
CREATE OR REPLACE FUNCTION public.fn_prevent_event_during_shift()
RETURNS trigger AS $$
DECLARE
    v_has_scale BOOLEAN;
BEGIN
    -- Verificar se o servidor possui escala prevista no período do afastamento que coincida nos slots
    SELECT EXISTS (
        SELECT 1
        FROM public.escala_diaria ed
        JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
        JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
        WHERE em.servidor_id = NEW.servidor_id
          AND MAKE_DATE(em.ano, em.mes, ed.dia) >= NEW.data_inicio
          AND MAKE_DATE(em.ano, em.mes, ed.dia) <= NEW.data_fim
          AND (
            NEW.slots IS NULL
            OR array_length(NEW.slots, 1) IS NULL
            OR dt.slots && NEW.slots
          )
    ) INTO v_has_scale;

    IF v_has_scale THEN
        RAISE EXCEPTION 'Não é permitido cadastrar afastamento neste período pois o servidor possui escala prevista ou confirmada incompatível com o horário do afastamento.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Update fn_prevent_overlapping_event trigger function
CREATE OR REPLACE FUNCTION public.fn_prevent_overlapping_event()
RETURNS trigger AS $$
DECLARE
    v_has_overlap BOOLEAN;
BEGIN
    -- Verificar se existe outro evento sobreposto para o mesmo servidor no mesmo período de horário
    SELECT EXISTS (
        SELECT 1
        FROM public.servidores_eventos se
        WHERE se.servidor_id = NEW.servidor_id
          AND (TG_OP = 'INSERT' OR se.id != NEW.id)
          AND (NEW.data_inicio <= se.data_fim AND NEW.data_fim >= se.data_inicio)
          AND (
            NEW.slots IS NULL OR array_length(NEW.slots, 1) IS NULL
            OR se.slots IS NULL OR array_length(se.slots, 1) IS NULL
            OR NEW.slots && se.slots
          )
    ) INTO v_has_overlap;

    IF v_has_overlap THEN
        RAISE EXCEPTION 'Não é permitido cadastrar afastamento neste período pois o servidor já possui outro afastamento ativo no mesmo horário.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6. Update fn_clean_conflicting_shifts trigger function
CREATE OR REPLACE FUNCTION public.fn_clean_conflicting_shifts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 AS $function$
DECLARE
  v_permitir BOOLEAN;
BEGIN
  SELECT COALESCE((valor#>>'{}')::boolean, false) INTO v_permitir
  FROM public.configuracoes_globais
  WHERE chave = 'permitir_plantao_extra_durante_eventos';

  IF v_permitir THEN
    DELETE FROM public.escala_diaria ed
    USING public.escala_mensal em, public.dicionario_turnos dt
    WHERE ed.escala_mensal_id = em.id
      AND ed.dicionario_turnos_id = dt.id
      AND em.servidor_id = NEW.servidor_id
      AND MAKE_DATE(em.ano, em.mes, ed.dia) >= NEW.data_inicio
      AND MAKE_DATE(em.ano, em.mes, ed.dia) <= NEW.data_fim
      AND ed.categoria = 'Regular'
      AND ed.presenca_entrada_em IS NULL
      AND ed.presenca_saida_em IS NULL
      AND (
        NEW.slots IS NULL
        OR array_length(NEW.slots, 1) IS NULL
        OR dt.slots && NEW.slots
      );
  ELSE
    DELETE FROM public.escala_diaria ed
    USING public.escala_mensal em, public.dicionario_turnos dt
    WHERE ed.escala_mensal_id = em.id
      AND ed.dicionario_turnos_id = dt.id
      AND em.servidor_id = NEW.servidor_id
      AND MAKE_DATE(em.ano, em.mes, ed.dia) >= NEW.data_inicio
      AND MAKE_DATE(em.ano, em.mes, ed.dia) <= NEW.data_fim
      AND ed.presenca_entrada_em IS NULL
      AND ed.presenca_saida_em IS NULL
      AND (
        NEW.slots IS NULL
        OR array_length(NEW.slots, 1) IS NULL
        OR dt.slots && NEW.slots
      );
  END IF;

  RETURN NEW;
END;
$function$;
