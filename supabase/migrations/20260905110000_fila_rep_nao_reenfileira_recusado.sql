-- ============================================================================
-- A fila de cadastro para de insistir com quem o EQUIPAMENTO recusou (05/09/2026)
-- ============================================================================
--
-- MOTIVACAO (medida em producao em 05/09/2026, com autorizacao do usuario).
-- rep_cadastros_fila tinha 2.463 linhas 'falhou', e o mesmo par (dispositivo, servidor) aparecia
-- ate 83 VEZES. 246 pares tinham mais de uma tentativa, e 25 dos 51 pendentes do momento ja
-- haviam falhado antes NO MESMO relogio. Erros dominantes, todos recusa do equipamento:
--   1443  nenhum formato de add_users.fcgi funcionou neste equipamento
--    657  add_users.fcgi recusou: 'pis' em formato incorreto
--     68  add_users.fcgi recusou: Matricula ja cadastrada
--
-- 'falhou' JA SIGNIFICA DEFINITIVO: fn_confirmar_cadastro_rep so grava esse status quando a falha
-- NAO e transitoria (rede/timeout volta para 'pendente' com tentativas+1). Ou seja, o proprio
-- modelo ja dizia "nao insista" - o que faltava era o enfileiramento respeitar isso.
--
-- O laco vinha dos cliques na tela (326, 403 e 179 falhas/dia em 31/08, 01/09 e 02/09). Virou
-- problema maior ao entrar no cron diario (20260905, /api/cron): o coletor aplica no maximo 20
-- cadastros por ciclo, entao entradas condenadas CONSOMEM a vaga de quem e novo de verdade.
--
-- O CRITERIO NAO E UMA JANELA DE TEMPO ARBITRARIA. Reprova quem falhou e cujo cadastro NAO mudou
-- desde a falha (servidores.updated_at <= processado_em). Corrigir o CPF/PIS da pessoa libera a
-- retentativa NA HORA, que e exatamente a acao que tem chance de mudar o resultado. O teto de 30
-- dias existe so para o caso em que quem mudou foi o OUTRO lado - firmware do equipamento, ou
-- uma versao nova do coletor com formato novo de add_users.fcgi.
--
-- Vale para os DOIS caminhos (lotacao e escala) e para os DOIS chamadores (botao da tela e cron):
-- o laco foi criado pela tela, entao proteger so o cron nao resolveria.
--
-- Gerado por scratchpad/gen_fila_nao_reenfileira.js (copia mecanica de 20260822200000 e
-- 20260817100000 - as duas funcoes vivem em migrations DIFERENTES).
-- Idempotente: CREATE OR REPLACE, sem mudanca de assinatura.


-- ============================================================================
-- 1. O criterio, em um lugar so
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cadastro_rep_reprovado(
    p_dispositivo_id uuid,
    p_servidor_id    uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT EXISTS (
        SELECT 1
          FROM public.rep_cadastros_fila f
          JOIN public.servidores s ON s.id = f.servidor_id
         WHERE f.dispositivo_id = p_dispositivo_id
           AND f.servidor_id    = p_servidor_id
           AND f.status = 'falhou'
           -- Teto de 30 dias: quem pode ter mudado e o OUTRO lado (firmware, coletor novo com
           -- outro formato de add_users.fcgi). Sem ele, um equipamento consertado nunca voltaria
           -- a receber essas pessoas sem alguem editar cada cadastro na mao.
           AND COALESCE(f.processado_em, f.created_at) > now() - interval '30 days'
           -- O criterio principal: a falha e' mais nova que a ultima alteracao do cadastro, ou
           -- seja NADA mudou do nosso lado desde que o relogio recusou. Corrigir o CPF/PIS da
           -- pessoa move updated_at e libera a retentativa imediatamente.
           AND COALESCE(f.processado_em, f.created_at) >= COALESCE(s.updated_at, '-infinity'::timestamptz)
    );
$fn$;

COMMENT ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) IS
    'true quando o equipamento ja RECUSOU este cadastro e nada mudou desde entao - fonte unica '
    'do "nao insista" usada por fn_enfileirar_cadastros_rep e fn_enfileirar_cadastros_por_escala.';

REVOKE EXECUTE ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid) TO authenticated, service_role;


