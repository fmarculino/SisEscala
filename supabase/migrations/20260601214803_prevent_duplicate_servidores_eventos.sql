-- Migration: Prevent Duplicate/Overlapping Servidores Eventos
-- Description: Creates a trigger to block overlapping leaves/events for the same servant.

CREATE OR REPLACE FUNCTION public.fn_prevent_overlapping_event()
RETURNS trigger AS $$
DECLARE
    v_has_overlap BOOLEAN;
BEGIN
    -- Verificar se existe outro evento sobreposto para o mesmo servidor
    SELECT EXISTS (
        SELECT 1
        FROM public.servidores_eventos se
        WHERE se.servidor_id = NEW.servidor_id
          AND (TG_OP = 'INSERT' OR se.id != NEW.id)
          AND (NEW.data_inicio <= se.data_fim AND NEW.data_fim >= se.data_inicio)
    ) INTO v_has_overlap;

    IF v_has_overlap THEN
        RAISE EXCEPTION 'Não é permitido cadastrar afastamento neste período pois o servidor já possui outro afastamento ativo.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Apply trigger before insert or update on public.servidores_eventos
DROP TRIGGER IF EXISTS trigger_prevent_overlapping_event ON public.servidores_eventos;
CREATE TRIGGER trigger_prevent_overlapping_event
BEFORE INSERT OR UPDATE ON public.servidores_eventos
FOR EACH ROW
EXECUTE FUNCTION public.fn_prevent_overlapping_event();
