-- Migration: O desconsiderar da reversao deixa de depender de confirmado_por_id
-- Data: 2026-09-17
-- Plano: docs/planos/2026-09-17-correcao-de-batida-real-pelo-rh-e-falta-em-plantao.md (defeito D3)
-- Gerada por scratchpad/gen_desconsiderar_reversao.js a partir de
--   20260808070000_sync_marcacoes_from_escala_diaria.sql (copia mecanica, armadilha 1).
--   NAO EDITAR A MAO: regenere pelo script, que aborta se a fonte divergir.
--
-- O QUE ESTAVA ERRADO
--   A reversao de um passo em escala_diaria so e DURAVEL porque este trigger grava um
--   tratamento 'desconsiderar' sobre a marcacao -- sem ele, fn_alocar_marcacoes_dia torna a
--   ver a batida e a proxima reconciliacao a repoe no passo. O INSERT vivia sob um IF que
--   exigia confirmado_por_id preenchido, e batida de relogio nunca validada a mao nao tem.
--
--   Medido em producao em 17/09/2026: 4.471 de 11.242 linhas (39,8%) com saida de origem
--   `rep` estao com confirmado_por_id NULO. Nelas, reverter era um no-op de efeito atrasado:
--   a tela mostrava o passo vazio e a batida voltava sozinha depois.
--
-- ORDEM DE APLICACAO
--   Depende de 20260917100000 (que faz fn_reverter_presenca_manual gravar o autor). Aplicar
--   esta sozinha melhora o caso, mas deixa a autoria dependendo de auth.uid().


-- ============================================================================
-- 0. O 'ULTIMO TRATAMENTO' PRECISA EXISTIR: now() NAO DESEMPATA
-- ============================================================================
-- 🚨 Achado pelo PROPRIO ensaio desta migration, nao por leitura de codigo.
--
--   marcacoes_tratamentos.created_at tinha DEFAULT now(), que e o instante de inicio da
--   TRANSACAO, nao do comando. Dois tratamentos da mesma marcacao gravados na mesma
--   transacao ficam com created_at IDENTICO -- e ai nao existe 'ultimo'. Como o predicado
--   procura um 'desconsiderar' entre os empatados, o desconsiderar vence SEMPRE: gravar
--   'restaurar' logo depois de 'desconsiderar' nao produzia efeito nenhum.
--
--   clock_timestamp() avanca dentro da transacao e resolve na origem. Vale so para linhas
--   NOVAS -- e conferido em producao em 17/09/2026 que nao ha empate no historico: 2.795
--   tratamentos, 6 restaurar, ZERO pares (marcacao, created_at) repetidos.
--
-- ⚠️ Mudar o DEFAULT nao reescreve nada e nao tranca tabela: e so catalogo.

ALTER TABLE public.marcacoes_tratamentos
    ALTER COLUMN created_at SET DEFAULT clock_timestamp();


-- ============================================================================
-- 1. FONTE UNICA: a marcacao esta desconsiderada AGORA?
-- ============================================================================
-- O efetivo e o ULTIMO tratamento por created_at, porque desconsiderar/restaurar se alternam.
--
-- ⚠️ fn_alocar_marcacoes_dia tem o MESMO predicado escrito inline, dentro do cursor que monta
--    as candidatas, e NAO foi trocado por esta funcao de proposito: ali ele roda por marcacao
--    dentro de uma consulta quente, e trocar um NOT EXISTS correlacionado por chamada de
--    funcao muda o plano de execucao de um caminho critico. Ao alterar a REGRA, altere os
--    dois -- o gerador da alocacao confere que o predicado inline continua presente.

