-- Migration: Afastamento parcial por slot preserva o turno do periodo trabalhado
-- Description: Um afastamento de MEIO PERIODO (slots = {M} sobre um turno MT) deixava o dia
-- inteiro em branco: fn_clean_conflicting_shifts APAGAVA a escala_diaria do dia (o DELETE nunca
-- olhou slot nenhum, so data) e fn_prevent_shift_during_event impedia relancar, porque a condicao
-- era INTERSECAO (se.slots && v_turno_slots). O periodo efetivamente trabalhado sumia da folha,
-- que imprimia "AFASTAMENTO PARCIAL: ... | FOLGA" sem horario nenhum.
--
-- Caso real (LUANA JESUS DE OLIVEIRA, mat. 52705, DMAC/SMS, 25 e 27/08/2026): DECLARACAO DE
-- COMPARECIMENTO com slots {M} sobre jornada 08H AS 18H (turno MT). Os dois dias ficaram sem
-- linha em escala_diaria e sem hora nenhuma na folha, embora ela tenha trabalhado as duas tardes.
--
-- A regra passa a ser a CONTENCAO, nao a intersecao:
--   integral (sem slots)            -> anula o turno   (inalterado)
--   slots que COBREM o turno        -> anula o turno   (inalterado)
--   slots que alcancam PARTE dele   -> PARCIAL: preserva a escala e nao bloqueia (novo)
--   slots que NAO alcancam o turno  -> nao e parcial; a limpeza continua apagando (inalterado)
--
-- ⚠️ O ultimo caso e deliberado e nao pode ser "consertado" junto. Ha Ferias e Licenca Premio
-- lancadas em producao com slots {M,T} sobre turno N (intersecao VAZIA) — uso indevido do campo,
-- mas cuja escala precisa continuar sendo apagada. Parar de apagar ali deixaria o servidor
-- escalado durante as proprias ferias.
--
-- ⚠️ A leitura e do DIA, nunca de um evento isolado: duas declaracoes de comparecimento no mesmo
-- dia (uma {M} e outra {T}, caso KETHURY CHAVES em 14/08/2026) sao parciais uma a uma e juntas
-- COBREM o turno MT. fn_afastamento_dia devolve a uniao — sem isso, o dia inteiro afastado
-- passaria como se fosse meio periodo.
--
-- 🚨 COPIA MECANICA DE DUAS FONTES, via scratchpad/gen_afastamento_parcial.js. Nao editar a mao.
--      fn_check_shift_conflicts      <- 20260821100000_conflict_check_ignores_own_cell.sql
--      fn_prevent_shift_during_event <- 20260820120000_block_all_categories_during_leave.sql
--      fn_clean_conflicting_shifts   <- 20260820120000_block_all_categories_during_leave.sql
--    A primeira versao deste gerador copiou as TRES de 20260820120000 e produziu uma migration
--    inofensiva na pratica: fn_check_shift_conflicts ganhou o 7o argumento (p_escala_mensal_id)
--    em 20260821100000, e e a de 7 que o ScaleGrid chama — a de 6 seria uma sobrecarga morta.
--    So apareceu ao aplicar em homologacao ("function is not unique").
--
-- MEDIDO EM PRODUCAO EM 04/09/2026, ANTES DE APLICAR (scratchpad/an_impacto_parcial.mjs):
--   495 servidores_eventos, 48 deles por slot, 242 pares (servidor, dia) alcancados.
--   Com a ESCALA VIVA: 0 dias em que o afastamento cobre o turno, 1 de intersecao vazia e
--   ZERO dias parciais. Ou seja: NENHUMA folha existente muda de valor com esta migration — ela
--   apenas passa a permitir o que hoje e impossivel. Os 152 dias parciais ja tiveram a escala
--   apagada e nao voltam sozinhos; relanca-los e ato do coordenador na grade.

-- ---------------------------------------------------------------------------------------------
-- 1. Fonte unica: o afastamento do DIA, e a classificacao dele contra os slots de um turno.
-- ---------------------------------------------------------------------------------------------