-- ============================================================================
-- 2. fn_enfileirar_cadastros_rep (copia mecanica de 20260822200000 + guard)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_enfileirar_cadastros_rep(p_dispositivo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_role          public.user_role;
    v_unidade_id    uuid;
    v_restrito      boolean;
    v_enfileirados  integer := 0;
    v_sem_cpf       integer := 0;
    v_ja_vinculados integer := 0;
    v_ja_no_relogio integer := 0;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        v_role := (SELECT public.get_my_role());
        IF v_role IS NULL OR v_role IN ('servidor'::public.user_role, 'comum'::public.user_role) THEN
            RAISE EXCEPTION 'Sem permissao para sincronizar cadastros com o rele.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    SELECT unidade_id INTO v_unidade_id
      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;
    IF v_unidade_id IS NULL THEN
        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;
    END IF;

    IF auth.uid() IS NOT NULL THEN
        IF NOT (public.fn_unidade_no_escopo(v_unidade_id) OR public.fn_unidade_alcancavel_por_setor(v_unidade_id)) THEN
            RAISE EXCEPTION 'Dispositivo fora do seu escopo de atuacao.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- 0 linhas em dispositivos_rep_setores = "toda a unidade" (mesma semantica de
    -- dispositivos_rep.setor_id IS NULL); >=1 linha = so os setores listados.
    SELECT EXISTS (
        SELECT 1 FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id
    ) INTO v_restrito;

    WITH candidatos AS (
        SELECT s.id, s.cpf
          FROM public.servidores s
         WHERE s.status = 'Ativo'
           AND s.unidade_id = v_unidade_id
           AND (NOT v_restrito OR EXISTS (
                 SELECT 1 FROM public.dispositivos_rep_setores ds
                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = s.setor_id))
    ),
    sem_cpf AS (
        SELECT count(*) AS n FROM candidatos
         WHERE regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') = ''
    ),
    ja_vinculados AS (
        SELECT count(*) AS n
          FROM candidatos c
          JOIN public.rep_vinculos_servidor v
            ON v.servidor_id = c.id AND v.dispositivo_id = p_dispositivo_id AND v.vigente_ate IS NULL
    ),
    -- Esta no equipamento, mas sob um identificador que nao e o do vinculo (ou sem vinculo
    -- nenhum). Medido em producao em 22/08/2026 no ENF-ZEZINHA: 6 servidores com vinculo
    -- apontando para um numero que o relogio nao tem mais, e o cadastro deles la sob outro.
    -- Reenviar essa gente cria cadastro duplicado no equipamento em vez de resolver.
    ja_no_relogio AS (
        SELECT count(*) AS n
          FROM candidatos c
         WHERE NOT EXISTS (
                 SELECT 1 FROM public.rep_vinculos_servidor v
                  WHERE v.servidor_id = c.id AND v.dispositivo_id = p_dispositivo_id AND v.vigente_ate IS NULL)
           AND EXISTS (
                 SELECT 1 FROM public.rep_usuarios_dispositivo u
                  WHERE u.dispositivo_id = p_dispositivo_id AND u.servidor_id = c.id)
    ),
    inseridos AS (
        INSERT INTO public.rep_cadastros_fila (dispositivo_id, servidor_id, criado_por_id)
        SELECT p_dispositivo_id, c.id, auth.uid()
          FROM candidatos c
         WHERE regexp_replace(COALESCE(c.cpf, ''), '\D', '', 'g') <> ''
           AND NOT EXISTS (
                 SELECT 1 FROM public.rep_vinculos_servidor v
                  WHERE v.servidor_id = c.id AND v.dispositivo_id = p_dispositivo_id AND v.vigente_ate IS NULL)
           -- O vinculo e UMA evidencia de "ja esta no relogio", nao a unica: o snapshot e a
           -- leitura direta do equipamento. Sem esta linha, encerrar vinculos orfaos (a outra
           -- metade desta migration) faria reenviar cadastro de quem esta la sob outro numero.
           AND NOT EXISTS (
                 SELECT 1 FROM public.rep_usuarios_dispositivo u
                  WHERE u.dispositivo_id = p_dispositivo_id AND u.servidor_id = c.id)
           AND NOT EXISTS (
                 SELECT 1 FROM public.rep_cadastros_fila f
                  WHERE f.servidor_id = c.id AND f.dispositivo_id = p_dispositivo_id AND f.status = 'pendente')
           -- Nao insistir com quem o EQUIPAMENTO ja recusou (ver fn_cadastro_rep_reprovado).
           AND NOT public.fn_cadastro_rep_reprovado(p_dispositivo_id, c.id)
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM inseridos), (SELECT n FROM sem_cpf), (SELECT n FROM ja_vinculados),
           (SELECT n FROM ja_no_relogio)
      INTO v_enfileirados, v_sem_cpf, v_ja_vinculados, v_ja_no_relogio;

    RETURN jsonb_build_object(
        'enfileirados', v_enfileirados,
        'sem_cpf', v_sem_cpf,
        'ja_vinculados', v_ja_vinculados,
        'ja_no_relogio', v_ja_no_relogio
    );
