-- Migration: Terminal deixa de recusar batida fora da janela (registro + revisao)
-- Data: 2026-08-08
--
-- MOTIVACAO LEGAL
--   A Portaria 671/2021 veda expressamente, em qualquer registrador eletronico de ponto:
--     1. restricoes de horario a marcacao do ponto;
--     2. marcacao automatica usando horarios predeterminados ou contratuais;
--     3. exigencia de autorizacao previa para marcar sobrejornada;
--     4. qualquer dispositivo que permita alteracao dos dados registrados pelo empregado.
--
--   A vedacao alcanca REP-C, REP-A e REP-P. O REP-P e justamente o registrador VIA PROGRAMA -
--   ou seja, o terminal web do SisEscala (/presenca) se enquadra na mesma regra do relogio.
--
--   Hoje o terminal RECUSA a batida fora da janela ("Fora da janela de presenca permitida.") e
--   grava apenas uma tentativa negada. Isso e exatamente a restricao vedada: o servidor que
--   chega atrasado, sai mais cedo ou faz hora extra fica sem conseguir registrar, e o horario
--   real se perde. Depois alguem preenche a folha com horario derivado da jornada - que e a
--   vedacao 2, cometida para consertar a 1.
--
--   Consequencia pratica: em juizo, controle de ponto que impede a marcacao real e imprestavel
--   como prova e inverte o onus contra o empregador (CLT Art. 74 par. 2, Sumula 338 do TST).
--
-- A SOLUCAO
--   Registrar SEMPRE, tratar DEPOIS. Confirmada a identidade, a batida entra no sistema
--   independentemente do horario. O que muda e o status: quando cai fora da janela prevista,
--   a marcacao nasce PENDENTE DE REVISAO em vez de virar presenca aprovada direto, e o
--   coordenador decide - exatamente como ja faz hoje com a validacao manual.
--
--   Isso e o que a Portaria autoriza no Art. 82: o programa de tratamento pode complementar
--   omissoes e tratar, desde que nao altere nem elimine o dado original. A marcacao original
--   fica em marcacoes_ponto, que e INSERT-only.
--
-- POR QUE UM WRAPPER, E NAO EDITAR fn_confirmar_presenca
--   fn_confirmar_presenca tem ~1.055 linhas e ja sofreu SEIS regressoes por CREATE OR REPLACE
--   (CLAUDE.md armadilha 1). Alterar a decisao de passo, os quatro ramos de escrita e os
--   retornos de uma vez seria a maior cirurgia ja feita nela.
--
--   fn_registrar_ponto envolve a funcao existente sem a reescrever: chama, e se o registro for
--   recusado por qualquer motivo que NAO seja identidade, grava a batida como marcacao pendente.
--   fn_confirmar_presenca continua byte a byte como esta.
--
-- O QUE CONTINUA SENDO RECUSADO
--   Somente MATRICULA OU PIN INVALIDOS. Isso nao e restricao de horario - e falta de
--   identificacao. Registrar uma batida sem saber de quem e seria pior: criaria ponto a partir
--   de um erro de digitacao, e a auditoria de 07/08/2026 mostrou que 378 das 911 tentativas
--   eram exatamente isso (CLAUDE.md armadilha 7).