CREATE OR REPLACE FUNCTION public.fn_marcacao_desconsiderada(p_marcacao_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
    SELECT EXISTS (
        SELECT 1
          FROM public.marcacoes_tratamentos t
         WHERE t.marcacao_id = p_marcacao_id
           AND t.tipo IN ('desconsiderar', 'restaurar')
           AND t.created_at = (
               SELECT max(t2.created_at)
                 FROM public.marcacoes_tratamentos t2
                WHERE t2.marcacao_id = p_marcacao_id
                  AND t2.tipo IN ('desconsiderar', 'restaurar'))
           AND t.tipo = 'desconsiderar'
    );
$fn$;

COMMENT ON FUNCTION public.fn_marcacao_desconsiderada(uuid) IS
    'True quando o ULTIMO tratamento desconsiderar/restaurar da marcacao e um desconsiderar. '
    'Espelho do predicado inline de fn_alocar_marcacoes_dia -- ao mudar a regra, mude os dois.';

REVOKE ALL ON FUNCTION public.fn_marcacao_desconsiderada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_marcacao_desconsiderada(uuid) TO authenticated, service_role;


-- ============================================================================
-- 2. O TRIGGER (copia mecanica, so o bloco de reversao mudou)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_sincronizar_marcacoes_escala_diaria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fnsync$
DECLARE
    v_servidor_id uuid;
    v_unidade_id  uuid;
    v_setor_id    uuid;
    v_origem      public.marcacao_origem;
    v_marcacao_id uuid;
    v_alvo        uuid;
    v_autor       uuid;
BEGIN
    -- Guard anti-eco. A reconciliacao (Fase 5) escreve em escala_diaria a partir das
    -- marcacoes; sem esta saida, o trigger criaria marcacoes a partir da reconciliacao, que
    -- por sua vez alimentaria a proxima reconciliacao. Ver fn_reconciliar_marcacoes_dia,
    -- que declara SET LOCAL sisescala.reconciliacao = 'on'.
    IF COALESCE(current_setting('sisescala.reconciliacao', true), 'off') = 'on' THEN
        RETURN NEW;
    END IF;

    -- Saida rapida: a esmagadora maioria dos UPDATEs em escala_diaria e de escala, nao de
    -- presenca (montagem de grade, troca de turno, categoria).
    IF TG_OP = 'UPDATE'
       AND NEW.presenca_entrada_em           IS NOT DISTINCT FROM OLD.presenca_entrada_em
       AND NEW.presenca_intervalo_saida_em   IS NOT DISTINCT FROM OLD.presenca_intervalo_saida_em
       AND NEW.presenca_intervalo_retorno_em IS NOT DISTINCT FROM OLD.presenca_intervalo_retorno_em
       AND NEW.presenca_saida_em             IS NOT DISTINCT FROM OLD.presenca_saida_em THEN
        RETURN NEW;
    END IF;

    SELECT em.servidor_id, em.unidade_id, em.setor_id
      INTO v_servidor_id, v_unidade_id, v_setor_id
      FROM public.escala_mensal em
     WHERE em.id = NEW.escala_mensal_id;

    IF v_servidor_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- ---- ENTRADA ----------------------------------------------------------
    IF NEW.presenca_entrada_em IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.presenca_entrada_em IS DISTINCT FROM OLD.presenca_entrada_em) THEN
        v_origem := CASE WHEN COALESCE(NEW.presenca_entrada_manual, false)
                         THEN 'ajuste_coordenador'::public.marcacao_origem
                         ELSE 'terminal'::public.marcacao_origem END;
        v_marcacao_id := public.fn_registrar_marcacao(
            v_servidor_id, v_origem, NEW.presenca_entrada_em, v_unidade_id, v_setor_id,
            CASE WHEN v_origem = 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.justificativa_manual END,
            NULL, false, NULL, NULL, NULL, NULL, false,
            'Sincronizada de escala_diaria ' || NEW.id::text || ' passo entrada');
    END IF;

    -- ---- SAIDA PARA O INTERVALO -------------------------------------------
    IF NEW.presenca_intervalo_saida_em IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.presenca_intervalo_saida_em IS DISTINCT FROM OLD.presenca_intervalo_saida_em) THEN
        v_origem := CASE WHEN COALESCE(NEW.presenca_intervalo_saida_manual, false)
                         THEN 'ajuste_coordenador'::public.marcacao_origem
                         ELSE 'terminal'::public.marcacao_origem END;
        v_marcacao_id := public.fn_registrar_marcacao(
            v_servidor_id, v_origem, NEW.presenca_intervalo_saida_em, v_unidade_id, v_setor_id,
            CASE WHEN v_origem = 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.justificativa_manual END,
            NULL, false, NULL, NULL, NULL, NULL, false,
            'Sincronizada de escala_diaria ' || NEW.id::text || ' passo intervalo_saida');
    END IF;

    -- ---- RETORNO DO INTERVALO ---------------------------------------------
    IF NEW.presenca_intervalo_retorno_em IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.presenca_intervalo_retorno_em IS DISTINCT FROM OLD.presenca_intervalo_retorno_em) THEN
        v_origem := CASE WHEN COALESCE(NEW.presenca_intervalo_retorno_manual, false)
                         THEN 'ajuste_coordenador'::public.marcacao_origem
                         ELSE 'terminal'::public.marcacao_origem END;
        v_marcacao_id := public.fn_registrar_marcacao(
            v_servidor_id, v_origem, NEW.presenca_intervalo_retorno_em, v_unidade_id, v_setor_id,
            CASE WHEN v_origem = 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.justificativa_manual END,
            NULL, false, NULL, NULL, NULL, NULL, false,
            'Sincronizada de escala_diaria ' || NEW.id::text || ' passo intervalo_retorno');
    END IF;

    -- ---- SAIDA ------------------------------------------------------------
    IF NEW.presenca_saida_em IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.presenca_saida_em IS DISTINCT FROM OLD.presenca_saida_em) THEN
        v_origem := CASE WHEN COALESCE(NEW.presenca_saida_manual, false)
                         THEN 'ajuste_coordenador'::public.marcacao_origem
                         ELSE 'terminal'::public.marcacao_origem END;
        v_marcacao_id := public.fn_registrar_marcacao(
            v_servidor_id, v_origem, NEW.presenca_saida_em, v_unidade_id, v_setor_id,
            CASE WHEN v_origem = 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.confirmado_por_id END,
            CASE WHEN v_origem <> 'terminal' THEN NEW.justificativa_manual END,
            NULL, false, NULL, NULL, NULL, NULL, false,
            'Sincronizada de escala_diaria ' || NEW.id::text || ' passo saida');
    END IF;

    -- ---- REVERSAO ---------------------------------------------------------
    -- fn_reverter_presenca_manual zera o passo em escala_diaria. Sem tratar isso, a marcacao
    -- correspondente continuaria valendo e a reconciliacao a traria de volta.
    -- A marcacao NAO e apagada (a tabela e imutavel): registra-se um tratamento
    -- 'desconsiderar', que e exatamente o mecanismo previsto para isso.
    --
    -- ====================================================================================
    -- TRES CORRECOES DE 20260917110000 (defeito D3 do plano de 17/09/2026)
    -- ====================================================================================
    --
    -- 1. O INSERT vivia sob `IF NEW.confirmado_por_id IS NOT NULL OR OLD... IS NOT NULL`.
    --    Batida de relogio nunca validada a mao tem confirmado_por_id NULO -- medido em
    --    17/09/2026: 4.471 de 11.242 linhas com saida de origem `rep` (39,8%). Nessas, o
    --    tratamento NAO era gravado e a batida voltava na proxima reconciliacao: a reversao
    --    parecia funcionar na tela e nao durava, sem erro em lugar nenhum.
    --    A raiz foi fechada na 20260917100000 (fn_reverter_presenca_manual passou a gravar
    --    p_validador_id em confirmado_por_id, que antes era recebido e descartado); aqui o
    --    autor ainda cai para auth.uid() e, por fim, para quem registrou a propria marcacao.
    --    So quando NENHUM desses existe o tratamento deixa de ser gravado -- e ai com
    --    RAISE WARNING nomeando a marcacao, nunca em silencio.
    --
    -- 2. O alvo era casado por (servidor, ocorrido_em), o que alcanca QUALQUER marcacao do
    --    servidor naquele instante, de qualquer origem e de qualquer dispositivo. Agora o
    --    presenca_*_marcacao_id de OLD manda quando existe; o casamento por instante fica
    --    como fallback para o historico anterior a 20260808020000, quando a coluna nasceu.
    --
    -- 3. `NOT EXISTS (tipo = 'desconsiderar')` impedia regravar depois de um 'restaurar':
    --    o par deixava de alternar e a segunda reversao da mesma marcacao nao produzia
    --    efeito. O criterio passa a ser o ULTIMO tratamento por created_at -- a mesma regra
    --    que fn_alocar_marcacoes_dia aplica para decidir o que vale, agora com fonte unica
    --    em fn_marcacao_desconsiderada.
    IF TG_OP = 'UPDATE' THEN
        v_autor := COALESCE(NEW.confirmado_por_id, OLD.confirmado_por_id, auth.uid());

        FOR v_alvo IN
            WITH revertidos (marcacao_id, ocorrido_em) AS (
                VALUES
                    ((CASE WHEN NEW.presenca_entrada_em           IS NULL THEN OLD.presenca_entrada_marcacao_id           END)::uuid,
                     (CASE WHEN NEW.presenca_entrada_em           IS NULL THEN OLD.presenca_entrada_em                    END)::timestamptz),
                    ((CASE WHEN NEW.presenca_intervalo_saida_em   IS NULL THEN OLD.presenca_intervalo_saida_marcacao_id   END)::uuid,
                     (CASE WHEN NEW.presenca_intervalo_saida_em   IS NULL THEN OLD.presenca_intervalo_saida_em            END)::timestamptz),
                    ((CASE WHEN NEW.presenca_intervalo_retorno_em IS NULL THEN OLD.presenca_intervalo_retorno_marcacao_id END)::uuid,
                     (CASE WHEN NEW.presenca_intervalo_retorno_em IS NULL THEN OLD.presenca_intervalo_retorno_em          END)::timestamptz),
                    ((CASE WHEN NEW.presenca_saida_em             IS NULL THEN OLD.presenca_saida_marcacao_id             END)::uuid,
                     (CASE WHEN NEW.presenca_saida_em             IS NULL THEN OLD.presenca_saida_em                      END)::timestamptz)
            )
            SELECT DISTINCT m.id
              FROM revertidos r
              JOIN public.marcacoes_ponto m
                ON (r.marcacao_id IS NOT NULL AND m.id = r.marcacao_id)
                OR (r.marcacao_id IS NULL
                    AND m.servidor_id = v_servidor_id
                    AND m.ocorrido_em = r.ocorrido_em)
             WHERE r.ocorrido_em IS NOT NULL
               AND NOT public.fn_marcacao_desconsiderada(m.id)
        LOOP
            IF v_autor IS NULL THEN
                SELECT COALESCE(m.registrado_por_id, m.coordenador_id) INTO v_autor
                  FROM public.marcacoes_ponto m WHERE m.id = v_alvo;
            END IF;

            IF v_autor IS NULL THEN
                -- marcacoes_tratamentos.registrado_por_id e NOT NULL: sem autor nao ha o que
                -- gravar. Antes isto era um IF mudo; agora deixa rastro no log, porque o
                -- efeito (a batida voltar na proxima reconciliacao) e invisivel na tela.
                RAISE WARNING 'reversao sem autor: tratamento desconsiderar NAO gravado para a marcacao %, e a batida voltara na proxima reconciliacao (escala_diaria %)', v_alvo, NEW.id;
            ELSE
                INSERT INTO public.marcacoes_tratamentos
                    (marcacao_id, tipo, justificativa, registrado_por_id)
                VALUES (v_alvo, 'desconsiderar',
                        'Presenca revertida em escala_diaria (sincronizacao automatica).',
                        v_autor);
            END IF;
        END LOOP;
    END IF;
    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    -- NUNCA travar a batida de ponto por causa da sincronizacao. Perder uma linha de
    -- marcacoes_ponto e recuperavel; impedir um servidor de registrar presenca nao e.
    RAISE WARNING 'fn_sincronizar_marcacoes_escala_diaria falhou para escala_diaria %: % (%)',
        NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$fnsync$;

