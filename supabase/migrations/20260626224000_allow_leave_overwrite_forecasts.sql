-- Migration: Allow Leave Overwrite Forecasts
-- Description: Updates the database trigger functions to only prevent registering/updating leave when the daily scale is confirmed or contains presence records. Otherwise, allow automatic replacement of forecasts.

-- 1. UPDATE FUNCTION public.fn_prevent_event_during_shift
CREATE OR REPLACE FUNCTION public.fn_prevent_event_during_shift()
RETURNS trigger AS $$
DECLARE
    v_has_confirmed_scale BOOLEAN;
BEGIN
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


-- 2. UPDATE FUNCTION public.fn_clean_conflicting_shifts
CREATE OR REPLACE FUNCTION public.fn_clean_conflicting_shifts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_permitir BOOLEAN;
BEGIN
  -- 1. Obter a configuração global
  SELECT COALESCE((valor#>>'{}')::boolean, false) INTO v_permitir
  FROM public.configuracoes_globais
  WHERE chave = 'permitir_plantao_extra_durante_eventos';

  -- 2. Deletar os turnos conflitantes que não possuam presença confirmada nem marcações de ponto
  IF v_permitir THEN
    -- Se for permitido, apenas limpamos as horas normais ('Regular')
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
    -- Se não for permitido, limpamos tudo
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
