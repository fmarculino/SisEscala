-- Migration: fila de push de identidade SisEscala -> rele de ponto (Fase 7, parte identidade)
-- Data: 2026-08-12
--
-- MOTIVACAO
--   Plano original (docs/planos/2026-08-08-integracao-relogio-de-ponto-rep.md, Fase 7): "cadastro
--   push SisEscala -> REP e biometria... deliberadamente por ultimo: hoje isso e feito
--   manualmente e funciona". Ficou deliberadamente fora da Fase 4. Com a instalacao em mais de
--   uma unidade prestes a comecar, o cadastro manual direto na telinha do rele deixa de ser
--   praticavel - e sem ele, um segundo rele gera marcacao que ninguem consegue atribuir (o
--   vinculo rep_vinculos_servidor tambem so existia sem tela nenhuma ate agora).
--
--   A BIOMETRIA em si CONTINUA impossivel de empurrar por API - o template vem do sensor com a
--   pessoa presente no equipamento, sempre vai exigir alguem ir ate o rele pelo menos uma vez por
--   servidor (confirmado no plano original). O que da para automatizar e so a IDENTIDADE
--   (matricula/nome/CPF) chegar pronta no rele antes disso - quem for cadastrar a digital nao
--   precisa digitar tudo na telinha pequena do aparelho.
--
-- FLUXO
--   1. Admin clica "Sincronizar cadastros" num dispositivo_rep (fn_enfileirar_cadastros_rep).
--   2. Fila de push aparece em /api/rep/v1/pendencias (GET), que ate agora so existia como stub
--      devolvendo [] (ver comentario na propria rota - "Fase 7... fora do escopo desta rodada").
--   3. coletor-rep aplica no rele (create_objects.fcgi, best-effort - ver aviso em rep/client.go)
--      e confirma o resultado (POST na mesma rota -> fn_confirmar_cadastro_rep).
--   4. Sucesso cria/atualiza rep_vinculos_servidor com tem_biometria = false.
--   5. Um pull periodico de load_objects.fcgi (fn_atualizar_biometria_vinculos) vira tem_biometria
--      = true quando alguem finalmente cadastrar o dedo no equipamento - fecha o loop sem exigir
--      que ninguem digite nada no SisEscala manualmente.
--
-- POR QUE NAO SO UMA COLUNA EM rep_vinculos_servidor
--   Fila e vinculo sao coisas diferentes: a fila e o QUE AINDA PRECISA SER ENVIADO (efemera,
--   unica pendente por par dispositivo+servidor), o vinculo e O QUE JA FOI CONFIRMADO como
--   existente no rele (com vigencia temporal, igual ja funciona para o sentido AFD->servidor).
--   Reusar rep_vinculos_servidor como fila tambem quebraria sua garantia atual de "populada a
--   partir de load_users.fcgi antes de qualquer remove_users.fcgi" (comentario na tabela).
--
-- IDEMPOTENTE: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE nas funcoes, DROP POLICY
-- IF EXISTS antes de recriar. Seguro rodar nos dois ambientes (CLAUDE.md armadilha 3).


