-- Migration: Adiciona suporte a afastamento/declaração de comparecimento por horas
-- Description: Permite o registro de ausências parciais por horário em servidores_eventos sem apagar ou bloquear a escala do dia.

-- 1. Adicionar colunas na tabela servidores_eventos
ALTER TABLE public.servidores_eventos
ADD COLUMN IF NOT EXISTS periodo_tipo TEXT DEFAULT 'integral',
ADD COLUMN IF NOT EXISTS hora_inicio TIME WITHOUT TIME ZONE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS hora_fim TIME WITHOUT TIME ZONE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS minutos_afastamento INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS regime_abono TEXT DEFAULT 'abonado';

-- 2. Atualizar fn_check_shift_conflicts para ignorar afastamentos por horas como bloqueio total de escala
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
    -- Afastamentos por horas (periodo_tipo = 'horas') não bloqueiam a inclusão do turno na escala
    SELECT te.nome, se.slots INTO v_afastamento_nome, v_afastamento_slots
    FROM public.servidores_eventos se
    JOIN public.tipos_eventos te ON te.id = se.tipo_evento_id
    WHERE se.servidor_id = p_servidor_id
      AND MAKE_DATE(p_ano, p_mes, p_dia) >= se.data_inicio
      AND MAKE_DATE(p_ano, p_mes, p_dia) <= se.data_fim
      AND COALESCE(se.periodo_tipo, 'integral') <> 'horas'
      AND se.hora_inicio IS NULL
      AND (
        se.slots IS NULL 
        OR array_length(se.slots, 1) IS NULL
        OR se.slots && v_turno_slots
      )
    LIMIT 1;

    -- Se o servidor possuir um afastamento/evento integral ou por slot conflitante
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

-- 3. Atualizar fn_prevent_shift_during_event para ignorar eventos por horas
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

    -- Verificar se o servidor possui algum afastamento integral ou de slot ativo
    SELECT te.nome INTO v_afastamento_nome
    FROM public.servidores_eventos se
    JOIN public.tipos_eventos te ON te.id = se.tipo_evento_id
    WHERE se.servidor_id = v_servidor_id
      AND v_shift_date >= se.data_inicio
      AND v_shift_date <= se.data_fim
      AND COALESCE(se.periodo_tipo, 'integral') <> 'horas'
      AND se.hora_inicio IS NULL
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

-- 4. Atualizar fn_prevent_event_during_shift para permitir cadastrar atestado de horas em dias com escala
CREATE OR REPLACE FUNCTION public.fn_prevent_event_during_shift()
RETURNS trigger AS $$
DECLARE
    v_has_confirmed_scale BOOLEAN;
BEGIN
    -- Se o afastamento for por horário / horas (ex: declaração de comparecimento), permite lançamento sem restrição
    IF COALESCE(NEW.periodo_tipo, 'integral') = 'horas' OR NEW.hora_inicio IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Verificar se o servidor possui alguma escala CONFIRMADA ou com MARCAÇÕES no período do afastamento
    SELECT EXISTS (
        SELECT 1
        FROM public.escala_diaria ed
        JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
        WHERE em.servidor_id = NEW.servidor_id
          AND MAKE_DATE(em.ano, em.mes, ed.dia) >= NEW.data_inicio
          AND MAKE_DATE(em.ano, em.mes, ed.dia) <= NEW.data_fim
          AND (
            ed.presenca_entrada_em IS NOT NULL
            OR ed.presenca_saida_em IS NOT NULL
            OR ed.presenca_confirmada = true
            OR ed.confirmado_por_id IS NOT NULL
          )
    ) INTO v_has_confirmed_scale;

    IF v_has_confirmed_scale THEN
        RAISE EXCEPTION 'Não é permitido cadastrar afastamento/férias neste período pois o servidor possui escala confirmada ou com presença registrada na grade.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Atualizar fn_clean_conflicting_shifts para NÃO deletar escala quando o afastamento for por horas