-- ============================================================================
-- CONFERENCIA -- EXECUTA o caminho, nao apenas confere que a funcao existe (armadilha 42)
-- ============================================================================
-- Ensaio sintetico revertido por RAISE EXCEPTION, nos DOIS sentidos:
--   (a) reverter um passo cuja linha tem confirmado_por_id NULO passa a gravar o tratamento
--       -- era exatamente o caso que nao gravava;
--   (b) marcacao cujo ULTIMO tratamento e 'restaurar' volta a poder ser desconsiderada
--       -- era o que o NOT EXISTS antigo impedia para sempre.

DO $conf$
DECLARE
    v_ed      record;
    v_marc    uuid;
    v_autor   uuid;
    v_n       integer;
BEGIN
    SELECT p.id INTO v_autor FROM public.profiles p LIMIT 1;
    IF v_autor IS NULL THEN
        RAISE NOTICE 'CONFERENCIA 20260917110000: sem profiles; nada a exercitar.';
        RETURN;
    END IF;

    -- (b) primeiro, porque nao depende de escala nenhuma.
    SELECT m.id INTO v_marc FROM public.marcacoes_ponto m
     WHERE NOT EXISTS (SELECT 1 FROM public.marcacoes_tratamentos t WHERE t.marcacao_id = m.id)
     LIMIT 1;

    IF v_marc IS NOT NULL THEN
        INSERT INTO public.marcacoes_tratamentos (marcacao_id, tipo, justificativa, registrado_por_id)
        VALUES (v_marc, 'desconsiderar', 'ensaio da migration 20260917110000', v_autor);
        IF NOT public.fn_marcacao_desconsiderada(v_marc) THEN
            RAISE EXCEPTION 'CONFERENCIA FALHOU: desconsiderar nao foi reconhecido (marcacao %)', v_marc;
        END IF;

        INSERT INTO public.marcacoes_tratamentos (marcacao_id, tipo, justificativa, registrado_por_id)
        VALUES (v_marc, 'restaurar', 'ensaio da migration 20260917110000', v_autor);
        IF public.fn_marcacao_desconsiderada(v_marc) THEN
            RAISE EXCEPTION 'CONFERENCIA FALHOU: restaurar nao desfez o desconsiderar (marcacao %)', v_marc;
        END IF;
    END IF;

    -- (a) o caso que motivou: linha com batida e confirmado_por_id NULO.
    SELECT ed.id, ed.escala_mensal_id, ed.dia, ed.categoria::text AS categoria,
           ed.presenca_saida_em, ed.presenca_saida_marcacao_id
      INTO v_ed
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE ed.presenca_saida_em IS NOT NULL
       AND ed.presenca_saida_marcacao_id IS NOT NULL
       AND ed.confirmado_por_id IS NULL
       AND ed.categoria::text <> 'Sobreaviso'
       AND NOT public.fn_competencia_encerrada(em.mes, em.ano)
       AND NOT public.fn_marcacao_desconsiderada(ed.presenca_saida_marcacao_id)
     LIMIT 1;

    IF v_ed.id IS NULL THEN
        RAISE NOTICE 'CONFERENCIA 20260917110000: nenhuma linha com confirmado_por_id nulo; (a) nao exercitado.';
        RAISE EXCEPTION 'CONFERENCIA_OK_ROLLBACK';
    END IF;

    PERFORM public.fn_reverter_presenca_manual(
        v_ed.escala_mensal_id, v_ed.dia, v_ed.categoria, 'saida', v_autor);

    SELECT count(*) INTO v_n
      FROM public.marcacoes_tratamentos t
     WHERE t.marcacao_id = v_ed.presenca_saida_marcacao_id
       AND t.tipo = 'desconsiderar';

    IF v_n = 0 THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU: reverter linha com confirmado_por_id NULO nao gravou o tratamento (marcacao %)', v_ed.presenca_saida_marcacao_id;
    END IF;

    RAISE EXCEPTION 'CONFERENCIA_OK_ROLLBACK';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'CONFERENCIA_OK_ROLLBACK' THEN
            RAISE NOTICE 'CONFERENCIA 20260917110000: OK (ensaio revertido).';
        ELSE
            RAISE;
        END IF;
END;
$conf$;
