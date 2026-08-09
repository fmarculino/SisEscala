-- Migration: Selecao da batida real na validacao manual
-- Data: 2026-08-09
-- Plano: docs/planos/2026-08-09-selecao-de-batida-real-na-validacao-manual.md
--
-- MOTIVACAO
--   O coordenador abre "Validar Presenca" numa celula onde o terminal JA registrou a batida e
--   mesmo assim precisa DIGITAR o horario. Digitar quando o horario real existe perde tres
--   coisas de uma vez:
--
--     - os segundos  (07:06:43 -> 07:06:00), indistinguivel de sintetico (CLAUDE.md armadilha 5)
--     - a origem     (terminal -> ajuste_coordenador), a folha deixa de dizer que houve batida
--     - o vinculo    presenca_*_marcacao_id fica nulo e a reconciliacao perde o fio
--
--   E o inverso da precedencia de origem (fn_precedencia_origem: rep 1 -> terminal 2 ->
--   ajuste_coordenador 3 -> ajuste_servidor 4). Onde existe horario real, ele tem de ganhar.
--
-- O QUE JA EXISTIA
--   fn_aceitar_marcacao_pendente (20260808100000) ja grava o horario REAL no passo escolhido,
--   preserva origem 'terminal' e cria tratamento append-only. Ela nunca era chamada: o botao
--   "usar em <passo>" da grade so COPIAVA o HH:MM para o input, e o envio seguia por
--   fn_registrar_presenca_informada. Esta migration nao a reescreve - passa a usa-la.
--
-- DIGITAR CONTINUA EXISTINDO, E PRECISA CONTINUAR
--   Caso real: o servidor chegou as 06:00, esqueceu de bater e so bateu as 06:50; o coordenador
--   apura e acata as 06:00. Selecionar e usar o fato; digitar e o coordenador DECLARAR - o
--   tratamento autorizado pelo Art. 82, paragrafo unico. Os dois sao legitimos, e o registro
--   precisa distinguir um do outro. Antes desta migration saiam identicos, ambos como
--   'ajuste_coordenador'.
--
-- NEM TODA TENTATIVA RECUSADA PODE SER SELECIONADA
--   Auditoria de 07/08/2026, 911 tentativas: 378 eram "Matricula ou PIN invalidos" e 90 eram
--   "Nenhum plantao". Nenhuma prova presenca, e a primeira nem prova identidade - o servidor_id
--   pode estar preenchido quando a matricula bateu e so o PIN errou. Gravar isso na folha
--   registraria ponto a partir de um erro de digitacao, possivelmente de outra pessoa.
--
--   O filtro ja existia inline em fn_batidas_reais_recusadas. Aqui ele e EXTRAIDO para
--   fn_tentativa_recusada_elegivel e aquela funcao passa a chama-lo, para nao existirem duas
--   copias da regra. A checagem vale no BANCO, nao so na tela: a RPC e chamavel direto.
--
-- A MESMA BATIDA APARECE DUAS VEZES
--   Desde a v1.22.0, batida fora da janela gera DOIS registros: fn_confirmar_presenca grava a
--   tentativa em logs_tentativas_presenca e o wrapper fn_registrar_ponto grava a marcacao
--   pendente em marcacoes_ponto. Mesmo evento fisico. Ao aceitar a tentativa, se ja existir
--   marcacao 'terminal' naquele instante, ela e REUSADA em vez de duplicada. A tolerancia de
--   5 segundos existe porque os dois now() nao sao o mesmo instante.


