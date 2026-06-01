-- Migration: Prevent Scale and Leave Conflicts
-- Description: Creates triggers to prevent registering leaves when there are scheduled scales, and vice-versa.

-- =========================================================================
-- 1. TRIGGER TO PREVENT EVENT (LEAVE) WHEN SHIFT IS SCHEDULED
-- =========================================================================

CREATE OR REPLACE FUNCTION public.fn_prevent_event_during_shift()
RETURNS trigger AS $$
DECLARE
    v_has_scale BOOLEAN;
    v_conflito_data DATE;
    v_conflito_turno TEXT;
BEGIN
    -- Verificar se o servidor possui alguma escala prevista no período do afastamento
    SELECT EXISTS (
        SELECT 1
        FROM public.escala_diaria ed
        JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
        WHERE em.servidor_id = NEW.servidor_id
          AND MAKE_DATE(em.ano, em.mes, ed.dia) >= NEW.data_inicio
          AND MAKE_DATE(em.ano, em.mes, ed.dia) <= NEW.data_fim
    ) INTO v_has_scale;

    IF v_has_scale THEN
        RAISE EXCEPTION 'Não é permitido cadastrar afastamento/férias neste período pois o servidor possui escala prevista ou confirmada na grade.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Apply trigger before insert or update on public.servidores_eventos
DROP TRIGGER IF EXISTS trigger_prevent_event_during_shift ON public.servidores_eventos;
CREATE TRIGGER trigger_prevent_event_during_shift
BEFORE INSERT OR UPDATE ON public.servidores_eventos
FOR EACH ROW
EXECUTE FUNCTION public.fn_prevent_event_during_shift();


-- =========================================================================
-- 2. TRIGGER TO PREVENT SHIFT WHEN EVENT (LEAVE) IS ACTIVE
-- =========================================================================

CREATE OR REPLACE FUNCTION public.fn_prevent_shift_during_event()
RETURNS trigger AS $$
DECLARE
    v_servidor_id UUID;
    v_mes INT;
    v_ano INT;
    v_afastamento_nome TEXT;
    v_permitir_plantao BOOLEAN;
    v_shift_date DATE;
BEGIN
    -- Obter o servidor_id, mes e ano a partir da escala_mensal
    SELECT servidor_id, mes, ano INTO v_servidor_id, v_mes, v_ano
    FROM public.escala_mensal
    WHERE id = NEW.escala_mensal_id;

    IF v_servidor_id IS NULL THEN
        RETURN NEW;
    END IF;

    v_shift_date := MAKE_DATE(v_ano, v_mes, NEW.dia);

    -- Verificar se o servidor possui algum afastamento/evento ativo nesse dia
    SELECT te.nome INTO v_afastamento_nome
    FROM public.servidores_eventos se
    JOIN public.tipos_eventos te ON te.id = se.tipo_evento_id
    WHERE se.servidor_id = v_servidor_id
      AND v_shift_date >= se.data_inicio
      AND v_shift_date <= se.data_fim
    LIMIT 1;

    -- Se o servidor possuir um afastamento nesse dia, validar
    IF v_afastamento_nome IS NOT NULL THEN
        -- Obter a configuração global se permite plantões ou horas extras
        SELECT COALESCE((valor#>>'{}')::boolean, false) INTO v_permitir_plantao
        FROM public.configuracoes_globais
        WHERE chave = 'permitir_plantao_extra_durante_eventos';

        -- Se for categoria Regular, ou se for qualquer outra categoria mas não permitir plantão
        IF NEW.categoria = 'Regular' OR NOT v_permitir_plantao THEN
            RAISE EXCEPTION 'Não é permitido escalar o servidor no dia % pois ele está em afastamento/evento (%s).', NEW.dia, v_afastamento_nome;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Apply trigger before insert or update on public.escala_diaria
DROP TRIGGER IF EXISTS trigger_prevent_shift_during_event ON public.escala_diaria;
CREATE TRIGGER trigger_prevent_shift_during_event
BEFORE INSERT OR UPDATE ON public.escala_diaria
FOR EACH ROW
EXECUTE FUNCTION public.fn_prevent_shift_during_event();
