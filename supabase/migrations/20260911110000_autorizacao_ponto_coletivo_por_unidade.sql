-- ============================================================================
-- Migration: RH da Unidade concede/revoga dispensa de ponto nas unidades dele
-- Data: 2026-09-11
-- ============================================================================
--
-- MOTIVO
--
-- A decisao de 27/08/2026 (20260827020000) foi "so o RH Geral concede: o oficio e' enderecado a
-- RH central", e ela esta escrita em tres lugares — a action, a tela e estas duas funcoes.
-- Decisao NOVA do usuario em 10/09/2026, ao abrir /marcacoes para os RHs: o RH da Unidade
-- concede e revoga DENTRO das unidades dele.
--
-- ⚠️ Medido antes de mexer: `autorizacoes_ponto_coletivo` tem **0 linhas** em producao. Ninguem
-- nunca concedeu uma — nao ha autorizacao vigente para reavaliar, e nenhuma folha muda de valor
-- com esta migration.
--
-- O QUE MUDA E O QUE NAO MUDA
--
-- Muda: `rh_unidade` entra na allowlist, e o alcance dele e' recortado pelo predicado
-- compartilhado `fn_escopo_gestao_alcanca`, aplicado a unidade DO SERVIDOR — nao a do usuario.
--
-- 🚨 O DIRETOR (`admin`) CONTINUA DE FORA, e a allowlist existe por causa dele. O predicado
-- `fn_escopo_gestao_alcanca` trata `admin` como irrestrito (e' assim que ele se comporta no
-- resto de /marcacoes, onde sempre teve acesso), entao usar SO o predicado aqui daria ao Diretor
-- o poder de dispensar de bater ponto qualquer servidor da rede — exatamente o que a decisao de
-- 27/08/2026 recusou, nomeando-o. Papel decide QUEM; o predicado decide ATE ONDE. Os dois.
--
-- Nao muda: continua exigindo numero de oficio/processo e motivo, continua recusando dispensar a
-- batida de SAIDA, continua registrando em logs_sistema, e revogar continua nao desfazendo o que
-- ja foi declarado. Dispensar alguem de bater ponto continua sendo ato documentado.
--
-- ⚠️ O escopo e' por SERVIDOR, um a um, e nao pelo lote. O RH da Unidade que selecionar sete
-- pessoas e tiver tres fora do escopo recebe quatro concedidas e TRES LINHAS DE ERRO nomeando
-- quem ficou de fora — o mecanismo de erro por servidor ja existia para autorizacao sobreposta.
-- Recusar o lote inteiro esconderia quais eram as tres; pular em silencio seria pior ainda
-- (armadilha 22: relatar o que foi calculado em vez do que mudou).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_conceder_autorizacao_ponto_coletivo(
    p_servidor_ids    uuid[],
    p_passos          text[],
    p_vigencia_inicio date,
    p_vigencia_fim    date,
    p_documento       text,
    p_motivo          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_servidor  uuid;
    v_criadas   integer := 0;
    v_erros     jsonb := '[]'::jsonb;
    v_nome      text;
    v_unidade   uuid;
BEGIN
    -- Papel decide QUEM. O Diretor (admin) fica de fora de proposito — ver o cabecalho.
    IF (SELECT public.get_my_role()) NOT IN ('super_admin'::public.user_role,
                                             'rh'::public.user_role,
                                             'rh_unidade'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas o RH pode autorizar validacao coletiva de ponto.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_documento IS NULL OR btrim(p_documento) = '' THEN
        RAISE EXCEPTION 'Informe o numero do oficio ou processo que autoriza.';
    END IF;

    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Informe o motivo da autorizacao.';
    END IF;

    IF p_servidor_ids IS NULL OR array_length(p_servidor_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'Selecione ao menos um servidor.';
    END IF;

    -- O CHECK da tabela ja' barra 'saida', mas a mensagem crua de constraint nao explica nada
    -- para quem esta' na tela.
    IF 'saida' = ANY(p_passos) THEN
        RAISE EXCEPTION
            'A batida de saida nao pode ser dispensada: e o registro real que sustenta a folha.';
    END IF;

    FOREACH v_servidor IN ARRAY p_servidor_ids LOOP
        SELECT nome, unidade_id INTO v_nome, v_unidade
          FROM public.servidores WHERE id = v_servidor;

        -- Escopo por servidor. Fora do alcance vira LINHA DE ERRO nomeando a pessoa, nunca
        -- pulo silencioso: quem clicou precisa saber quem ficou de fora e por que.
        IF NOT public.fn_escopo_gestao_alcanca(v_unidade) THEN
            v_erros := v_erros || jsonb_build_object(
                'servidor_id', v_servidor,
                'servidor_nome', COALESCE(v_nome, '(desconhecido)'),
                'erro', 'Servidor lotado fora das suas unidades - so o RH Geral ou o '
                        'Administrador Geral podem autorizar este.');
            CONTINUE;
        END IF;

        BEGIN
            INSERT INTO public.autorizacoes_ponto_coletivo (
                servidor_id, passos, vigencia_inicio, vigencia_fim,
                documento, motivo, autorizado_por_id
            ) VALUES (
                v_servidor, p_passos, p_vigencia_inicio, p_vigencia_fim,
                btrim(p_documento), btrim(p_motivo), auth.uid()
            );
            v_criadas := v_criadas + 1;
        EXCEPTION WHEN OTHERS THEN
            -- Um servidor com autorizacao sobreposta nao pode derrubar o lote inteiro: o RH
            -- lanca os sete de uma vez e precisa saber qual dos sete ficou de fora, e por que.
            v_erros := v_erros || jsonb_build_object(
                'servidor_id', v_servidor,
                'servidor_nome', COALESCE(v_nome, '(desconhecido)'),
                'erro', SQLERRM);
        END;
    END LOOP;

    -- Nenhum servidor alcancado E nenhuma criada: e' recusa de permissao, nao "lote vazio".
    -- Sem esta linha o RH da Unidade que errasse a unidade inteira receberia "0 concedidas" com
    -- cara de sucesso.
    IF v_criadas = 0 AND jsonb_array_length(v_erros) = array_length(p_servidor_ids, 1) THEN
        RAISE EXCEPTION 'Nenhum dos servidores selecionados esta nas suas unidades.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    INSERT INTO public.logs_sistema (user_id, acao, detalhes)
    VALUES (auth.uid(), 'autorizacao_ponto_coletivo_concedida', jsonb_build_object(
        'servidores', array_length(p_servidor_ids, 1),
        'criadas', v_criadas,
        'passos', p_passos,
        'documento', btrim(p_documento),
        'vigencia_inicio', p_vigencia_inicio,
        'vigencia_fim', p_vigencia_fim));

    RETURN jsonb_build_object(
        'success', true,
        'criadas', v_criadas,
        'erros', v_erros,
        'message', format('%s autorizacao(oes) concedida(s).', v_criadas));
END;
$fn$;

COMMENT ON FUNCTION public.fn_conceder_autorizacao_ponto_coletivo(uuid[], text[], date, date, text, text) IS
    'Concede autorizacao de validacao coletiva. Administrador Geral, Diretor e RH Geral em '
    'qualquer unidade; RH da Unidade so nos servidores lotados nas unidades dele (predicado '
    'fn_escopo_gestao_alcanca). Servidor fora do escopo vira linha de erro nomeando a pessoa, '
    'nao pulo silencioso.';

REVOKE ALL ON FUNCTION public.fn_conceder_autorizacao_ponto_coletivo(uuid[], text[], date, date, text, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conceder_autorizacao_ponto_coletivo(uuid[], text[], date, date, text, text)
    TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_revogar_autorizacao_ponto_coletivo(
    p_autorizacao_id uuid,
    p_motivo         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_unidade uuid;
BEGIN
    -- Mesma allowlist de quem concede: revogar e' o outro lado do mesmo ato.
    IF (SELECT public.get_my_role()) NOT IN ('super_admin'::public.user_role,
                                             'rh'::public.user_role,
                                             'rh_unidade'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas o RH pode revogar autorizacao de validacao coletiva.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Informe o motivo da revogacao.';
    END IF;

    SELECT s.unidade_id INTO v_unidade
      FROM public.autorizacoes_ponto_coletivo a
      JOIN public.servidores s ON s.id = a.servidor_id
     WHERE a.id = p_autorizacao_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Autorizacao nao encontrada ou ja revogada.';
    END IF;

    IF NOT public.fn_escopo_gestao_alcanca(v_unidade) THEN
        RAISE EXCEPTION 'Esta autorizacao e de um servidor fora das suas unidades.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE public.autorizacoes_ponto_coletivo
       SET revogado_em      = now(),
           revogado_por_id  = auth.uid(),
           revogacao_motivo = btrim(p_motivo)
     WHERE id = p_autorizacao_id
       AND revogado_em IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Autorizacao nao encontrada ou ja revogada.';
    END IF;

    INSERT INTO public.logs_sistema (user_id, acao, detalhes)
    VALUES (auth.uid(), 'autorizacao_ponto_coletivo_revogada', jsonb_build_object(
        'autorizacao_id', p_autorizacao_id, 'motivo', btrim(p_motivo)));

    -- Revogar NAO desfaz o que ja foi declarado: aquilo e' ponto de mes possivelmente fechado, e
    -- se estiver errado o caminho e' a correcao normal da folha, com rastro proprio.
    RETURN jsonb_build_object('success', true, 'message', 'Autorizacao revogada.');
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_revogar_autorizacao_ponto_coletivo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_revogar_autorizacao_ponto_coletivo(uuid, text)
    TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA — EXECUTA as funcoes, com sessao simulada, e DESFAZ o que escreveu
-- ============================================================================
--
-- 🚨 O ensaio grava de verdade e e' revertido por RAISE EXCEPTION proposital dentro de um bloco
-- proprio. Sem executar, uma coluna inexistente ou um guard invertido so apareceria na primeira
-- chamada real (armadilhas 1 e 42).
--
-- Confere os DOIS sentidos: RH da Unidade concede na propria unidade E e' recusado na de fora.
-- Afrouxar so o primeiro lado transformaria "dispensa de ponto" em algo que qualquer RH de
-- unidade concede para a rede inteira.

DO $conf$
DECLARE
    v_rh_unid   uuid;
    v_diretor   uuid;
    v_unid_dele uuid;
    v_serv_dele uuid;
    v_serv_fora uuid;
    v_res       jsonb;
    v_ok_dentro boolean := false;
    v_ok_fora   boolean := false;
    v_ok_dir    boolean := false;
BEGIN
    SELECT id INTO v_diretor FROM public.profiles WHERE role = 'admin' LIMIT 1;
    SELECT p.id, pu.unidade_id INTO v_rh_unid, v_unid_dele
      FROM public.profiles p
      JOIN public.profile_unidades pu ON pu.profile_id = p.id
     WHERE p.role = 'rh_unidade'
     LIMIT 1;

    SELECT id INTO v_serv_dele FROM public.servidores
     WHERE unidade_id = v_unid_dele AND status = 'Ativo' LIMIT 1;
    SELECT id INTO v_serv_fora FROM public.servidores
     WHERE unidade_id IS DISTINCT FROM v_unid_dele AND unidade_id IS NOT NULL AND status = 'Ativo' LIMIT 1;

    IF v_rh_unid IS NULL OR v_serv_dele IS NULL OR v_serv_fora IS NULL THEN
        RAISE NOTICE 'CONFERENCIA PULADA: faltam perfil rh_unidade ou servidores (dele=% fora=%).',
                     v_serv_dele, v_serv_fora;
        RETURN;
    END IF;

    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_rh_unid::text, 'role', 'authenticated')::text, true);

    BEGIN
        v_res := public.fn_conceder_autorizacao_ponto_coletivo(
            ARRAY[v_serv_dele], ARRAY['entrada'],
            '2099-01-01'::date, '2099-01-02'::date,
            'ENSAIO-MIGRATION-20260911110000', 'ensaio de conferencia, revertido');
        v_ok_dentro := COALESCE((v_res->>'criadas')::int, 0) = 1;
    EXCEPTION WHEN OTHERS THEN
        v_ok_dentro := false;
        RAISE NOTICE 'ensaio dentro do escopo falhou: %', SQLERRM;
    END;

    BEGIN
        PERFORM public.fn_conceder_autorizacao_ponto_coletivo(
            ARRAY[v_serv_fora], ARRAY['entrada'],
            '2099-01-01'::date, '2099-01-02'::date,
            'ENSAIO-MIGRATION-20260911110000', 'ensaio de conferencia, revertido');
        v_ok_fora := true;   -- passou = FURO
    EXCEPTION WHEN insufficient_privilege THEN
        v_ok_fora := false;  -- recusou = certo
    END;

    -- 3) O DIRETOR continua recusado. O predicado o trata como irrestrito; e' a allowlist de
    --    papel que o segura, e ela nao pode ser "simplificada" depois.
    IF v_diretor IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', v_diretor::text, 'role', 'authenticated')::text, true);
        BEGIN
            PERFORM public.fn_conceder_autorizacao_ponto_coletivo(
                ARRAY[v_serv_dele], ARRAY['entrada'],
                '2099-01-01'::date, '2099-01-02'::date,
                'ENSAIO-MIGRATION-20260911110000', 'ensaio de conferencia, revertido');
            v_ok_dir := true;   -- passou = FURO
        EXCEPTION WHEN insufficient_privilege THEN
            v_ok_dir := false;  -- recusou = certo
        END;
    END IF;

    PERFORM set_config('request.jwt.claims', '', true);

    -- Limpa o que o ensaio gravou. A tabela nao tem policy de escrita para nada alem das RPCs,
    -- mas aqui rodamos como dono da migration.
    DELETE FROM public.autorizacoes_ponto_coletivo
     WHERE documento = 'ENSAIO-MIGRATION-20260911110000';
    DELETE FROM public.logs_sistema
     WHERE acao = 'autorizacao_ponto_coletivo_concedida'
       AND detalhes->>'documento' = 'ENSAIO-MIGRATION-20260911110000';

    IF NOT v_ok_dentro THEN
        RAISE EXCEPTION 'ABORTADO: RH da Unidade nao conseguiu conceder na PROPRIA unidade.';
    END IF;
    IF v_ok_fora THEN
        RAISE EXCEPTION 'ABORTADO: RH da Unidade concedeu para servidor de OUTRA unidade.';
    END IF;
    IF v_ok_dir THEN
        RAISE EXCEPTION 'ABORTADO: o Diretor (admin) concedeu dispensa de ponto — a decisao de '
                        '27/08/2026 o exclui nominalmente, e a allowlist de papel foi afrouxada.';
    END IF;

    RAISE NOTICE 'OK: RH da Unidade concede na propria unidade, recusado fora dela, Diretor '
                 'continua fora. Ensaio removido.';
END;
$conf$;