END;
$fn$;


-- ============================================================================
-- 3. fn_enfileirar_cadastros_por_escala (copia mecanica de 20260817100000 + guard)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_enfileirar_cadastros_por_escala(
    p_dispositivo_id uuid,
    p_mes            integer DEFAULT NULL,
    p_ano            integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_role         public.user_role;
    v_enfileirados integer := 0;
    v_ja_na_fila   integer := 0;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        v_role := (SELECT public.get_my_role());
        IF v_role IS NULL OR v_role IN ('servidor'::public.user_role, 'comum'::public.user_role) THEN
            RAISE EXCEPTION 'Sem permissao para enfileirar cadastros para o rele.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- A checagem de escopo do dispositivo vem de graca: fn_cobertura_ponto_dispositivo levanta
    -- excecao para dispositivo fora do escopo do caller antes de devolver qualquer linha.
    WITH alvo AS (
        SELECT c.servidor_id, c.fila_status
          FROM public.fn_cobertura_ponto_dispositivo(p_dispositivo_id, p_mes, p_ano) c
         WHERE c.situacao = 'fora_do_relogio'
    ), inseridos AS (
        INSERT INTO public.rep_cadastros_fila (dispositivo_id, servidor_id, criado_por_id)
        SELECT p_dispositivo_id, a.servidor_id, auth.uid()
          FROM alvo a
         WHERE NOT EXISTS (
             SELECT 1 FROM public.rep_cadastros_fila f
              WHERE f.dispositivo_id = p_dispositivo_id
                AND f.servidor_id = a.servidor_id
                AND f.status = 'pendente'
         )
           -- Nao insistir com quem o EQUIPAMENTO ja recusou (ver fn_cadastro_rep_reprovado).
           AND NOT public.fn_cadastro_rep_reprovado(p_dispositivo_id, a.servidor_id)
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM inseridos),
           (SELECT count(*) FROM alvo WHERE fila_status = 'pendente')
      INTO v_enfileirados, v_ja_na_fila;

    RETURN jsonb_build_object(
        'enfileirados', v_enfileirados,
        'ja_na_fila', v_ja_na_fila
    );
END;
$fn$;


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar)
-- ============================================================================
--
-- 1. Quantos pares seriam poupados agora (o tamanho do laco que estava rodando):
--   SELECT count(*) AS reprovados
--     FROM (SELECT DISTINCT dispositivo_id, servidor_id
--             FROM public.rep_cadastros_fila WHERE status = 'falhou') x
--    WHERE public.fn_cadastro_rep_reprovado(x.dispositivo_id, x.servidor_id);
--
-- 2. Enfileirar de novo NAO pode mais crescer sozinho. Rode duas vezes seguidas no mesmo
--    dispositivo: a segunda tem que devolver enfileirados = 0.
--   SELECT public.fn_enfileirar_cadastros_rep('<dispositivo>');
--   SELECT public.fn_enfileirar_cadastros_rep('<dispositivo>');
--
-- 3. Corrigir o cadastro LIBERA a retentativa (e o que impede a regra de virar prisao):
--   UPDATE public.servidores SET updated_at = now() WHERE id = '<servidor que falhou>';
--   SELECT public.fn_cadastro_rep_reprovado('<dispositivo>', '<servidor>');  -- deve virar false
--
-- 4. Ninguem que NUNCA falhou pode ser barrado (o guard so olha status 'falhou'):
--   SELECT count(*) AS deve_ser_zero
--     FROM public.servidores s, public.dispositivos_rep d
--    WHERE public.fn_cadastro_rep_reprovado(d.id, s.id)
--      AND NOT EXISTS (SELECT 1 FROM public.rep_cadastros_fila f
--                       WHERE f.dispositivo_id = d.id AND f.servidor_id = s.id
--                         AND f.status = 'falhou');
