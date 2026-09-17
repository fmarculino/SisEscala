-- Migration: Reverter presenca limpa tambem origem e marcacao_id
-- Data: 2026-09-17
-- Plano: docs/planos/2026-09-17-correcao-de-batida-real-pelo-rh-e-falta-em-plantao.md (defeito D1)
--
-- O DEFEITO
--   fn_reverter_presenca_manual e de 04/08/2026 (20260804040000). As colunas presenca_*_origem
--   e presenca_*_marcacao_id nasceram quatro dias depois, em 20260808020000 -- e a funcao nunca
--   aprendeu que elas existem. Ela zera presenca_*_em e presenca_*_manual, e deixa a origem e o
--   vinculo com a marcacao intactos.
--
--   Consequencia medida: reverter um passo e em seguida selecionar OUTRA batida grava o horario
--   novo com o marcacao_id e a origem ANTIGOS, porque fn_aceitar_marcacao_pendente usa
--     COALESCE(presenca_entrada_origem, 'terminal')
--     COALESCE(presenca_entrada_marcacao_id, p_marcacao_id)
--   e o valor velho continua la. O passo passa a apontar para uma batida que nao e a dele, e o
--   registro fica incoerente sem que nada reclame: escala_diaria diz um horario e o
--   presenca_*_marcacao_id aponta para outro instante.
--
--   Nao e teorico. E exatamente a sequencia que o administrador faz hoje para trocar a batida de
--   um passo, porque fn_aceitar_marcacao_pendente nunca sobrescreve passo preenchido.
--
-- O QUE MUDA
--   Cada ramo passa a zerar os TRES campos do passo e a gravar QUEM reverteu. A regra de
--   presenca_confirmada continua identica e a assinatura NAO muda (armadilha 41 -- assinatura
--   nova e objeto novo, nasceria aberta a PUBLIC e exigiria DROP da antiga).
--
-- O AUTOR ERA RECEBIDO E DESCARTADO
--   p_validador_id chegava por todas as chamadas e nao era gravado em lugar nenhum -- o mesmo
--   defeito que fn_aceitar_marcacao_pendente tinha com v_servidor antes de 20260812160000. Isso
--   nao e so perda de auditoria: o tratamento 'desconsiderar' que torna a reversao DURAVEL e
--   gravado pelo trigger trg_sincronizar_marcacoes, e o autor dele sai justamente de
--   confirmado_por_id. Sem autor, a reversao nao durava (defeito D3, corrigido na 20260917110000).
--   COALESCE preserva o autor anterior quando a chamada nao informa validador.
--
-- ATENCAO AO RECRIAR (armadilha 1)
--   O trigger trg_sincronizar_marcacoes (20260808070000) depende de que esta funcao deixe
--   presenca_*_em NULO quando OLD tinha valor: e assim que ele detecta a reversao e grava o
--   tratamento 'desconsiderar' que a torna duravel. Limpar origem/marcacao_id nao interfere
--   nisso -- ele compara apenas os campos *_em.

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
        SET presenca_entrada_em = NULL,
            presenca_entrada_manual = false,
            presenca_entrada_origem = NULL,
            presenca_entrada_marcacao_id = NULL,
            confirmado_por_id = COALESCE(p_validador_id, confirmado_por_id)
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria::text = p_categoria;
    ELSIF p_tipo = 'intervalo_saida' THEN
        UPDATE public.escala_diaria
        SET presenca_intervalo_saida_em = NULL,
            presenca_intervalo_saida_manual = false,
            presenca_intervalo_saida_origem = NULL,
            presenca_intervalo_saida_marcacao_id = NULL,
            confirmado_por_id = COALESCE(p_validador_id, confirmado_por_id)
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria::text = p_categoria;
    ELSIF p_tipo = 'intervalo_retorno' THEN
        UPDATE public.escala_diaria
        SET presenca_intervalo_retorno_em = NULL,
            presenca_intervalo_retorno_manual = false,
            presenca_intervalo_retorno_origem = NULL,
            presenca_intervalo_retorno_marcacao_id = NULL,
            confirmado_por_id = COALESCE(p_validador_id, confirmado_por_id)
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria::text = p_categoria;
    ELSIF p_tipo = 'saida' THEN
        UPDATE public.escala_diaria
        SET presenca_saida_em = NULL,
            presenca_saida_manual = false,
            presenca_saida_origem = NULL,
            presenca_saida_marcacao_id = NULL,
            confirmado_por_id = COALESCE(p_validador_id, confirmado_por_id)
        WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria::text = p_categoria;
    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'Tipo de reversão inválido.');
    END IF;

    -- Update presenca_confirmada to false if all times are NULL
    UPDATE public.escala_diaria
    SET presenca_confirmada = false, confirmado_por_id = NULL
    WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria::text = p_categoria
      AND presenca_entrada_em IS NULL AND presenca_intervalo_saida_em IS NULL
      AND presenca_intervalo_retorno_em IS NULL AND presenca_saida_em IS NULL;

    RETURN jsonb_build_object('success', true, 'message', 'Presença revertida com sucesso.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.fn_reverter_presenca_manual(uuid, integer, text, text, uuid) IS
    'Zera um passo de presenca em escala_diaria: horario, flag manual, ORIGEM e marcacao_id. '
    'A origem e o vinculo passaram a ser limpos em 20260917100000 -- sem isso, selecionar outra '
    'batida depois deixava o passo apontando para a marcacao anterior (COALESCE em '
    'fn_aceitar_marcacao_pendente).';


-- ============================================================================
-- CONFERENCIA -- EXECUTA a funcao, nao apenas confere que ela existe (armadilha 42)
-- ============================================================================
-- Cenario sintetico sobre dado real, revertido no fim por RAISE EXCEPTION. Confere os DOIS
-- sentidos: o passo revertido perde os tres campos, e os passos NAO revertidos ficam intactos
-- (limpar demais aqui apagaria batida que ninguem mandou apagar).

DO $conf$
DECLARE
    v_ed        record;
    v_marc_id   uuid;
    v_autor     uuid;
    v_ok        boolean;
BEGIN
    -- Uma linha qualquer com entrada E saida preenchidas, para poder conferir os dois lados.
    -- Competencia ABERTA de proposito: trg_escala_diaria_guard_competencia e BEFORE UPDATE sobre
    -- colunas de presenca e recusaria o ensaio num mes congelado -- a conferencia falharia por
    -- um motivo que nada tem a ver com o que ela mede.
    SELECT ed.id, ed.escala_mensal_id, ed.dia, ed.categoria::text AS categoria
      INTO v_ed
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE ed.presenca_entrada_em IS NOT NULL
       AND ed.presenca_saida_em IS NOT NULL
       AND ed.categoria::text <> 'Sobreaviso'
       AND NOT public.fn_competencia_encerrada(em.mes, em.ano)
     LIMIT 1;

    IF v_ed.id IS NULL THEN
        RAISE NOTICE 'CONFERENCIA 20260917100000: nenhuma linha com os dois extremos; nada a exercitar.';
        RETURN;
    END IF;

    -- Marca a sessao como reconciliacao para o trigger de sincronizacao ficar inerte: a
    -- conferencia nao pode criar marcacao nem tratamento, mesmo sendo revertida depois.
    PERFORM set_config('sisescala.reconciliacao', 'on', true);

    -- Garante um estado conhecido nos tres campos da SAIDA antes de reverter.
    SELECT m.id INTO v_marc_id FROM public.marcacoes_ponto m LIMIT 1;

    UPDATE public.escala_diaria
       SET presenca_saida_origem = 'terminal'::public.marcacao_origem,
           presenca_saida_marcacao_id = v_marc_id
     WHERE id = v_ed.id;

    SELECT p.id INTO v_autor FROM public.profiles p LIMIT 1;

    PERFORM public.fn_reverter_presenca_manual(
        v_ed.escala_mensal_id, v_ed.dia, v_ed.categoria, 'saida', v_autor);

    SELECT ed.presenca_saida_em IS NULL
       AND ed.presenca_saida_origem IS NULL
       AND ed.presenca_saida_marcacao_id IS NULL
      INTO v_ok
      FROM public.escala_diaria ed WHERE ed.id = v_ed.id;

    IF NOT COALESCE(v_ok, false) THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU: reverter a saida nao limpou os tres campos (linha %)', v_ed.id;
    END IF;

    -- O autor tem de ficar gravado: e dele que o trigger de sincronizacao tira o
    -- registrado_por_id do tratamento 'desconsiderar' que torna a reversao duravel.
    SELECT ed.confirmado_por_id = v_autor INTO v_ok
      FROM public.escala_diaria ed WHERE ed.id = v_ed.id;

    IF NOT COALESCE(v_ok, false) AND v_autor IS NOT NULL THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU: p_validador_id nao foi gravado em confirmado_por_id (linha %)', v_ed.id;
    END IF;

    -- O outro sentido: a ENTRADA nao foi tocada.
    SELECT ed.presenca_entrada_em IS NOT NULL INTO v_ok
      FROM public.escala_diaria ed WHERE ed.id = v_ed.id;

    IF NOT COALESCE(v_ok, false) THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU: reverter a saida apagou a ENTRADA (linha %)', v_ed.id;
    END IF;

    RAISE EXCEPTION 'CONFERENCIA_OK_ROLLBACK';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'CONFERENCIA_OK_ROLLBACK' THEN
            RAISE NOTICE 'CONFERENCIA 20260917100000: OK (ensaio revertido).';
        ELSE
            RAISE;
        END IF;
END;
$conf$;
