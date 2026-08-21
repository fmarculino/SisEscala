-- Migration: Block all scale categories during leave
-- Description: Sobreaviso passa a ser bloqueado em dia de afastamento junto com Regular. A
-- configuracao global permitir_plantao_extra_durante_eventos continua valendo, mas apenas
-- para Plantao e Extra - que e o que o nome dela sempre disse. Corrige tambem o format do
-- RAISE de fn_prevent_shift_during_event, que imprimia um 's' solto colado ao nome do
-- afastamento ('%s' onde plpgsql so entende '%').
--
-- Copia mecanica de 20260817210000_add_afastamento_por_horas.sql via
-- scratchpad/gen_afastamento_categorias.js. Nao editar a mao.
--
-- Medido em producao em 20/08/2026 antes de aplicar: 2.340 linhas de escala_diaria de
-- servidores com afastamento, 131 afastamentos na base, ZERO linhas gravadas dentro de
-- afastamento bloqueante em qualquer categoria. Nenhuma linha existente passa a violar a
-- regra nova, entao o trigger nao quebra UPDATE de linha ja gravada.

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

        -- Sobreaviso entra ao lado de Regular: a configuracao chama-se
        -- "permitir plantao e extra durante eventos" e nunca foi sobre sobreaviso.
        IF p_categoria IN ('Regular', 'Sobreaviso') OR NOT v_permitir_plantao THEN
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

        IF NEW.categoria IN ('Regular', 'Sobreaviso') OR NOT v_permitir_plantao THEN
            RAISE EXCEPTION 'Nao e permitido escalar o servidor no dia % pois ele esta em afastamento/evento (%).', NEW.dia, v_afastamento_nome;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
      AND ed.categoria IN ('Regular', 'Sobreaviso')
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

-- Reafirma o gatilho. Ele existe desde 20260601130000, mas repeti-lo aqui torna a
-- migration autossuficiente: em um ambiente sem o gatilho instalado as funcoes acima
-- nao valeriam nada em escala_diaria.
DROP TRIGGER IF EXISTS trigger_prevent_shift_during_event ON public.escala_diaria;
CREATE TRIGGER trigger_prevent_shift_during_event
BEFORE INSERT OR UPDATE ON public.escala_diaria
FOR EACH ROW
EXECUTE FUNCTION public.fn_prevent_shift_during_event();