CREATE OR REPLACE FUNCTION public.fn_clean_conflicting_shifts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_permitir BOOLEAN;
BEGIN
  -- Se for afastamento por horas (ex: declaração de comparecimento), o servidor continua escalado
  IF COALESCE(NEW.periodo_tipo, 'integral') = 'horas' OR NEW.hora_inicio IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 1. Obter a configuração global
  SELECT COALESCE((valor#>>'{}')::boolean, false) INTO v_permitir
  FROM public.configuracoes_globais
  WHERE chave = 'permitir_plantao_extra_durante_eventos';

  -- 2. Deletar os turnos conflitantes que não possuam presença confirmada nem marcações de ponto
  IF v_permitir THEN
    DELETE FROM public.escala_diaria ed
    USING public.escala_mensal em
    WHERE ed.escala_mensal_id = em.id
      AND em.servidor_id = NEW.servidor_id
      AND MAKE_DATE(em.ano, em.mes, ed.dia) >= NEW.data_inicio
      AND MAKE_DATE(em.ano, em.mes, ed.dia) <= NEW.data_fim
      AND ed.categoria = 'Regular'
      AND ed.presenca_entrada_em IS NULL
      AND ed.presenca_saida_em IS NULL
      AND ed.presenca_confirmada = false
      AND ed.confirmado_por_id IS NULL;
  ELSE
    DELETE FROM public.escala_diaria ed
    USING public.escala_mensal em
    WHERE ed.escala_mensal_id = em.id
      AND em.servidor_id = NEW.servidor_id
      AND MAKE_DATE(em.ano, em.mes, ed.dia) >= NEW.data_inicio
      AND MAKE_DATE(em.ano, em.mes, ed.dia) <= NEW.data_fim
      AND ed.presenca_entrada_em IS NULL
      AND ed.presenca_saida_em IS NULL
      AND ed.presenca_confirmada = false
      AND ed.confirmado_por_id IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- 6. Atualizar fn_prevent_overlapping_event para permitir múltiplos eventos por horas sem sobreposição horária
CREATE OR REPLACE FUNCTION public.fn_prevent_overlapping_event()
RETURNS trigger AS $$
DECLARE
    v_has_overlap BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM public.servidores_eventos se
        WHERE se.servidor_id = NEW.servidor_id
          AND (TG_OP = 'INSERT' OR se.id != NEW.id)
          AND (NEW.data_inicio <= se.data_fim AND NEW.data_fim >= se.data_inicio)
          AND (
            -- Ambos são por horas: colidem apenas se os intervalos horários se sobrepuserem
            CASE 
              WHEN (COALESCE(NEW.periodo_tipo, 'integral') = 'horas' OR NEW.hora_inicio IS NOT NULL) 
               AND (COALESCE(se.periodo_tipo, 'integral') = 'horas' OR se.hora_inicio IS NOT NULL) THEN
                (NEW.hora_inicio < se.hora_fim AND NEW.hora_fim > se.hora_inicio)
              -- Um é integral e outro por horas ou slots
              WHEN (COALESCE(NEW.periodo_tipo, 'integral') = 'horas' OR NEW.hora_inicio IS NOT NULL) 
                OR (COALESCE(se.periodo_tipo, 'integral') = 'horas' OR se.hora_inicio IS NOT NULL) THEN
                TRUE
              -- Ambos por slots ou integral
              ELSE
                (
                  NEW.slots IS NULL OR array_length(NEW.slots, 1) IS NULL
                  OR se.slots IS NULL OR array_length(se.slots, 1) IS NULL
                  OR NEW.slots && se.slots
                )
            END
          )
    ) INTO v_has_overlap;

    IF v_has_overlap THEN
        RAISE EXCEPTION 'Não é permitido cadastrar afastamento neste período pois o servidor já possui outro afastamento ativo no mesmo horário.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