-- ============================================================================
-- 1. REGISTRO DE PONTO SEM RESTRICAO DE HORARIO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_registrar_ponto(
    p_matricula        text,
    p_pin_servidor     text,
    p_coordenador_id   uuid,
    p_momento_simulado timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_servidor_id  uuid;
    v_unidade_id   uuid;
    v_setor_id     uuid;
    v_nome         text;
    v_now          timestamptz;
    v_timezone     text;
    v_hora         text;
    v_res          jsonb;
    v_marcacao_id  uuid;
    v_motivo       text;
BEGIN
    v_now := COALESCE(p_momento_simulado, now());

    SELECT (valor#>>'{}')::text INTO v_timezone
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;
    v_hora := to_char(v_now AT TIME ZONE v_timezone, 'HH24:MI');

    -- ---- Identidade: o UNICO motivo de recusa -----------------------------
    SELECT s.id, s.unidade_id, s.setor_id, s.nome
      INTO v_servidor_id, v_unidade_id, v_setor_id, v_nome
      FROM public.servidores s
     WHERE s.matricula = p_matricula;

    IF v_servidor_id IS NULL OR NOT public.verify_pin(v_servidor_id, p_pin_servidor) THEN
        PERFORM public.fn_log_tentativa_negada(
            v_servidor_id, p_matricula, p_coordenador_id,
            'Matrícula ou PIN inválidos.', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
        RETURN jsonb_build_object(
            'success', false, 'tipo', 'erro',
            'message', 'Matrícula ou PIN inválidos. Confira os dados e tente novamente.');
    END IF;

    -- ---- Caminho normal ---------------------------------------------------
    v_res := public.fn_confirmar_presenca(p_matricula, p_pin_servidor, p_coordenador_id, p_momento_simulado);

    IF COALESCE((v_res->>'success')::boolean, false) THEN
        RETURN jsonb_build_object(
            'success', true, 'tipo', 'sucesso',
            'message', v_res->>'message');
    END IF;

    -- ---- Fora da janela, sem escala, sem permissao ou erro interno --------
    -- A identidade ja esta confirmada, entao a batida E um fato e tem de ser registrada.
    -- fn_confirmar_presenca ja gravou a tentativa em logs_tentativas_presenca; aqui o horario
    -- real vira marcacao, que e o que sustenta a revisao do coordenador depois.
    v_motivo := COALESCE(v_res->>'message', 'motivo nao informado');

    v_marcacao_id := public.fn_registrar_marcacao(
        v_servidor_id,
        'terminal'::public.marcacao_origem,
        v_now,
        v_unidade_id, v_setor_id,
        p_coordenador_id,          -- coordenador supervisionando o terminal
        NULL, NULL,
        false,                     -- batida real: NUNCA sintetica, mesmo fora da janela
        false,
        NULL, NULL, NULL, NULL, false,
        'Registro fora da janela prevista, pendente de revisao. Motivo original: ' || v_motivo);

    RETURN jsonb_build_object(
        'success', true,
        'tipo', 'alerta',
        'marcacao_id', v_marcacao_id,
        'motivo_original', v_motivo,
        'message', 'Ponto registrado às ' || v_hora || '. Fora do horário previsto — '
                   || 'seu coordenador vai revisar.');

EXCEPTION WHEN OTHERS THEN
    -- Ate uma falha interna precisa preservar a batida. Perder o horario real do servidor por
    -- erro de sistema e o dano que esta migration existe para evitar.
    BEGIN
        IF v_servidor_id IS NOT NULL THEN
            v_marcacao_id := public.fn_registrar_marcacao(
                v_servidor_id, 'terminal'::public.marcacao_origem, v_now,
                v_unidade_id, v_setor_id, p_coordenador_id, NULL, NULL,
                false, false, NULL, NULL, NULL, NULL, false,
                'Registro preservado apos falha interna, pendente de revisao: ' || SQLERRM);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN jsonb_build_object(
        'success', v_servidor_id IS NOT NULL,
        'tipo', CASE WHEN v_servidor_id IS NOT NULL THEN 'alerta' ELSE 'erro' END,
        'message', CASE WHEN v_servidor_id IS NOT NULL
                        THEN 'Ponto registrado às ' || v_hora || '. Houve uma falha ao processar — '
                             || 'seu coordenador vai revisar.'
                        ELSE 'Não foi possível registrar. Procure seu coordenador.' END);
END;
$fn$;

COMMENT ON FUNCTION public.fn_registrar_ponto(text, text, uuid, timestamptz) IS
    'Entrada oficial do terminal de ponto. Envolve fn_confirmar_presenca sem reescreve-la: '
    'confirmada a identidade, a batida SEMPRE e registrada, mesmo fora da janela - a Portaria '
    '671/2021 veda restricao de horario a marcacao. Devolve tipo = sucesso | alerta | erro.';

GRANT EXECUTE ON FUNCTION public.fn_registrar_ponto(text, text, uuid, timestamptz)
    TO authenticated, service_role;


-- ============================================================================
-- 2. FILA DE REVISAO DO COORDENADOR
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_marcacoes_pendentes_revisao(
    p_unidade_id uuid DEFAULT NULL,
    p_setor_id   uuid DEFAULT NULL,
    p_desde      date DEFAULT NULL
)
RETURNS TABLE (
    marcacao_id   uuid,
    servidor_id   uuid,
    servidor_nome text,
    matricula     text,
    ocorrido_em   timestamptz,
    unidade_id    uuid,
    setor_id      uuid,
    observacao    text,
    dia           integer,
    ja_tratada    boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT m.id, m.servidor_id, s.nome, s.matricula, m.ocorrido_em,
           m.unidade_id, m.setor_id, m.observacao,
           extract(day from m.ocorrido_em AT TIME ZONE COALESCE(
               (SELECT (valor#>>'{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'),
               'America/Sao_Paulo'))::integer,
           EXISTS (SELECT 1 FROM public.marcacoes_tratamentos t WHERE t.marcacao_id = m.id)
      FROM public.marcacoes_ponto m
      JOIN public.servidores s ON s.id = m.servidor_id
     WHERE m.origem = 'terminal'
       AND m.observacao LIKE '%pendente de revisao%'
       AND (p_unidade_id IS NULL OR m.unidade_id = p_unidade_id)
       AND (p_setor_id   IS NULL OR m.setor_id   = p_setor_id)
       AND (p_desde      IS NULL OR m.ocorrido_em >= p_desde)
       AND public.fn_unidade_no_escopo(m.unidade_id)
     ORDER BY m.ocorrido_em DESC
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_marcacoes_pendentes_revisao(uuid, uuid, date)
    TO authenticated, service_role;


-- ============================================================================
-- 3. ACEITE PELO COORDENADOR
-- ============================================================================
-- O coordenador escolhe a que passo a batida pertence e o SisEscala grava o HORARIO REAL -
-- nao o previsto. E a diferenca entre tratar o ponto e fabrica-lo.

CREATE OR REPLACE FUNCTION public.fn_aceitar_marcacao_pendente(
    p_marcacao_id      uuid,
    p_escala_diaria_id uuid,
    p_passo            text,
    p_validador_id     uuid,
    p_justificativa    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_ocorrido timestamptz;
    v_servidor uuid;
BEGIN
    IF p_passo NOT IN ('entrada', 'intervalo_saida', 'intervalo_retorno', 'saida') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Passo inválido: ' || COALESCE(p_passo, '(nulo)'));
    END IF;

    IF p_justificativa IS NULL OR btrim(p_justificativa) = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Justificativa é obrigatória.');
    END IF;

    SELECT m.ocorrido_em, m.servidor_id INTO v_ocorrido, v_servidor
      FROM public.marcacoes_ponto m WHERE m.id = p_marcacao_id;

    IF v_ocorrido IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Marcação não encontrada.');
    END IF;

    -- O trigger de sincronizacao criaria uma SEGUNDA marcacao a partir desta escrita, e o fato
    -- ja existe. Reusa o guard da reconciliacao para mante-lo inerte.
    PERFORM set_config('sisescala.reconciliacao', 'on', true);

    -- Grava o horario REAL da batida no passo escolhido. Nao sobrescreve o que ja existir:
    -- alterar dado ja registrado e a vedacao 4 da Portaria 671.
    IF p_passo = 'entrada' THEN
        UPDATE public.escala_diaria
           SET presenca_entrada_em = COALESCE(presenca_entrada_em, v_ocorrido),
               presenca_entrada_origem = COALESCE(presenca_entrada_origem, 'terminal'::public.marcacao_origem),
               presenca_entrada_marcacao_id = COALESCE(presenca_entrada_marcacao_id, p_marcacao_id),
               presenca_confirmada = true, confirmado_por_id = p_validador_id,
               justificativa_manual = p_justificativa, confirmacao_manual = true
         WHERE id = p_escala_diaria_id;
    ELSIF p_passo = 'intervalo_saida' THEN
        UPDATE public.escala_diaria
           SET presenca_intervalo_saida_em = COALESCE(presenca_intervalo_saida_em, v_ocorrido),
               presenca_intervalo_saida_origem = COALESCE(presenca_intervalo_saida_origem, 'terminal'::public.marcacao_origem),
               presenca_intervalo_saida_marcacao_id = COALESCE(presenca_intervalo_saida_marcacao_id, p_marcacao_id),
               confirmado_por_id = p_validador_id,
               justificativa_manual = p_justificativa, confirmacao_manual = true
         WHERE id = p_escala_diaria_id;
    ELSIF p_passo = 'intervalo_retorno' THEN
        UPDATE public.escala_diaria
           SET presenca_intervalo_retorno_em = COALESCE(presenca_intervalo_retorno_em, v_ocorrido),
               presenca_intervalo_retorno_origem = COALESCE(presenca_intervalo_retorno_origem, 'terminal'::public.marcacao_origem),
               presenca_intervalo_retorno_marcacao_id = COALESCE(presenca_intervalo_retorno_marcacao_id, p_marcacao_id),
               presenca_confirmada = true, confirmado_por_id = p_validador_id,
               justificativa_manual = p_justificativa, confirmacao_manual = true
         WHERE id = p_escala_diaria_id;
    ELSE
        UPDATE public.escala_diaria
           SET presenca_saida_em = COALESCE(presenca_saida_em, v_ocorrido),
               presenca_saida_origem = COALESCE(presenca_saida_origem, 'terminal'::public.marcacao_origem),
               presenca_saida_marcacao_id = COALESCE(presenca_saida_marcacao_id, p_marcacao_id),
               presenca_confirmada = true, confirmado_por_id = p_validador_id,
               justificativa_manual = p_justificativa, confirmacao_manual = true
         WHERE id = p_escala_diaria_id;
    END IF;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Linha de escala não encontrada.');
    END IF;

    -- A decisao do coordenador vira tratamento append-only. A marcacao original permanece.
    INSERT INTO public.marcacoes_tratamentos
        (marcacao_id, tipo, passo_forcado, escala_diaria_id, justificativa, registrado_por_id)
    VALUES (p_marcacao_id, 'vincular_escala', p_passo, p_escala_diaria_id, p_justificativa, p_validador_id);

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Marcação aceita como ' || p_passo || ' com o horário real da batida.');
END;
$fn$;

COMMENT ON FUNCTION public.fn_aceitar_marcacao_pendente(uuid, uuid, text, uuid, text) IS
    'Coordenador aceita uma batida pendente, gravando o HORARIO REAL no passo escolhido - nunca '
    'o previsto. Registra a decisao como tratamento append-only; a marcacao original permanece.';

GRANT EXECUTE ON FUNCTION public.fn_aceitar_marcacao_pendente(uuid, uuid, text, uuid, text)
    TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--
--   1) TESTE PRINCIPAL - bater fora da janela nao pode mais ser recusado.
--      Escolha um servidor com escala hoje e simule um horario absurdo:
--
--   SELECT public.fn_registrar_ponto('<matricula>', '<pin>', '<coordenador_id>',
--          (CURRENT_DATE + interval '3 hours')::timestamptz);
--   -- esperado: success = true, tipo = 'alerta',
--   --           message = 'Ponto registrado as 03:00. Fora do horario previsto - ...'
--
--   2) A batida ficou registrada como fato:
--
--   SELECT ocorrido_em, origem, sintetica, observacao
--     FROM public.marcacoes_ponto
--    WHERE observacao LIKE '%pendente de revisao%'
--    ORDER BY registrado_em DESC LIMIT 5;
--   -- sintetica DEVE ser false: e batida real, so esta fora do horario previsto.
--
--   3) Aparece na fila do coordenador:
--
--   SELECT servidor_nome, ocorrido_em, dia, ja_tratada
--     FROM public.fn_marcacoes_pendentes_revisao();
--
--   4) PIN invalido continua sendo recusado (isso NAO e restricao de horario):
--
--   SELECT public.fn_registrar_ponto('<matricula>', '0000', '<coordenador_id>');
--   -- esperado: success = false, tipo = 'erro'
--
--   5) Batida dentro da janela continua igual - mesmo texto de antes, tipo = 'sucesso':
--
--   SELECT public.fn_registrar_ponto('<matricula>', '<pin>', '<coordenador_id>');
--
--   6) ACEITE pelo coordenador grava o horario REAL, nao o previsto:
--
--   SELECT public.fn_aceitar_marcacao_pendente('<marcacao_id>', '<escala_diaria_id>',
--          'entrada', '<validador_id>', 'Chegou atrasado por consulta medica.');
--
--   SELECT presenca_entrada_em, presenca_entrada_origem FROM public.escala_diaria
--    WHERE id = '<escala_diaria_id>';
--   -- presenca_entrada_em tem que ser o horario da batida, com segundos.
--
--   7) O tratamento ficou registrado e a marcacao original continua intacta:
--
--   SELECT t.tipo, t.passo_forcado, t.justificativa, m.ocorrido_em
--     FROM public.marcacoes_tratamentos t
--     JOIN public.marcacoes_ponto m ON m.id = t.marcacao_id
--    ORDER BY t.created_at DESC LIMIT 3;