-- ============================================================================
-- 1. FONTE UNICA DA ELEGIBILIDADE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_tentativa_recusada_elegivel(
    p_servidor_id uuid,
    p_mensagem    text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $fn$
    -- So tentativas que provam presenca fisica com identidade confirmada.
    -- PIN invalido, ausencia de escala e "ja registrou" ficam de fora de proposito.
    SELECT p_servidor_id IS NOT NULL
       AND p_mensagem IS NOT NULL
       AND (p_mensagem ILIKE '%janela%' OR p_mensagem ILIKE '%erro interno%')
       AND p_mensagem NOT ILIKE '%matr_cula ou pin%';
$fn$;

COMMENT ON FUNCTION public.fn_tentativa_recusada_elegivel(uuid, text) IS
    'Fonte unica: uma tentativa recusada so vira horario de folha se a identidade foi confirmada '
    'e a recusa foi por janela de presenca ou erro interno. Ver CLAUDE.md armadilha 7.';

GRANT EXECUTE ON FUNCTION public.fn_tentativa_recusada_elegivel(uuid, text)
    TO authenticated, service_role;


-- ============================================================================
-- 2. fn_batidas_reais_recusadas PASSA A USAR O HELPER
-- ============================================================================
-- Corpo copiado de 20260807090000 sem nenhuma outra alteracao: as duas linhas do predicado
-- inline viraram uma chamada a fn_tentativa_recusada_elegivel. A atribuicao gulosa, a
-- tolerancia e a ordenacao continuam identicas. CLAUDE.md armadilha 1.

CREATE OR REPLACE FUNCTION public.fn_batidas_reais_recusadas(
    p_servidor_id uuid,
    p_prev_entrada timestamp with time zone,
    p_prev_int_saida timestamp with time zone,
    p_prev_int_retorno timestamp with time zone,
    p_prev_saida timestamp with time zone,
    p_tem_intervalo boolean DEFAULT true,
    p_tolerancia_min integer DEFAULT 90
)
RETURNS TABLE (
    entrada timestamp with time zone,
    int_saida timestamp with time zone,
    int_retorno timestamp with time zone,
    saida timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
    v_par RECORD;
    v_usados timestamp with time zone[] := ARRAY[]::timestamp with time zone[];
BEGIN
    entrada := NULL; int_saida := NULL; int_retorno := NULL; saida := NULL;

    IF p_servidor_id IS NULL THEN
        RETURN NEXT;
        RETURN;
    END IF;

    FOR v_par IN
        WITH passos(nome, previsto) AS (
            VALUES
                ('entrada'::text,     p_prev_entrada),
                ('int_saida'::text,   CASE WHEN p_tem_intervalo THEN p_prev_int_saida ELSE NULL END),
                ('int_retorno'::text, CASE WHEN p_tem_intervalo THEN p_prev_int_retorno ELSE NULL END),
                ('saida'::text,       p_prev_saida)
        )
        SELECT p.nome,
               lt.data_hora_tentativa AS quando,
               abs(extract(epoch FROM (lt.data_hora_tentativa - p.previsto))) AS dist
        FROM passos p
        JOIN public.logs_tentativas_presenca lt
          ON lt.servidor_id = p_servidor_id
         AND lt.data_hora_tentativa
             BETWEEN p.previsto - make_interval(mins => p_tolerancia_min)
                 AND p.previsto + make_interval(mins => p_tolerancia_min)
        WHERE p.previsto IS NOT NULL
          AND public.fn_tentativa_recusada_elegivel(lt.servidor_id, lt.mensagem_erro)
        ORDER BY dist, lt.data_hora_tentativa
    LOOP
        -- Atribuicao gulosa: o par mais proximo vence, e nem o passo nem a tentativa
        -- podem ser usados de novo. Rajadas de tentativas repetidas caem fora naturalmente,
        -- porque a segunda batida encontra o passo ja preenchido.
        IF v_par.quando = ANY(v_usados) THEN
            CONTINUE;
        END IF;

        IF v_par.nome = 'entrada' AND entrada IS NULL THEN
            entrada := v_par.quando;
        ELSIF v_par.nome = 'int_saida' AND int_saida IS NULL THEN
            int_saida := v_par.quando;
        ELSIF v_par.nome = 'int_retorno' AND int_retorno IS NULL THEN
            int_retorno := v_par.quando;
        ELSIF v_par.nome = 'saida' AND saida IS NULL THEN
            saida := v_par.quando;
        ELSE
            CONTINUE;
        END IF;

        v_usados := v_usados || v_par.quando;
    END LOOP;

    RETURN NEXT;
END;
$fn$;

COMMENT ON FUNCTION public.fn_batidas_reais_recusadas(uuid, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, boolean, integer) IS
    'Casa tentativas recusadas em logs_tentativas_presenca com os passos previstos do dia, por proximidade e sem reuso. Elegibilidade em fn_tentativa_recusada_elegivel.';


-- ============================================================================
-- 3. LISTAGEM DO MES COM A MARCA DE ELEGIBILIDADE
-- ============================================================================
-- Substitui o select direto na tabela feito pela grade. SECURITY INVOKER de proposito: a RLS
-- de logs_tentativas_presenca continua valendo, e a tela nao ganha alcance que nao tinha.
-- Linhas INELEGIVEIS tambem sao devolvidas - nunca descartar batida. Elas aparecem sem controle
-- de selecao, com o motivo a vista.

CREATE OR REPLACE FUNCTION public.fn_tentativas_recusadas_mes(
    p_servidor_ids uuid[],
    p_mes          integer,
    p_ano          integer
)
RETURNS TABLE (
    id                     uuid,
    servidor_id            uuid,
    data_hora_tentativa    timestamptz,
    mensagem_erro          text,
    escala_prevista_inicio text,
    escala_prevista_fim    text,
    escala_categoria       text,
    turno_codigo           text,
    elegivel               boolean
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
    v_timezone text;
    v_inicio   timestamptz;
    v_fim      timestamptz;
BEGIN
    SELECT (valor#>>'{}')::text INTO v_timezone
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    v_inicio := (make_date(p_ano, p_mes, 1)::text || ' 00:00:00')::timestamp AT TIME ZONE v_timezone;
    v_fim    := v_inicio + interval '1 month';

    RETURN QUERY
    SELECT lt.id, lt.servidor_id, lt.data_hora_tentativa, lt.mensagem_erro,
           lt.escala_prevista_inicio, lt.escala_prevista_fim,
           lt.escala_categoria, lt.turno_codigo,
           public.fn_tentativa_recusada_elegivel(lt.servidor_id, lt.mensagem_erro)
      FROM public.logs_tentativas_presenca lt
     WHERE lt.servidor_id = ANY(p_servidor_ids)
       AND lt.data_hora_tentativa >= v_inicio
       AND lt.data_hora_tentativa <  v_fim
     ORDER BY lt.data_hora_tentativa;
END;
$fn$;

COMMENT ON FUNCTION public.fn_tentativas_recusadas_mes(uuid[], integer, integer) IS
    'Tentativas recusadas do mes para um conjunto de servidores, com a coluna elegivel. '
    'SECURITY INVOKER: a RLS da tabela continua valendo.';

GRANT EXECUTE ON FUNCTION public.fn_tentativas_recusadas_mes(uuid[], integer, integer)
    TO authenticated, service_role;


-- ============================================================================
-- 4. ACEITAR UMA TENTATIVA RECUSADA
-- ============================================================================
-- A tentativa nao tem linha em marcacoes_ponto quando foi recusada por caminho anterior ao
-- wrapper (ou quando a marcacao pendente nao chegou a ser criada). Aqui ela e MATERIALIZADA
-- como marcacao 'terminal', sintetica = false, e a escrita em escala_diaria e DELEGADA a
-- fn_aceitar_marcacao_pendente - que ja faz COALESCE, grava presenca_*_marcacao_id e registra
-- o tratamento append-only. Nada e reimplementado aqui.

CREATE OR REPLACE FUNCTION public.fn_aceitar_tentativa_recusada(
    p_tentativa_id     uuid,
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
    v_quando      timestamptz;
    v_servidor    uuid;
    v_mensagem    text;
    v_esc_serv    uuid;
    v_unidade_id  uuid;
    v_setor_id    uuid;
    v_marcacao_id uuid;
BEGIN
    IF p_passo NOT IN ('entrada', 'intervalo_saida', 'intervalo_retorno', 'saida') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Passo inválido: ' || COALESCE(p_passo, '(nulo)'));
    END IF;

    IF p_justificativa IS NULL OR btrim(p_justificativa) = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Justificativa é obrigatória.');
    END IF;

    SELECT lt.data_hora_tentativa, lt.servidor_id, lt.mensagem_erro
      INTO v_quando, v_servidor, v_mensagem
      FROM public.logs_tentativas_presenca lt
     WHERE lt.id = p_tentativa_id;

    IF v_quando IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Tentativa não encontrada.');
    END IF;

    -- A defesa que importa: sem isso, um erro de digitacao de PIN viraria horario de folha.
    IF NOT public.fn_tentativa_recusada_elegivel(v_servidor, v_mensagem) THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Esta tentativa não comprova presença (' || COALESCE(v_mensagem, 'sem mensagem') ||
                       '). Só tentativas com identidade confirmada e recusadas por janela ou erro ' ||
                       'interno podem virar horário de folha.');
    END IF;

    SELECT em.servidor_id, em.unidade_id, em.setor_id
      INTO v_esc_serv, v_unidade_id, v_setor_id
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE ed.id = p_escala_diaria_id;

    IF v_esc_serv IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Linha de escala não encontrada.');
    END IF;

    IF v_esc_serv <> v_servidor THEN
        RETURN jsonb_build_object('success', false,
            'message', 'A tentativa é de outro servidor. Não é possível vinculá-la a esta escala.');
    END IF;

    -- Desde a v1.22.0 a mesma batida gera tentativa E marcacao pendente. Reusar em vez de
    -- duplicar: marcacoes_ponto e INSERT-only, uma copia a mais nunca mais sai de la.
    SELECT m.id INTO v_marcacao_id
      FROM public.marcacoes_ponto m
     WHERE m.servidor_id = v_servidor
       AND m.origem = 'terminal'
       AND m.ocorrido_em BETWEEN v_quando - interval '5 seconds'
                             AND v_quando + interval '5 seconds'
     ORDER BY abs(extract(epoch FROM (m.ocorrido_em - v_quando)))
     LIMIT 1;

    IF v_marcacao_id IS NULL THEN
        -- sintetica = false explicitamente: e batida real do terminal, mesmo tendo sido recusada.
        -- Deixar a heuristica de segundos decidir rotularia errado a batida do minuto cheio.
        v_marcacao_id := public.fn_registrar_marcacao(
            v_servidor, 'terminal'::public.marcacao_origem, v_quando,
            v_unidade_id, v_setor_id,
            NULL, p_validador_id, p_justificativa,
            false, true, NULL, NULL, NULL, NULL, false,
            'Batida recusada pelo terminal, recuperada na validacao manual. Tentativa ' ||
            p_tentativa_id::text || '. Motivo original: ' || COALESCE(v_mensagem, 'nao informado'));
    END IF;

    IF v_marcacao_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Não foi possível registrar a marcação.');
    END IF;

    RETURN public.fn_aceitar_marcacao_pendente(
        v_marcacao_id, p_escala_diaria_id, p_passo, p_validador_id, p_justificativa);
END;
$fn$;

COMMENT ON FUNCTION public.fn_aceitar_tentativa_recusada(uuid, uuid, text, uuid, text) IS
    'Transforma uma tentativa recusada ELEGIVEL em marcacao terminal (reusando a pendente quando '
    'existir) e delega a escrita a fn_aceitar_marcacao_pendente. O horario gravado e o real.';

GRANT EXECUTE ON FUNCTION public.fn_aceitar_tentativa_recusada(uuid, uuid, text, uuid, text)
    TO authenticated, service_role;


-- ============================================================================
-- 5. ENTRADA UNICA DO MODAL DE VALIDACAO
-- ============================================================================
-- Uma chamada, uma transacao. As selecoes entram primeiro (horario real); o que sobrar de
-- digitado vai para fn_registrar_presenca_informada (horario declarado). Nenhuma das duas
-- funcoes existentes precisou ser reescrita - CLAUDE.md armadilha 1.
--
-- p_selecoes: {"entrada": {"fonte":"tentativa","id":"<uuid>"},
--              "saida":   {"fonte":"marcacao","id":"<uuid>"}}
-- p_horarios: {"intervalo_saida":"12:04", ...}  (hora local, HH:MM)
--
-- GUARDAS QUE ESTE WRAPPER ACRESCENTA: fn_aceitar_marcacao_pendente nao checa Sobreaviso nem
-- competencia encerrada - so fn_registrar_presenca_informada checava. Aqui os dois caminhos
-- passam pela mesma porta, ANTES de qualquer escrita.

CREATE OR REPLACE FUNCTION public.fn_validar_presenca_manual(
    p_escala_diaria_id uuid,
    p_selecoes         jsonb,
    p_horarios         jsonb,
    p_validador_id     uuid,
    p_justificativa    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_mes           integer;
    v_ano           integer;
    v_dia           integer;
    v_categoria     text;
    v_passo         text;
    v_sel           jsonb;
    v_fonte         text;
    v_id            uuid;
    v_res           jsonb;
    v_ids_usados    uuid[] := '{}';
    v_selecionados  text[] := '{}';
    v_informados    jsonb  := '{}'::jsonb;
    v_hhmm          text;
BEGIN
    IF p_justificativa IS NULL OR btrim(p_justificativa) = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Justificativa é obrigatória.');
    END IF;

    SELECT ed.dia, ed.categoria::text, em.mes, em.ano
      INTO v_dia, v_categoria, v_mes, v_ano
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE ed.id = p_escala_diaria_id;

    IF v_dia IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Linha de escala não encontrada.');
    END IF;

    -- Sobreaviso nao marca presenca: ciclo proprio em logs_sobreaviso, e a constraint
    -- chk_sobreaviso_sem_presenca rejeitaria a escrita de qualquer forma (armadilha 6).
    IF v_categoria = 'Sobreaviso' THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Sobreaviso não registra presença. Use o fluxo de sobreaviso.');
    END IF;

    IF public.fn_competencia_encerrada(v_mes, v_ano) THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Competência ' || lpad(v_mes::text, 2, '0') || '/' || v_ano ||
                       ' está encerrada. Reabra antes de alterar.');
    END IF;

    FOREACH v_passo IN ARRAY ARRAY['entrada', 'intervalo_saida', 'intervalo_retorno', 'saida']
    LOOP
        v_sel := COALESCE(p_selecoes, '{}'::jsonb) -> v_passo;

        IF v_sel IS NULL OR jsonb_typeof(v_sel) <> 'object' THEN
            -- Sem selecao: o horario digitado deste passo, se houver, segue para a informada.
            v_hhmm := NULLIF(btrim(COALESCE(p_horarios->>v_passo, '')), '');
            IF v_hhmm IS NOT NULL THEN
                v_informados := v_informados || jsonb_build_object(v_passo, v_hhmm);
            END IF;
            CONTINUE;
        END IF;

        -- Todo erro daqui para baixo aborta por RAISE, nunca por RETURN: um passo anterior ja
        -- pode ter sido gravado nesta mesma chamada, e meia validacao e pior que nenhuma.
        v_fonte := v_sel->>'fonte';
        BEGIN
            v_id := (v_sel->>'id')::uuid;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'SELECAO_RECUSADA:%',
                'Identificador inválido na seleção de ' || v_passo || '.';
        END;

        IF v_id IS NULL THEN
            RAISE EXCEPTION 'SELECAO_RECUSADA:%',
                'Seleção de ' || v_passo || ' sem identificador.';
        END IF;

        -- A mesma batida nao pode preencher dois passos: um evento fisico, um passo.
        IF v_id = ANY(v_ids_usados) THEN
            RAISE EXCEPTION 'SELECAO_RECUSADA:%',
                'A mesma batida foi selecionada para mais de um passo.';
        END IF;
        v_ids_usados := v_ids_usados || v_id;

        IF v_fonte = 'marcacao' THEN
            v_res := public.fn_aceitar_marcacao_pendente(
                v_id, p_escala_diaria_id, v_passo, p_validador_id, p_justificativa);
        ELSIF v_fonte = 'tentativa' THEN
            v_res := public.fn_aceitar_tentativa_recusada(
                v_id, p_escala_diaria_id, v_passo, p_validador_id, p_justificativa);
        ELSE
            RAISE EXCEPTION 'SELECAO_RECUSADA:%',
                'Fonte inválida na seleção de ' || v_passo || ': ' ||
                COALESCE(v_fonte, '(nula)') || '. Use "marcacao" ou "tentativa".';
        END IF;

        IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
            RAISE EXCEPTION 'SELECAO_RECUSADA:%', COALESCE(v_res->>'message', 'motivo nao informado');
        END IF;

        v_selecionados := v_selecionados || v_passo;
    END LOOP;

    IF v_informados <> '{}'::jsonb THEN
        v_res := public.fn_registrar_presenca_informada(
            p_escala_diaria_id, v_informados, p_validador_id, p_justificativa);
        IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
            RAISE EXCEPTION 'INFORMADO_RECUSADO:%', COALESCE(v_res->>'message', 'motivo nao informado');
        END IF;
    END IF;

    IF array_length(v_selecionados, 1) IS NULL AND v_informados = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Selecione uma batida registrada ou informe ao menos um horário.');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'passos_selecionados', to_jsonb(v_selecionados),
        'passos_informados', (SELECT COALESCE(jsonb_agg(k), '[]'::jsonb)
                                FROM jsonb_object_keys(v_informados) k),
        'message', 'Presença validada.'
            || CASE WHEN array_length(v_selecionados, 1) IS NOT NULL
                    THEN ' Horário real da batida em: ' || array_to_string(v_selecionados, ', ') || '.'
                    ELSE '' END
            || CASE WHEN v_informados <> '{}'::jsonb
                    THEN ' Horário informado em: ' ||
                         (SELECT string_agg(k, ', ') FROM jsonb_object_keys(v_informados) k) || '.'
                    ELSE '' END);

EXCEPTION WHEN OTHERS THEN
    -- Chegar aqui desfaz TUDO que o corpo gravou: e o que garante o tudo-ou-nada.
    -- substring, e nao split_part, porque a mensagem original costuma conter ':'.
    IF SQLERRM LIKE 'SELECAO_RECUSADA:%' OR SQLERRM LIKE 'INFORMADO_RECUSADO:%' THEN
        RETURN jsonb_build_object('success', false,
            'message', substring(SQLERRM from position(':' in SQLERRM) + 1));
    END IF;
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$fn$;

COMMENT ON FUNCTION public.fn_validar_presenca_manual(uuid, jsonb, jsonb, uuid, text) IS
    'Entrada unica da validacao manual por celula. Aplica as batidas SELECIONADAS com o horario '
    'real (origem terminal) e delega os passos DIGITADOS a fn_registrar_presenca_informada '
    '(origem ajuste_coordenador). Tudo ou nada.';

GRANT EXECUTE ON FUNCTION public.fn_validar_presenca_manual(uuid, jsonb, jsonb, uuid, text)
    TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--
--   1) O predicado extraido e equivalente ao inline (esperado: 0 linhas divergentes):
--
--   SELECT count(*) FILTER (WHERE elegivel_novo <> elegivel_antigo) AS divergentes
--     FROM (
--       SELECT public.fn_tentativa_recusada_elegivel(servidor_id, mensagem_erro) AS elegivel_novo,
--              (servidor_id IS NOT NULL
--               AND (mensagem_erro ILIKE '%janela%' OR mensagem_erro ILIKE '%erro interno%')
--               AND mensagem_erro NOT ILIKE '%matr_cula ou pin%') AS elegivel_antigo
--         FROM public.logs_tentativas_presenca
--     ) t;
--
--   2) Distribuicao da elegibilidade (esperado: a maioria INELEGIVEL - PIN invalido e sem escala):
--
--   SELECT elegivel, count(*)
--     FROM public.fn_tentativas_recusadas_mes(
--            ARRAY(SELECT id FROM public.servidores), 8, 2026)
--    GROUP BY 1;
--
--   3) TESTE PRINCIPAL - selecionar uma tentativa elegivel grava o horario REAL, com segundos:
--
--   SELECT public.fn_validar_presenca_manual(
--       '<escala_diaria_id>',
--       jsonb_build_object('entrada', jsonb_build_object('fonte','tentativa','id','<tentativa_id>')),
--       '{}'::jsonb, '<validador_id>', 'Batida recusada por bug de previsao; horario real aceito.');
--
--   SELECT presenca_entrada_em, presenca_entrada_origem, presenca_entrada_marcacao_id
--     FROM public.escala_diaria WHERE id = '<escala_diaria_id>';
--   -- presenca_entrada_em DEVE ter os segundos originais da tentativa (nao :00)
--   -- presenca_entrada_origem DEVE ser 'terminal', NAO 'ajuste_coordenador'
--   -- presenca_entrada_marcacao_id DEVE estar preenchido
--
--   SELECT tipo, passo_forcado, justificativa
--     FROM public.marcacoes_tratamentos
--    WHERE escala_diaria_id = '<escala_diaria_id>';
--   -- DEVE existir uma linha 'vincular_escala'.
--
--   4) NAO duplica marcacao quando a pendente ja existe (esperado: 1 linha):
--
--   SELECT count(*) FROM public.marcacoes_ponto
--    WHERE servidor_id = '<servidor_id>' AND origem = 'terminal'
--      AND ocorrido_em BETWEEN '<quando>'::timestamptz - interval '5 seconds'
--                          AND '<quando>'::timestamptz + interval '5 seconds';
--
--   5) Tentativa INELEGIVEL e recusada pela RPC direta:
--
--   SELECT public.fn_validar_presenca_manual(
--       '<escala_diaria_id>',
--       jsonb_build_object('entrada', jsonb_build_object('fonte','tentativa','id','<id_pin_invalido>')),
--       '{}'::jsonb, '<validador_id>', 'teste');
--   -- esperado: success = false, mensagem sobre nao comprovar presenca.
--
--   6) Misturar selecionado e digitado na mesma validacao:
--
--   SELECT public.fn_validar_presenca_manual(
--       '<escala_diaria_id>',
--       jsonb_build_object('entrada', jsonb_build_object('fonte','tentativa','id','<tentativa_id>')),
--       '{"saida":"18:20"}'::jsonb, '<validador_id>', 'Entrada real; saida informada pelo servidor.');
--
--   SELECT presenca_entrada_origem, presenca_saida_origem
--     FROM public.escala_diaria WHERE id = '<escala_diaria_id>';
--   -- esperado: 'terminal' e 'ajuste_coordenador' - origens DIFERENTES na mesma linha.
--
--   7) Atomicidade: selecao valida seguida de invalida nao pode deixar meia validacao:
--
--   SELECT public.fn_validar_presenca_manual(
--       '<escala_diaria_id_limpa>',
--       jsonb_build_object(
--         'entrada', jsonb_build_object('fonte','tentativa','id','<tentativa_valida>'),
--         'saida',   jsonb_build_object('fonte','marcacao','id','00000000-0000-0000-0000-000000000000')),
--       '{}'::jsonb, '<validador_id>', 'teste');
--   -- esperado: success = false E presenca_entrada_em continuar NULA.
--
--   8) Sobreaviso e competencia encerrada continuam fora nos DOIS caminhos:
--
--   SELECT public.fn_validar_presenca_manual('<escala_diaria_sobreaviso_id>',
--       jsonb_build_object('entrada', jsonb_build_object('fonte','tentativa','id','<qualquer>')),
--       '{}'::jsonb, '<validador_id>', 'teste');
--   -- esperado: success = false.
--
--   9) Validacao em massa continua igual apos a recriacao de fn_batidas_reais_recusadas:
--      rodar fn_confirmar_presenca_manual_bulk num mes ja fechado e comparar os horarios
--      gravados com os de antes - o predicado extraido tem de ser equivalente (item 1).