-- Afastamentos bloqueantes (nao por horas) que alcancam p_data, lidos em conjunto.
-- Devolve zero linhas quando nao ha nenhum. integral e verdadeiro se ALGUM deles nao tem slots.
CREATE OR REPLACE FUNCTION public.fn_afastamento_dia(
    p_servidor_id UUID,
    p_data DATE
)
RETURNS TABLE(nome TEXT, integral BOOLEAN, slots TEXT[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_nome TEXT;
    v_integral BOOLEAN := FALSE;
    v_slots TEXT[] := ARRAY[]::TEXT[];
    r RECORD;
BEGIN
    FOR r IN
        SELECT te.nome AS tipo_nome, se.slots AS ev_slots
        FROM public.servidores_eventos se
        JOIN public.tipos_eventos te ON te.id = se.tipo_evento_id
        WHERE se.servidor_id = p_servidor_id
          AND p_data >= se.data_inicio
          AND p_data <= se.data_fim
          AND COALESCE(se.periodo_tipo, 'integral') <> 'horas'
          AND se.hora_inicio IS NULL
        ORDER BY te.nome
    LOOP
        IF v_nome IS NULL THEN
            v_nome := r.tipo_nome;
        END IF;
        IF r.ev_slots IS NULL OR array_length(r.ev_slots, 1) IS NULL THEN
            v_integral := TRUE;
        ELSE
            SELECT ARRAY(SELECT DISTINCT s FROM unnest(v_slots || r.ev_slots) AS s ORDER BY s)
              INTO v_slots;
        END IF;
    END LOOP;

    IF v_nome IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY SELECT v_nome, v_integral, v_slots;
END;
$function$;

-- O afastamento ANULA este turno? Integral sempre anula; por slot, so quando COBRE todos eles.
-- Turno sem slots conhecidos nunca e anulado por afastamento de slot — igual ao operador && de
-- antes, que da falso com array vazio.
CREATE OR REPLACE FUNCTION public.fn_afastamento_anula_turno(
    p_integral BOOLEAN,
    p_slots TEXT[],
    p_turno_slots TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT CASE
        WHEN COALESCE(p_integral, FALSE) THEN TRUE
        WHEN p_turno_slots IS NULL OR array_length(p_turno_slots, 1) IS NULL THEN FALSE
        WHEN p_slots IS NULL OR array_length(p_slots, 1) IS NULL THEN FALSE
        ELSE p_turno_slots <@ p_slots
    END;
$function$;

-- O afastamento e PARCIAL neste turno? Alcanca parte dele E nao o cobre.
-- ⚠️ Intersecao VAZIA nao e parcial: e o caso das ferias lancadas com slots que nao batem com o
-- turno, e ali a limpeza de escala precisa continuar valendo.
CREATE OR REPLACE FUNCTION public.fn_afastamento_parcial_no_turno(
    p_integral BOOLEAN,
    p_slots TEXT[],
    p_turno_slots TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT CASE
        WHEN COALESCE(p_integral, FALSE) THEN FALSE
        WHEN p_turno_slots IS NULL OR array_length(p_turno_slots, 1) IS NULL THEN FALSE
        WHEN p_slots IS NULL OR array_length(p_slots, 1) IS NULL THEN FALSE
        WHEN NOT (p_slots && p_turno_slots) THEN FALSE
        ELSE NOT (p_turno_slots <@ p_slots)
    END;
$function$;

-- Armadilha 24: CREATE FUNCTION ja concede EXECUTE a PUBLIC. As tres sao chamadas apenas de
-- dentro de funcoes SECURITY DEFINER, que executam com os privilegios do dono.
REVOKE ALL ON FUNCTION public.fn_afastamento_dia(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_afastamento_anula_turno(BOOLEAN, TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_afastamento_parcial_no_turno(BOOLEAN, TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_afastamento_dia(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_afastamento_anula_turno(BOOLEAN, TEXT[], TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_afastamento_parcial_no_turno(BOOLEAN, TEXT[], TEXT[]) TO service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. fn_check_shift_conflicts — copia de 20260821100000 (a de SETE argumentos).
-- ---------------------------------------------------------------------------------------------

-- ⚠️ A sobrecarga de 6 argumentos foi derrubada por 20260821100000 e nao pode voltar: com as duas
-- vivas, a chamada do ScaleGrid fica ambigua para o PostgREST (PGRST203 / "is not unique").
-- Este DROP e defensivo — um ambiente onde ela tenha sido ressuscitada volta ao estado correto.
DROP FUNCTION IF EXISTS public.fn_check_shift_conflicts(UUID, INTEGER, INTEGER, INTEGER, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.fn_check_shift_conflicts(
    p_servidor_id UUID,
    p_dia INTEGER,
    p_mes INTEGER,
    p_ano INTEGER,
    p_turno_id UUID,
    p_categoria TEXT DEFAULT 'Regular',
    p_escala_mensal_id UUID DEFAULT NULL
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
    v_afastamento_integral BOOLEAN;
    v_permitir_plantao BOOLEAN;
BEGIN
    -- 1. Buscar os slots do turno proposto
    SELECT slots INTO v_turno_slots
    FROM public.dicionario_turnos
    WHERE id = p_turno_id;

    -- 2. Afastamento/evento do dia. Afastamento por horas (periodo_tipo = 'horas') nunca bloqueia.
    -- A leitura e do DIA INTEIRO, nunca de um evento isolado: duas declaracoes de comparecimento
    -- (uma {M} e outra {T}) sao parciais uma a uma e, JUNTAS, cobrem o turno MT.
    SELECT a.nome, a.integral, a.slots
      INTO v_afastamento_nome, v_afastamento_integral, v_afastamento_slots
    FROM public.fn_afastamento_dia(p_servidor_id, MAKE_DATE(p_ano, p_mes, p_dia)) a;

    -- So bloqueia quando o afastamento ANULA o turno: integral, ou cobrindo TODOS os slots dele.
    -- Afastamento PARCIAL ({M} sobre um turno MT) deixa o servidor escalado — ele trabalha a tarde.
    IF v_afastamento_nome IS NOT NULL
       AND public.fn_afastamento_anula_turno(v_afastamento_integral, v_afastamento_slots, v_turno_slots) THEN
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

    -- 3. Verificar conflito de escala diaria existente (mesmo dia, outra unidade/setor, slots sobrepostos)
    -- p_escala_mensal_id identifica a CELULA que esta sendo editada: (escala_mensal, categoria, dia)
    -- e exatamente a chave de uma celula da grade. Sem excluir essa linha, trocar o codigo de um
    -- turno ja salvo por outro que compartilhe qualquer slot faz a funcao conflitar a celula com
    -- ELA MESMA (medido em 21/08/2026: MT -> MT devolvia conflito). Com a remocao da celula
    -- bloqueada por presenca (Direito Adquirido), o dia com ponto registrado ficava congelado:
    -- nao dava para apagar nem para trocar. NULL preserva o comportamento antigo.
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
      AND NOT (
          p_escala_mensal_id IS NOT NULL
          AND em.id = p_escala_mensal_id
          AND ed.categoria = p_categoria::public.escala_categoria
      )
    LIMIT 1;

    IF v_conflito_id IS NOT NULL THEN
        RETURN QUERY SELECT TRUE, format('Conflito com o turno %s no setor %s (%s).', v_conflito_codigo, v_conflito_setor, v_conflito_unidade);
        RETURN;
    END IF;

    RETURN QUERY SELECT FALSE, ''::text;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_check_shift_conflicts(UUID, INTEGER, INTEGER, INTEGER, UUID, TEXT, UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. Os dois gatilhos de afastamento — copia de 20260820120000.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_prevent_shift_during_event()
RETURNS trigger AS $$
DECLARE
    v_servidor_id UUID;
    v_mes INT;
    v_ano INT;
    v_afastamento_nome TEXT;
    v_afastamento_slots TEXT[];
    v_afastamento_integral BOOLEAN;
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

    -- Afastamento/evento do dia, lido em conjunto (ver fn_afastamento_dia).
    SELECT a.nome, a.integral, a.slots
      INTO v_afastamento_nome, v_afastamento_integral, v_afastamento_slots
    FROM public.fn_afastamento_dia(v_servidor_id, v_shift_date) a;

    -- Mesma regra da fn_check_shift_conflicts: so recusa o que ANULA o turno inteiro.
    IF v_afastamento_nome IS NOT NULL
       AND public.fn_afastamento_anula_turno(v_afastamento_integral, v_afastamento_slots, v_turno_slots) THEN
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
      AND NOT COALESCE((
            SELECT public.fn_afastamento_parcial_no_turno(
                     ad.integral,
                     ad.slots,
                     (SELECT dt.slots FROM public.dicionario_turnos dt WHERE dt.id = ed.dicionario_turnos_id))
            FROM public.fn_afastamento_dia(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia)) ad
          ), FALSE)
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
      AND NOT COALESCE((
            SELECT public.fn_afastamento_parcial_no_turno(
                     ad.integral,
                     ad.slots,
                     (SELECT dt.slots FROM public.dicionario_turnos dt WHERE dt.id = ed.dicionario_turnos_id))
            FROM public.fn_afastamento_dia(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia)) ad
          ), FALSE)
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
