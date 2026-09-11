-- Migration: "Esqueci meu PIN" - redefinicao por link enviado ao e-mail cadastrado
-- Data: 2026-09-11
--
-- Diario: docs/evolucao/2026-09-11-esqueci-meu-pin-no-portal.md
--
-- ============================================================================
-- POR QUE
-- ============================================================================
-- Quem esquece o PIN nao entra no Portal - e e' dentro do Portal que mora a unica tela de troca
-- (fn_trocar_pin_portal, 20260830170000). A saida era ligar para o coordenador. Medido em
-- 11/09/2026: 1.757 dos 2.647 servidores ativos tem e-mail cadastrado, entao o caminho alcanca
-- 2 em cada 3; os outros 890 continuam dependendo do coordenador, e isso e' explicito na tela.
--
-- ============================================================================
-- A DECISAO CENTRAL: LINK, NUNCA PIN NOVO PRONTO  (usuario, 11/09/2026)
-- ============================================================================
-- 🚨 Gerar um PIN novo e manda-lo por e-mail parece mais simples e e' PERIGOSO: bastaria digitar
-- a matricula de um colega - que esta impressa no cracha e aparece em toda tela do sistema -
-- para DERRUBAR o PIN dele. E este PIN nao e' so do Portal: e' a credencial do terminal de
-- ponto (armadilha 43). A pessoa descobriria na frente do relogio, sem conseguir bater, e a
-- recusa por PIN invalido e' a unica que ainda existe depois da conformidade da v1.22.0 -
-- vira tentativa recusada, nao marcacao.
--
-- Com link, o pedido de um terceiro nao muda NADA: o PIN atual continua valendo ate que alguem
-- com acesso a caixa de e-mail clique e escolha outro. O custo de um pedido indevido cai de
-- "colega sem bater ponto" para "um e-mail ignorado".
--
-- ============================================================================
-- O QUE NAO PODE SER DESFEITO
-- ============================================================================
--   1. 🚨 O bloqueio de 5 tentativas NAO se aplica a este caminho, e isso e deliberado. Quem
--      esqueceu o PIN provavelmente errou 5 vezes e ESTA bloqueado - e e' exatamente essa
--      pessoa que precisa do link. Amarrar a saida ao bloqueio a prenderia justamente no estado
--      em que ela pede ajuda. A prova aqui e' a posse do e-mail, nao o PIN que ela nao tem.
--
--   2. 🚨 Pedir o link NAO incrementa pin_failed_attempts. Se incrementasse, qualquer pessoa
--      bloquearia o login de um colega repetindo o pedido - transformando a funcao de socorro
--      em negacao de servico.
--
--   3. A regra do PIN novo continua vindo de fn_validar_pin_novo, chamada aqui para a mensagem
--      legivel e reaplicada pelo trigger de hash. ⚠️ A regra vale na ESCRITA, nunca na leitura:
--      os PINs de 4 digitos legados continuam entrando no login e no terminal (armadilha 43).
--      Nao "uniformize" fazendo o login chamar esta validacao.
--
--   4. Redefinir ZERA pin_failed_attempts. Quem acabou de provar posse do e-mail nao pode
--      continuar bloqueado por tentativas antigas - seria resolver e nao resolver.
--
-- ============================================================================
-- QUEM NUNCA TEVE PIN TAMBEM PASSA, DE PROPOSITO
-- ============================================================================
-- Nao ha exigencia de pin_acesso preenchido. Servidor sem PIN hoje nao entra no Portal nem bate
-- ponto no terminal, e a prova exigida e a mesma de quem esqueceu: posse do e-mail que o
-- coordenador cadastrou na ficha dele. Barrar esse caso manteria uma segunda fila no
-- coordenador sem ganho de seguranca nenhum.


-- ============================================================================
-- 1. O LOG DE TROCA PASSA A RECONHECER A ORIGEM NOVA
-- ============================================================================
-- Sem isto a redefinicao morre no CHECK - e o CHECK so falha na EXECUCAO (armadilha 1), ou
-- seja, na primeira pessoa real que tentasse usar o link.

ALTER TABLE public.logs_troca_pin DROP CONSTRAINT IF EXISTS chk_logs_troca_pin_origem;
ALTER TABLE public.logs_troca_pin
    ADD CONSTRAINT chk_logs_troca_pin_origem
    CHECK (origem IN ('portal', 'coordenador', 'portal_email'));

COMMENT ON COLUMN public.logs_troca_pin.origem IS
    'portal = o proprio servidor trocou logado (fn_trocar_pin_portal); coordenador = redefinido '
    'na retaguarda; portal_email = redefinido pelo link de "Esqueci meu PIN".';


