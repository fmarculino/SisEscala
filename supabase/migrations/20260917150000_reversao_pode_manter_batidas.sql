-- Migration: reverter presenca pode MANTER a batida real em circulacao
-- Data: 2026-09-17
-- Plano: docs/planos/2026-09-17-batida-que-nao-alcanca-a-escala-certa.md (defeito D2, saida B1)
-- Gerada por scratchpad/gen_reversao_mantem_batidas.js a partir de DUAS fontes:
--   fn_reverter_presenca_manual            <- 20260917100000_reverter_presenca_limpa_origem.sql
--   fn_sincronizar_marcacoes_escala_diaria <- 20260917110000_desconsiderar_na_reversao.sql
--   NAO EDITAR A MAO: regenere pelo script, que aborta se qualquer fonte divergir.
--
-- DEPENDE DE 20260917140000 (fn_batida_fisica). Aplicar fora de ordem morre em runtime, nao
-- no CREATE: plpgsql so resolve nome de funcao na EXECUCAO (armadilha 1).
--
-- O QUE ESTAVA ERRADO
--   O trigger de sincronizacao grava 'desconsiderar' sempre que um UPDATE zera um passo de
--   presenca, e nao sabe POR QUE o passo esta sendo zerado. Sao duas intencoes opostas:
--
--     "o horario esta errado"   -> a batida tem de sair de circulacao. E para isso que o
--                                  tratamento existe, e continua sendo o default.
--     "a ESCALA esta errada e   -> a batida REAL da pessoa nao tem nada de errado. Hoje ela
--      vou relancar o dia"         sai junto, e o "Preencher pelas Batidas" nao a traz de
--                                  volta: fn_alocar_marcacoes_dia filtra desconsiderada.
--
--   Medido em producao em 17/09/2026: 173 batidas FISICAS fora de circulacao, 20 dias com
--   escala e passo vazio, 16 deles com a tela respondendo "Nada a preencher neste dia".
--   So em 17/09 foram 47 batidas rep, em 14 servidores -- THAYNA (mat 69051) com 12 e GISELE
--   (mat 62240) com 10.
--
-- 🚨 POR QUE NAO "O TRIGGER NUNCA DESCONSIDERA BATIDA FISICA"
--   Essa era a correcao de uma linha, e ela QUEBRA a reversao intencional: a batida de teste,
--   a batida da pessoa errada e a batida indevida voltariam sozinhas na proxima reconciliacao.
--   E foi exatamente o defeito que a 20260917110000 acabou de fechar. A intencao precisa ser
--   DECLARADA por quem reverte -- o banco nao tem como adivinha-la.
--
-- 🚨 ASSINATURA NOVA E OBJETO NOVO (armadilhas 24 e 41)
--   p_manter_batidas tem DEFAULT, entao a chamada de 5 argumentos continua valendo -- MAS as
--   duas assinaturas conviveriam e o PostgREST devolveria PGRST203 ("could not choose the best
--   candidate"). A de 5 argumentos e DERRUBADA aqui, e os privilegios sao REESCRITOS: objeto
--   novo nasce com EXECUTE para PUBLIC.
--
-- ORDEM DE DEPLOY
--   O bundle anterior chama com 5 argumentos e resolve para a assinatura nova com
--   p_manter_batidas = false, que e o comportamento de hoje. Nao ha janela de quebra.


-- ============================================================================
-- 1. A REVERSAO (copia mecanica; so o que esta marcado no gerador mudou)
-- ============================================================================
DROP FUNCTION IF EXISTS public.fn_reverter_presenca_manual(uuid, integer, text, text, uuid);

CREATE OR REPLACE FUNCTION public.fn_reverter_presenca_manual(
    p_escala_mensal_id uuid,
    p_dia integer,
    p_categoria text,
    p_tipo text,
    p_validador_id uuid,
    -- POR QUE a reversao esta sendo feita. false (o default, o comportamento de sempre) = o
    -- horario esta errado, entao a batida sai de circulacao. true = a ESCALA esta errada e o
    -- dia vai ser relancado, entao a batida REAL continua disponivel para a proxima
    -- reconciliacao.
    --
    -- ⚠️ DEFAULT false de proposito: um chamador que nao sabe da distincao tem de continuar
    --    tendo o comportamento antigo. Errar para o lado de "sai de circulacao" e recuperavel
    --    (fn_restaurar_batidas_dia); errar para o outro repoe sozinho um horario que alguem
    --    mandou tirar.
    p_manter_batidas boolean DEFAULT false
)
RETURNS jsonb AS $$
DECLARE
    v_servidor_id UUID;
    v_unidade_id UUID;
BEGIN
    SELECT servidor_id, unidade_id INTO v_servidor_id, v_unidade_id
    FROM public.escala_mensal WHERE id = p_escala_mensal_id;

    -- A intencao viaja por GUC porque quem precisa dela e o TRIGGER de sincronizacao, que nao
    -- recebe parametro nenhum. Mesmo mecanismo de sisescala.reconciliacao e sisescala.fundir_setor.
    IF p_manter_batidas THEN
        PERFORM set_config('sisescala.reversao_mantem_batidas', 'on', true);
    END IF;

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
        PERFORM set_config('sisescala.reversao_mantem_batidas', 'off', true);
        RETURN jsonb_build_object('success', false, 'message', 'Tipo de reversão inválido.');
    END IF;

    -- Update presenca_confirmada to false if all times are NULL
    UPDATE public.escala_diaria
    SET presenca_confirmada = false, confirmado_por_id = NULL
    WHERE escala_mensal_id = p_escala_mensal_id AND dia = p_dia AND categoria::text = p_categoria
      AND presenca_entrada_em IS NULL AND presenca_intervalo_saida_em IS NULL
      AND presenca_intervalo_retorno_em IS NULL AND presenca_saida_em IS NULL;

    -- 🚨 DESLIGA NA MESMA TRANSACAO. set_config(..., true) e local a TRANSACAO, nao a funcao:
    -- deixar ligado faria o proximo UPDATE em escala_diaria desta transacao (o upsert em lote
    -- do "Salvar Previsao", por exemplo) herdar a excecao em silencio.
    PERFORM set_config('sisescala.reversao_mantem_batidas', 'off', true);

    RETURN jsonb_build_object('success', true,
        'message', CASE WHEN p_manter_batidas
                        THEN 'Presença revertida. As batidas reais continuam disponíveis.'
                        ELSE 'Presença revertida com sucesso.' END,
        'manteve_batidas', COALESCE(p_manter_batidas, false));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.fn_reverter_presenca_manual(uuid, integer, text, text, uuid, boolean)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reverter_presenca_manual(uuid, integer, text, text, uuid, boolean)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_reverter_presenca_manual(uuid, integer, text, text, uuid, boolean) IS
    'Zera um passo de presenca em escala_diaria: horario, flag manual, ORIGEM e marcacao_id. '
    'p_manter_batidas declara POR QUE: false (default) tira a batida de circulacao, como sempre; '
    'true poupa a batida FISICA, para quem esta corrigindo a ESCALA e vai relancar o dia. '
    'A intencao chega ao trigger de sincronizacao pelo GUC sisescala.reversao_mantem_batidas, '
    'que e DESLIGADO antes do retorno -- set_config local vale para a transacao, nao para a funcao.';


-- ============================================================================
-- 2. O TRIGGER (copia mecanica; so o que esta marcado no gerador mudou)
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
    v_mantem      boolean;
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

        -- Quem reverteu declarou que a ESCALA estava errada e o dia vai ser relancado
        -- (fn_reverter_presenca_manual com p_manter_batidas). Ausente = 'off' = comportamento
        -- de sempre: o default de uma regra de retirada e RETIRAR.
        v_mantem := COALESCE(current_setting('sisescala.reversao_mantem_batidas', true), 'off') = 'on';

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
               -- 🚨 SO A BATIDA FISICA e poupada, e so quando a intencao foi declarada.
               -- O horario DECLARADO (ajuste_coordenador / ajuste_servidor) e o FABRICADO
               -- (terminal sintetica, de fn_salvar_saida_bloco) continuam saindo de circulacao
               -- nos dois modos: quem reverteu esta desfazendo a propria declaracao, e manter
               -- o fabricado em circulacao faria a reconciliacao repo-lo como se fosse fato.
               AND NOT (v_mantem AND public.fn_batida_fisica(m.origem, m.sintetica))
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
-- 3. CONFERENCIA -- EXECUTA os dois caminhos (armadilha 42), ensaio revertido
-- ============================================================================
-- Confere os DOIS SENTIDOS. Afrouxar so um lado e o modo de falha perigoso aqui:
--   poupar demais -> batida indevida volta sozinha na proxima reconciliacao;
--   poupar de menos -> continua o defeito que a migration existe para fechar.

DO $conf$
DECLARE
    v_ed      record;
    v_autor   uuid;
    v_marc    uuid;
    v_n       integer;
    v_assin   integer;
BEGIN
    -- 3.1 Exatamente UMA fn_reverter_presenca_manual (sobrecarga = PGRST203)
    SELECT count(*) INTO v_assin
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_reverter_presenca_manual';
    IF v_assin <> 1 THEN
        RAISE EXCEPTION 'ABORTADO: ha % versao(oes) de fn_reverter_presenca_manual (esperado 1).', v_assin;
    END IF;

    -- 3.2 anon nao executa; authenticated continua executando (a grade chama com sessao)
    IF has_function_privilege('anon', 'public.fn_reverter_presenca_manual(uuid, integer, text, text, uuid, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon ainda executa fn_reverter_presenca_manual.';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.fn_reverter_presenca_manual(uuid, integer, text, text, uuid, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated PERDEU fn_reverter_presenca_manual -- a grade para de reverter.';
    END IF;

    SELECT p.id INTO v_autor FROM public.profiles p LIMIT 1;
    IF v_autor IS NULL THEN
        RAISE NOTICE 'CONFERENCIA 20260917150000: sem profiles; ensaio pulado.';
        RETURN;
    END IF;

    -- 3.3 Ensaio: uma linha com SAIDA preenchida, competencia aberta.
    SELECT ed.id, ed.escala_mensal_id, ed.dia, ed.categoria::text AS categoria, em.servidor_id, em.unidade_id
      INTO v_ed
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE ed.presenca_saida_em IS NOT NULL
       AND ed.categoria::text <> 'Sobreaviso'
       AND NOT public.fn_competencia_encerrada(em.mes, em.ano)
     LIMIT 1;

    IF v_ed.id IS NULL THEN
        RAISE NOTICE 'CONFERENCIA 20260917150000: nenhuma linha com saida em competencia aberta; ensaio pulado.';
        RETURN;
    END IF;

    -- (a) MODO DECLARADO: a batida FISICA e poupada.
    INSERT INTO public.marcacoes_ponto
        (servidor_id, origem, ocorrido_em, unidade_id, sintetica, observacao)
    VALUES (v_ed.servidor_id, 'terminal',
            (SELECT presenca_saida_em FROM public.escala_diaria WHERE id = v_ed.id),
            v_ed.unidade_id, false, 'CONFERENCIA 20260917150000')
    RETURNING id INTO v_marc;

    UPDATE public.escala_diaria
       SET presenca_saida_origem = 'terminal'::public.marcacao_origem,
           presenca_saida_marcacao_id = v_marc
     WHERE id = v_ed.id;

    PERFORM public.fn_reverter_presenca_manual(
        v_ed.escala_mensal_id, v_ed.dia, v_ed.categoria, 'saida', v_autor, true);

    IF public.fn_marcacao_desconsiderada(v_marc) THEN
        RAISE EXCEPTION 'ABORTADO(a): o modo declarado NAO poupou a batida fisica.';
    END IF;

    -- 🚨 O GUC tem de estar DESLIGADO depois do retorno: ele e local a TRANSACAO.
    IF COALESCE(current_setting('sisescala.reversao_mantem_batidas', true), 'off') = 'on' THEN
        RAISE EXCEPTION 'ABORTADO: o GUC ficou LIGADO depois da reversao -- o proximo UPDATE desta transacao herdaria a excecao.';
    END IF;

    -- (b) MODO PADRAO: a mesma batida sai de circulacao.
    UPDATE public.escala_diaria
       SET presenca_saida_em = (SELECT ocorrido_em FROM public.marcacoes_ponto WHERE id = v_marc),
           presenca_saida_origem = 'terminal'::public.marcacao_origem,
           presenca_saida_marcacao_id = v_marc
     WHERE id = v_ed.id;

    PERFORM public.fn_reverter_presenca_manual(
        v_ed.escala_mensal_id, v_ed.dia, v_ed.categoria, 'saida', v_autor);

    IF NOT public.fn_marcacao_desconsiderada(v_marc) THEN
        RAISE EXCEPTION 'ABORTADO(b): o modo PADRAO deixou de tirar a batida de circulacao -- a reversao intencional voltou a nao durar.';
    END IF;

    -- (c) Horario DECLARADO sai de circulacao nos DOIS modos.
    -- ⚠️ chk_marcacao_ajuste_justificado: origem de AJUSTE exige justificativa preenchida.
    --    Restricao de coluna so aparece na EXECUCAO -- nenhum portao de texto sabe o schema.
    INSERT INTO public.marcacoes_ponto
        (servidor_id, origem, ocorrido_em, unidade_id, sintetica, observacao, coordenador_id, justificativa)
    VALUES (v_ed.servidor_id, 'ajuste_coordenador',
            (SELECT ocorrido_em FROM public.marcacoes_ponto WHERE id = v_marc) + interval '7 minutes',
            v_ed.unidade_id, false, 'CONFERENCIA 20260917150000 declarado', v_autor,
            'CONFERENCIA 20260917150000: horario declarado pelo coordenador')
    RETURNING id INTO v_marc;

    UPDATE public.escala_diaria
       SET presenca_saida_em = (SELECT ocorrido_em FROM public.marcacoes_ponto WHERE id = v_marc),
           presenca_saida_origem = 'ajuste_coordenador'::public.marcacao_origem,
           presenca_saida_marcacao_id = v_marc,
           presenca_saida_manual = true
     WHERE id = v_ed.id;

    PERFORM public.fn_reverter_presenca_manual(
        v_ed.escala_mensal_id, v_ed.dia, v_ed.categoria, 'saida', v_autor, true);

    IF NOT public.fn_marcacao_desconsiderada(v_marc) THEN
        RAISE EXCEPTION 'ABORTADO(c): horario DECLARADO foi poupado no modo declarado -- quem reverte esta desfazendo a propria declaracao.';
    END IF;

    RAISE EXCEPTION 'CONFERENCIA_OK_ROLLBACK';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'CONFERENCIA_OK_ROLLBACK' THEN
            RAISE NOTICE 'CONFERENCIA 20260917150000: OK nos tres sentidos (ensaio revertido).';
        ELSE
            RAISE;
        END IF;
END;
$conf$;