-- ============================================================================
-- 1. TABELA
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rep_cadastros_fila (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispositivo_id uuid NOT NULL REFERENCES public.dispositivos_rep(id),
    servidor_id    uuid NOT NULL REFERENCES public.servidores(id),
    status         text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente', 'enviado', 'falhou')),
    device_user_id bigint,
    erro           text,
    tentativas     integer NOT NULL DEFAULT 0,
    criado_por_id  uuid REFERENCES public.profiles(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    processado_em  timestamptz
);

-- So pode haver UM job pendente por par (dispositivo, servidor) - reenfileirar nao duplica.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cadastro_fila_pendente
    ON public.rep_cadastros_fila (dispositivo_id, servidor_id)
    WHERE status = 'pendente';

CREATE INDEX IF NOT EXISTS idx_cadastro_fila_dispositivo_status
    ON public.rep_cadastros_fila (dispositivo_id, status);

COMMENT ON TABLE public.rep_cadastros_fila IS
    'Fila de push de identidade (matricula/nome/CPF) para um dispositivo_rep - Fase 7. '
    'Biometria em si nunca passa por aqui: e sempre cadastrada presencialmente no equipamento.';


ALTER TABLE public.rep_cadastros_fila ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gestao de fila de cadastros REP por admin" ON public.rep_cadastros_fila;
CREATE POLICY "Gestao de fila de cadastros REP por admin" ON public.rep_cadastros_fila
    FOR ALL TO authenticated
    USING ((SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role))
    WITH CHECK ((SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rep_cadastros_fila FROM anon;
GRANT SELECT ON public.rep_cadastros_fila TO authenticated, service_role;


-- ============================================================================
-- 2. ENFILEIRAR (admin, pela tela) - so quem tem CPF preenchido e ainda nao vinculado
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_enfileirar_cadastros_rep(p_dispositivo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_unidade_id uuid;
    v_setor_id   uuid;
    v_enfileirados integer := 0;
    v_sem_cpf      integer := 0;
    v_ja_vinculados integer := 0;
BEGIN
    IF (SELECT public.get_my_role()) NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas administradores podem sincronizar cadastros com o rele.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT unidade_id, setor_id INTO v_unidade_id, v_setor_id
      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;
    IF v_unidade_id IS NULL THEN
        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;
    END IF;

    WITH candidatos AS (
        SELECT s.id, s.cpf
          FROM public.servidores s
         WHERE s.status = 'Ativo'
           AND s.unidade_id = v_unidade_id
           AND (v_setor_id IS NULL OR s.setor_id = v_setor_id)
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
    inseridos AS (
        INSERT INTO public.rep_cadastros_fila (dispositivo_id, servidor_id, criado_por_id)
        SELECT p_dispositivo_id, c.id, auth.uid()
          FROM candidatos c
         WHERE regexp_replace(COALESCE(c.cpf, ''), '\D', '', 'g') <> ''
           AND NOT EXISTS (
                 SELECT 1 FROM public.rep_vinculos_servidor v
                  WHERE v.servidor_id = c.id AND v.dispositivo_id = p_dispositivo_id AND v.vigente_ate IS NULL)
           AND NOT EXISTS (
                 SELECT 1 FROM public.rep_cadastros_fila f
                  WHERE f.servidor_id = c.id AND f.dispositivo_id = p_dispositivo_id AND f.status = 'pendente')
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM inseridos), (SELECT n FROM sem_cpf), (SELECT n FROM ja_vinculados)
      INTO v_enfileirados, v_sem_cpf, v_ja_vinculados;

    RETURN jsonb_build_object(
        'enfileirados', v_enfileirados,
        'sem_cpf', v_sem_cpf,
        'ja_vinculados', v_ja_vinculados
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_enfileirar_cadastros_rep(uuid) TO authenticated;


-- ============================================================================
-- 3. LISTAR PENDENTES (coletor, via /api/rep/v1/pendencias GET) - service_role apenas
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cadastros_pendentes_dispositivo(p_dispositivo_id uuid)
RETURNS TABLE (
    fila_id   uuid,
    servidor_id uuid,
    matricula text,
    nome      text,
    identificador_afd text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT f.id, s.id, s.matricula, s.nome,
           lpad(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), 12, '0')
      FROM public.rep_cadastros_fila f
      JOIN public.servidores s ON s.id = f.servidor_id
     WHERE f.dispositivo_id = p_dispositivo_id
       AND f.status = 'pendente'
     ORDER BY f.created_at
$fn$;

REVOKE ALL ON FUNCTION public.fn_cadastros_pendentes_dispositivo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cadastros_pendentes_dispositivo(uuid) TO service_role;


-- ============================================================================
-- 4. CONFIRMAR RESULTADO (coletor, via /api/rep/v1/pendencias POST) - service_role apenas
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_confirmar_cadastro_rep(
    p_fila_id        uuid,
    p_sucesso        boolean,
    p_device_user_id bigint DEFAULT NULL,
    p_erro           text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_dispositivo_id uuid;
    v_servidor_id    uuid;
BEGIN
    SELECT dispositivo_id, servidor_id INTO v_dispositivo_id, v_servidor_id
      FROM public.rep_cadastros_fila WHERE id = p_fila_id AND status = 'pendente';

    IF v_dispositivo_id IS NULL THEN
        RETURN; -- ja processado ou id invalido - idempotente, sem erro (reenvio seguro)
    END IF;

    IF NOT p_sucesso THEN
        UPDATE public.rep_cadastros_fila
           SET status = 'falhou', erro = p_erro, tentativas = tentativas + 1, processado_em = now()
         WHERE id = p_fila_id;
        RETURN;
    END IF;

    UPDATE public.rep_cadastros_fila
       SET status = 'enviado', device_user_id = p_device_user_id, processado_em = now()
     WHERE id = p_fila_id;

    -- Fecha qualquer vinculo vigente anterior deste servidor neste dispositivo antes de abrir um
    -- novo - mesma disciplina de vigencia que ja protege o sentido AFD->servidor (comentario na
    -- criacao de rep_vinculos_servidor: sem isso, uma correcao faria batida antiga resolver
    -- errado retroativamente).
    UPDATE public.rep_vinculos_servidor
       SET vigente_ate = now()
     WHERE dispositivo_id = v_dispositivo_id AND servidor_id = v_servidor_id AND vigente_ate IS NULL;

    INSERT INTO public.rep_vinculos_servidor
           (dispositivo_id, identificador_afd, matricula_device, nome_device, servidor_id, device_user_id, tem_biometria)
    SELECT v_dispositivo_id,
           lpad(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), 12, '0'),
           s.matricula, s.nome, s.id, p_device_user_id, false
      FROM public.servidores s WHERE s.id = v_servidor_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text) TO service_role;


-- ============================================================================
-- 5. ATUALIZAR BIOMETRIA (coletor, apos um load_objects.fcgi periodico) - service_role apenas
-- ============================================================================
-- So liga tem_biometria; nunca desliga sozinha. Uma falha parcial de leitura no rele nao pode
-- fazer alguem que ja tem o dedo cadastrado voltar a aparecer como pendente.

CREATE OR REPLACE FUNCTION public.fn_atualizar_biometria_vinculos(p_dispositivo_id uuid, p_device_user_ids bigint[])
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH atualizados AS (
        UPDATE public.rep_vinculos_servidor
           SET tem_biometria = true
         WHERE dispositivo_id = p_dispositivo_id
           AND vigente_ate IS NULL
           AND tem_biometria = false
           AND device_user_id = ANY(p_device_user_ids)
        RETURNING 1
    )
    SELECT count(*)::integer FROM atualizados
$fn$;

REVOKE ALL ON FUNCTION public.fn_atualizar_biometria_vinculos(uuid, bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_atualizar_biometria_vinculos(uuid, bigint[]) TO service_role;


-- ============================================================================
-- 6. TELA DE PENDENCIAS DE BIOMETRIA (admin/coordenador, escopo por unidade/setor)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_pendencias_biometria(p_dispositivo_id uuid DEFAULT NULL)
RETURNS TABLE (
    vinculo_id     uuid,
    dispositivo_id uuid,
    dispositivo_nome text,
    servidor_id    uuid,
    servidor_nome  text,
    matricula      text,
    criado_em      timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT v.id, v.dispositivo_id, d.nome, v.servidor_id, s.nome, s.matricula, v.created_at
      FROM public.rep_vinculos_servidor v
      JOIN public.dispositivos_rep d ON d.id = v.dispositivo_id
      JOIN public.servidores s ON s.id = v.servidor_id
     WHERE v.vigente_ate IS NULL
       AND v.tem_biometria = false
       AND (p_dispositivo_id IS NULL OR v.dispositivo_id = p_dispositivo_id)
       AND public.fn_unidade_no_escopo(d.unidade_id)
     ORDER BY v.created_at
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_pendencias_biometria(uuid) TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--
--   1) Objetos existem:
--
--   SELECT count(*) FROM public.rep_cadastros_fila; -- esperado: 0
--
--   2) Enfileirar para o dispositivo de teste (como admin/super_admin):
--
--   SELECT public.fn_enfileirar_cadastros_rep(
--            (SELECT id FROM public.dispositivos_rep WHERE numero_serie = 'REP-TESTE-TI'));
--   -- esperado: {"enfileirados": N, "sem_cpf": M, "ja_vinculados": 0}
--
--   3) Listar como o coletor veria (via service_role, nao pelo client comum):
--
--   SELECT * FROM public.fn_cadastros_pendentes_dispositivo(
--            (SELECT id FROM public.dispositivos_rep WHERE numero_serie = 'REP-TESTE-TI'));
--
--   4) Confirmar um item simulado e conferir que criou vinculo com tem_biometria = false:
--
--   SELECT public.fn_confirmar_cadastro_rep('<fila_id>', true, 12345, NULL);
--   SELECT * FROM public.rep_vinculos_servidor WHERE device_user_id = 12345;