-- ============================================================================
-- 2. PEDIR O LINK
-- ============================================================================
-- ⚠️ Esta funcao devolve o token CRU e o e-mail para QUEM A CHAMA - a Server Action, com
-- service_role, que envia a mensagem. O navegador nunca ve nem um nem outro: a action responde
-- sempre a mesma frase, tenha achado alguem ou nao (a neutralidade e' da CAMADA DE CIMA; aqui,
-- distinguir e' necessario para saber se ha e-mail a enviar).

CREATE OR REPLACE FUNCTION public.fn_solicitar_redefinicao_pin(
    p_matricula  text,
    p_ip         text DEFAULT NULL,
    p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    c_prazo_minutos constant integer := 30;
    c_max_por_hora  constant integer := 3;

    v_id      uuid;
    v_nome    text;
    v_email   text;
    v_recentes integer;
    v_token   text;
BEGIN
    SELECT s.id, s.nome, NULLIF(btrim(s.email), '')
      INTO v_id, v_nome, v_email
      FROM public.servidores s
     WHERE s.matricula = p_matricula
       AND s.status = 'Ativo';

    -- Matricula e unica entre os ativos (medido em 30/08/2026: 1385/1385 distintas). Sem
    -- SELECT INTO de multiplas linhas, portanto - mas se um dia deixar de ser, o comportamento
    -- e' pegar uma linha arbitraria, o que aqui significa mandar o link para a pessoa errada.
    IF v_id IS NULL THEN
        RETURN jsonb_build_object('enviar', false, 'motivo', 'nao_encontrado');
    END IF;

    IF v_email IS NULL THEN
        RETURN jsonb_build_object('enviar', false, 'motivo', 'sem_email');
    END IF;

    -- Teto de pedidos por hora. Protege a caixa de e-mail da pessoa (e a reputacao do
    -- remetente) sem tocar em pin_failed_attempts - ver o item 2 do cabecalho.
    SELECT count(*) INTO v_recentes
      FROM public.tokens_portal t
     WHERE t.servidor_id = v_id
       AND t.finalidade = 'redefinir_pin'
       AND t.criado_em > now() - interval '1 hour';

    IF v_recentes >= c_max_por_hora THEN
        RETURN jsonb_build_object('enviar', false, 'motivo', 'muitos_pedidos');
    END IF;

    v_token := public.fn_emitir_token_portal(
        v_id, 'redefinir_pin', c_prazo_minutos, p_ip, p_user_agent);

    RETURN jsonb_build_object(
        'enviar',  true,
        'token',   v_token,
        'email',   v_email,
        'nome',    v_nome,
        'minutos', c_prazo_minutos
    );
END;
$fn$;

COMMENT ON FUNCTION public.fn_solicitar_redefinicao_pin(text, text, text) IS
    'Emite o token de "Esqueci meu PIN" e devolve token + e-mail para quem envia a mensagem. '
    'NAO toca em pin_failed_attempts: pedir o link nunca pode bloquear o login de ninguem.';

REVOKE ALL ON FUNCTION public.fn_solicitar_redefinicao_pin(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_solicitar_redefinicao_pin(text, text, text) TO service_role;


-- ============================================================================
-- 3. REDEFINIR COM O TOKEN
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_redefinir_pin_com_token(
    p_token      text,
    p_pin_novo   text,
    p_ip         text DEFAULT NULL,
    p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
    v_res       jsonb;
    v_id        uuid;
    v_matricula text;
    v_nome      text;
    v_check     jsonb;
BEGIN
    -- A REGRA DO PIN VEM ANTES DE QUEIMAR O TOKEN. Validar depois gastaria o link por um PIN
    -- curto demais, e a pessoa teria de pedir outro e-mail para corrigir um erro de digitacao.
    -- A matricula ainda nao e conhecida aqui, entao a checagem contra ela e refeita adiante.
    v_check := public.fn_validar_pin_novo(p_pin_novo, NULL);
    IF NOT (v_check ->> 'ok')::boolean THEN
        RETURN jsonb_build_object(
            'resultado', 'pin_recusado',
            'motivo',    v_check ->> 'motivo',
            'minimo',    COALESCE((v_check ->> 'minimo')::integer, 6),
            'maximo',    COALESCE((v_check ->> 'maximo')::integer, 8)
        );
    END IF;

    v_res := public.fn_consumir_token_portal(p_token, 'redefinir_pin');
    IF NOT (v_res->>'success')::boolean THEN
        RETURN jsonb_build_object('resultado', 'token_invalido', 'motivo', v_res->>'motivo');
    END IF;

    SELECT s.id, s.matricula, s.nome
      INTO v_id, v_matricula, v_nome
      FROM public.servidores s
     WHERE s.id = (v_res->>'servidor_id')::uuid
       AND s.status = 'Ativo'
     FOR UPDATE;

    IF v_id IS NULL THEN
        -- Inativado entre o pedido e o clique. O token ja foi queimado de proposito: ele nao
        -- deve continuar valendo para um cadastro que saiu do ar.
        RETURN jsonb_build_object('resultado', 'servidor_indisponivel');
    END IF;

    -- Agora com a matricula em maos: PIN igual a matricula e recusado (ela esta no cracha).
    v_check := public.fn_validar_pin_novo(p_pin_novo, v_matricula);
    IF NOT (v_check ->> 'ok')::boolean THEN
        RETURN jsonb_build_object(
            'resultado', 'pin_recusado',
            'motivo',    v_check ->> 'motivo',
            'minimo',    COALESCE((v_check ->> 'minimo')::integer, 6),
            'maximo',    COALESCE((v_check ->> 'maximo')::integer, 8)
        );
    END IF;

    -- Grava em texto claro; trigger_hash_servidor_pin aplica o bcrypt e revalida a regra.
    --
    -- 🚨 ZERAR o contador e o carimbo faz parte do conserto: quem chegou ate aqui provou posse
    -- do e-mail, e continuar bloqueado por tentativas anteriores seria resolver pela metade -
    -- justamente para a pessoa que so pediu o link porque ja tinha errado 5 vezes.
    UPDATE public.servidores
       SET pin_acesso          = p_pin_novo,
           pin_failed_attempts = 0,
           last_pin_attempt    = NULL
     WHERE id = v_id;

    INSERT INTO public.logs_troca_pin (servidor_id, origem, ip_origem, user_agent)
    VALUES (v_id, 'portal_email', p_ip, p_user_agent);

    RETURN jsonb_build_object('resultado', 'ok', 'nome', v_nome, 'matricula', v_matricula);
END;
$fn$;

COMMENT ON FUNCTION public.fn_redefinir_pin_com_token(text, text, text, text) IS
    'Passo 2 do "Esqueci meu PIN": valida a regra, queima o token e grava o PIN novo, zerando o '
    'bloqueio de tentativas. NAO exige o PIN atual - a prova e a posse do token.';

REVOKE ALL ON FUNCTION public.fn_redefinir_pin_com_token(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_redefinir_pin_com_token(text, text, text, text) TO service_role;


-- ============================================================================
-- VERIFICACAO - EXECUTA as funcoes (armadilha 42)
-- ============================================================================
-- Todo o ensaio roda com um servidor REAL e e' revertido por RAISE EXCEPTION proposital ao
-- final: nenhum PIN de producao e alterado.

DO $verifica$
DECLARE
    v_serv   uuid;
    v_mat    text;
    v_res    jsonb;
    v_token  text;
    v_antes  text;
    v_depois text;
    v_tent   integer;
BEGIN
    BEGIN
        SELECT id, matricula, pin_acesso INTO v_serv, v_mat, v_antes
          FROM public.servidores
         WHERE status = 'Ativo' AND email IS NOT NULL AND btrim(email) <> ''
               AND pin_acesso IS NOT NULL
         LIMIT 1;

        IF v_serv IS NULL THEN
            RAISE NOTICE 'OK (parcial): sem servidor ativo com e-mail e PIN para o ensaio.';
            RETURN;
        END IF;

        -- Simula alguem bloqueado por tentativas: e o caso que motivou a funcao.
        UPDATE public.servidores
           SET pin_failed_attempts = 5, last_pin_attempt = now()
         WHERE id = v_serv;

        -- --- pedir o link -----------------------------------------------------------------
        v_res := public.fn_solicitar_redefinicao_pin(v_mat, '127.0.0.1', 'ensaio');
        IF NOT (v_res->>'enviar')::boolean THEN
            RAISE EXCEPTION 'ABORTADO: pedido de redefinicao recusado para servidor valido (%).',
                v_res->>'motivo';
        END IF;
        v_token := v_res->>'token';

        -- Pedir o link NAO pode mexer no contador de tentativas.
        SELECT pin_failed_attempts INTO v_tent FROM public.servidores WHERE id = v_serv;
        IF v_tent <> 5 THEN
            RAISE EXCEPTION 'ABORTADO: pedir o link alterou pin_failed_attempts (% em vez de 5).', v_tent;
        END IF;

        -- Matricula inexistente nao pode estourar; devolve recusa silenciosa.
        v_res := public.fn_solicitar_redefinicao_pin('__NAO_EXISTE__', NULL, NULL);
        IF (v_res->>'enviar')::boolean THEN
            RAISE EXCEPTION 'ABORTADO: matricula inexistente gerou token.';
        END IF;

        -- --- PIN fraco e recusado SEM queimar o token --------------------------------------
        v_res := public.fn_redefinir_pin_com_token(v_token, '111111', NULL, NULL);
        IF v_res->>'resultado' <> 'pin_recusado' THEN
            RAISE EXCEPTION 'ABORTADO: PIN repetido foi aceito (%).', v_res::text;
        END IF;

        -- --- o PIN valido passa, e o bloqueio cai ------------------------------------------
        v_res := public.fn_redefinir_pin_com_token(v_token, '918273', '127.0.0.1', 'ensaio');
        IF v_res->>'resultado' <> 'ok' THEN
            RAISE EXCEPTION 'ABORTADO: PIN valido recusado no token ainda vivo (%).', v_res::text;
        END IF;

        SELECT pin_acesso, pin_failed_attempts INTO v_depois, v_tent
          FROM public.servidores WHERE id = v_serv;

        IF v_depois = v_antes THEN
            RAISE EXCEPTION 'ABORTADO: o PIN nao foi alterado.';
        END IF;
        IF v_depois NOT LIKE '$2%' THEN
            RAISE EXCEPTION 'ABORTADO: PIN gravado SEM hash - o trigger nao rodou.';
        END IF;
        IF v_tent <> 0 THEN
            RAISE EXCEPTION 'ABORTADO: redefinir nao zerou o bloqueio de tentativas (%).', v_tent;
        END IF;

        -- --- uso unico: o mesmo link nao redefine duas vezes --------------------------------
        v_res := public.fn_redefinir_pin_com_token(v_token, '827364', NULL, NULL);
        IF v_res->>'resultado' <> 'token_invalido' THEN
            RAISE EXCEPTION 'ABORTADO: o token foi aceito uma SEGUNDA vez (%).', v_res::text;
        END IF;

        -- --- privilegios ---------------------------------------------------------------------
        IF has_function_privilege('anon', 'public.fn_solicitar_redefinicao_pin(text, text, text)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.fn_redefinir_pin_com_token(text, text, text, text)', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.fn_redefinir_pin_com_token(text, text, text, text)', 'EXECUTE') THEN
            RAISE EXCEPTION 'ABORTADO: redefinicao de PIN executavel por anon/authenticated.';
        END IF;

        -- 🚨 O login NAO pode passar a exigir a regra do PIN novo: os 826 PINs de 4 digitos
        -- legados perderiam o Portal E o terminal de ponto no mesmo instante (armadilha 43).
        IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname IN ('fn_validar_pin_portal', 'verify_pin')
                      AND p.prosrc ILIKE '%fn_validar_pin_novo%') THEN
            RAISE EXCEPTION 'ABORTADO: a regra do PIN novo vazou para o caminho de LOGIN.';
        END IF;

        RAISE EXCEPTION 'ENSAIO_OK';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM = 'ENSAIO_OK' THEN
                RAISE NOTICE 'OK: pedido nao mexe no bloqueio, PIN fraco recusado sem queimar o link, redefinicao grava com hash, zera o bloqueio e o token so serve uma vez (ensaio revertido).';
            ELSE
                RAISE;
            END IF;
    END;
END
$verifica$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve)
-- ============================================================================
--
-- 1) Quantos servidores o caminho alcanca hoje:
--
--      SELECT count(*) FILTER (WHERE email IS NOT NULL AND btrim(email) <> '') AS com_email,
--             count(*)                                                        AS ativos
--        FROM servidores WHERE status = 'Ativo';
--
-- 2) Uso real do link (e quem ainda depende do coordenador):
--
--      SELECT origem, count(*) FROM logs_troca_pin GROUP BY 1 ORDER BY 2 DESC;
--
-- 3) Tokens emitidos e o que aconteceu com eles:
--
--      SELECT finalidade,
--             count(*) FILTER (WHERE usado_em IS NOT NULL)       AS usados,
--             count(*) FILTER (WHERE substituido_em IS NOT NULL) AS substituidos,
--             count(*) FILTER (WHERE usado_em IS NULL AND substituido_em IS NULL
--                                AND expira_em < now())          AS expirados_sem_uso
--        FROM tokens_portal GROUP BY 1;
--
--      -- expirados_sem_uso alto em 'redefinir_pin' significa link chegando e nao sendo clicado:
--      -- olhe o SPAM do remetente antes de concluir que a pessoa desistiu.
