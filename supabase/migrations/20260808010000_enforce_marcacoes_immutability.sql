-- Migration: Torna marcacoes_ponto e rep_afd_registros imutaveis (Fase 1 da integracao com REP)
-- Data: 2026-08-08
--
-- OBJETIVO
--   Garantir no BANCO que uma marcacao de ponto nunca e alterada nem apagada. Nao basta a
--   aplicacao se comportar bem: o requisito e que a marcacao real continue registrada mesmo
--   depois de um administrador ajustar por cima, e isso precisa sobreviver a codigo novo,
--   a script de manutencao e a CREATE OR REPLACE descuidado.
--
-- POR QUE CINCO CAMADAS
--   O proprio projeto ja aprendeu essa licao com o Sobreaviso (CLAUDE.md armadilha 6): das
--   tres camadas de defesa, so a CHECK constraint sobreviveu aos CREATE OR REPLACE. Guard
--   dentro de funcao e a camada mais fragil que existe neste repositorio - seis regressoes
--   reais ja aconteceram por recopiar corpo de funcao. Trigger, grant e constraint nao se
--   perdem quando alguem recria uma funcao.
--
-- HONESTIDADE SOBRE O ALCANCE
--   Nenhuma destas camadas impede um SUPERUSUARIO do Postgres de alterar dados por fora. O que
--   se obtem e DETECCAO (cadeia de hash em rep_afd_registros, verificavel a qualquer momento),
--   e deteccao e o que a Portaria 671 exige de um programa de tratamento. Isso deve constar
--   assim na documentacao para fiscalizacao - nao afirmar prevencao absoluta.
--
-- IDEMPOTENTE
--   DROP TRIGGER/POLICY IF EXISTS antes de criar; CREATE OR REPLACE nas funcoes; REVOKE de
--   privilegio ausente nao e erro. Rodar nos dois ambientes e seguro.


-- ============================================================================
-- CAMADA 1 - TRIGGERS DE BLOQUEIO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_bloquear_alteracao_marcacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    RAISE EXCEPTION
        'Marcacao de ponto e imutavel (Portaria 671/2021). Operacao rejeitada: %. '
        'Para desconsiderar, reclassificar ou reatribuir uma marcacao, registre um tratamento '
        'em marcacoes_tratamentos - a marcacao original permanece para auditoria.',
        TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_marcacoes_ponto_imutavel ON public.marcacoes_ponto;
CREATE TRIGGER trg_marcacoes_ponto_imutavel
    BEFORE UPDATE OR DELETE ON public.marcacoes_ponto
    FOR EACH ROW EXECUTE FUNCTION public.fn_bloquear_alteracao_marcacao();

DROP TRIGGER IF EXISTS trg_marcacoes_ponto_sem_truncate ON public.marcacoes_ponto;
CREATE TRIGGER trg_marcacoes_ponto_sem_truncate
    BEFORE TRUNCATE ON public.marcacoes_ponto
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_bloquear_alteracao_marcacao();

-- Tratamentos tambem sao append-only: corrigir um tratamento errado se faz com outro
-- tratamento (ex.: 'restaurar' desfaz 'desconsiderar'), nunca editando o anterior.
DROP TRIGGER IF EXISTS trg_marcacoes_tratamentos_imutavel ON public.marcacoes_tratamentos;
CREATE TRIGGER trg_marcacoes_tratamentos_imutavel
    BEFORE UPDATE OR DELETE ON public.marcacoes_tratamentos
    FOR EACH ROW EXECUTE FUNCTION public.fn_bloquear_alteracao_marcacao();


-- rep_afd_registros tem uma excecao ESTREITA: o reparse das colunas derivadas.
-- linha_bruta, linha_sha256, nsr e hash_encadeado nunca podem mudar; ocorrido_em,
-- identificador_afd, parse_versao, parse_ok e parse_erro podem ser recomputados quando o
-- parser do layout 671 for corrigido - e so dentro de uma sessao que se declara em reparse.
CREATE OR REPLACE FUNCTION public.fn_bloquear_alteracao_afd()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RAISE EXCEPTION
            'Registro de AFD e imutavel (Portaria 671/2021). Operacao rejeitada: %.', TG_OP
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.linha_bruta    IS DISTINCT FROM OLD.linha_bruta
    OR NEW.linha_sha256   IS DISTINCT FROM OLD.linha_sha256
    OR NEW.nsr            IS DISTINCT FROM OLD.nsr
    OR NEW.dispositivo_id IS DISTINCT FROM OLD.dispositivo_id
    OR NEW.hash_anterior  IS DISTINCT FROM OLD.hash_anterior
    OR NEW.hash_encadeado IS DISTINCT FROM OLD.hash_encadeado THEN
        RAISE EXCEPTION
            'A linha bruta do AFD e sua cadeia de hash sao imutaveis. Apenas as colunas '
            'derivadas do parse podem ser recomputadas.'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF COALESCE(current_setting('sisescala.reparse_afd', true), 'off') <> 'on' THEN
        RAISE EXCEPTION
            'Reparse de AFD exige sessao declarada. Use SET LOCAL sisescala.reparse_afd = ''on''.'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_rep_afd_registros_imutavel ON public.rep_afd_registros;
CREATE TRIGGER trg_rep_afd_registros_imutavel
    BEFORE UPDATE OR DELETE ON public.rep_afd_registros
    FOR EACH ROW EXECUTE FUNCTION public.fn_bloquear_alteracao_afd();

DROP TRIGGER IF EXISTS trg_rep_afd_registros_sem_truncate ON public.rep_afd_registros;
CREATE TRIGGER trg_rep_afd_registros_sem_truncate
    BEFORE TRUNCATE ON public.rep_afd_registros
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_bloquear_alteracao_marcacao();


-- ============================================================================
-- CAMADA 2 - GRANTS
-- ============================================================================
-- RLS sozinha nao protegeria service_role, que tem BYPASSRLS. Grant protege: BYPASSRLS nao
-- contorna privilegio de tabela. Toda escrita passa a exigir uma funcao SECURITY DEFINER.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.marcacoes_ponto       FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rep_afd_registros     FROM anon, authenticated, service_role;
REVOKE UPDATE, DELETE, TRUNCATE         ON public.marcacoes_tratamentos FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rep_sincronizacoes    FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rep_vinculos_servidor FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.dispositivos_rep      FROM anon;


-- ============================================================================
-- CAMADA 3 - RLS COM ESCOPO REAL
-- ============================================================================
-- Leitura restrita por unidade do perfil. NENHUMA policy de INSERT/UPDATE/DELETE e criada:
-- a ausencia de policy, com RLS habilitado, nega a operacao para authenticated e anon.

ALTER TABLE public.marcacoes_ponto          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marcacoes_tratamentos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rep_afd_registros        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rep_sincronizacoes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispositivos_rep         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rep_vinculos_servidor    ENABLE ROW LEVEL SECURITY;

-- Helper: a unidade esta no escopo do usuario atual?
CREATE OR REPLACE FUNCTION public.fn_unidade_no_escopo(p_unidade_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.profiles p
         WHERE p.id = auth.uid()
           AND (
                p.role IN ('super_admin'::public.user_role, 'admin'::public.user_role)
             OR COALESCE(p.acesso_todas_unidades, false)
             OR p_unidade_id IS NULL
             OR EXISTS (
                    SELECT 1 FROM public.profile_unidades pu
                     WHERE pu.profile_id = p.id AND pu.unidade_id = p_unidade_id
                )
           )
    )
$$;

DROP POLICY IF EXISTS "Leitura de marcacoes por escopo" ON public.marcacoes_ponto;
CREATE POLICY "Leitura de marcacoes por escopo" ON public.marcacoes_ponto
    FOR SELECT TO authenticated
    USING (public.fn_unidade_no_escopo(unidade_id));

DROP POLICY IF EXISTS "Leitura de tratamentos por escopo" ON public.marcacoes_tratamentos;
CREATE POLICY "Leitura de tratamentos por escopo" ON public.marcacoes_tratamentos
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.marcacoes_ponto m
         WHERE m.id = marcacoes_tratamentos.marcacao_id
           AND public.fn_unidade_no_escopo(m.unidade_id)
    ));

DROP POLICY IF EXISTS "Leitura de dispositivos por escopo" ON public.dispositivos_rep;
CREATE POLICY "Leitura de dispositivos por escopo" ON public.dispositivos_rep
    FOR SELECT TO authenticated
    USING (public.fn_unidade_no_escopo(unidade_id));

DROP POLICY IF EXISTS "Leitura de sincronizacoes por escopo" ON public.rep_sincronizacoes;
CREATE POLICY "Leitura de sincronizacoes por escopo" ON public.rep_sincronizacoes
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.dispositivos_rep d
         WHERE d.id = rep_sincronizacoes.dispositivo_id
           AND public.fn_unidade_no_escopo(d.unidade_id)
    ));

DROP POLICY IF EXISTS "Leitura de AFD por escopo" ON public.rep_afd_registros;
CREATE POLICY "Leitura de AFD por escopo" ON public.rep_afd_registros
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.dispositivos_rep d
         WHERE d.id = rep_afd_registros.dispositivo_id
           AND public.fn_unidade_no_escopo(d.unidade_id)
    ));

DROP POLICY IF EXISTS "Leitura de vinculos por escopo" ON public.rep_vinculos_servidor;
CREATE POLICY "Leitura de vinculos por escopo" ON public.rep_vinculos_servidor
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.dispositivos_rep d
         WHERE d.id = rep_vinculos_servidor.dispositivo_id
           AND public.fn_unidade_no_escopo(d.unidade_id)
    ));

-- Escrita de dispositivos continua sendo administrativa e passa por RLS normal.
DROP POLICY IF EXISTS "Gestao de dispositivos por admin" ON public.dispositivos_rep;
CREATE POLICY "Gestao de dispositivos por admin" ON public.dispositivos_rep
    FOR ALL TO authenticated
    USING ((SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role))
    WITH CHECK ((SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role));

GRANT EXECUTE ON FUNCTION public.fn_unidade_no_escopo(uuid) TO authenticated, service_role;


-- ============================================================================
-- CAMADA 4 - VERIFICACAO DE INTEGRIDADE DA CADEIA DE HASH
-- ============================================================================
-- Recalcula a cadeia por dispositivo e aponta o primeiro NSR divergente. E a camada que
-- DETECTA adulteracao feita por fora do Postgres. Deve rodar no cron diario.

CREATE OR REPLACE FUNCTION public.fn_verificar_integridade_afd(p_dispositivo_id uuid DEFAULT NULL)
RETURNS TABLE (
    dispositivo_id   uuid,
    total_registros  bigint,
    primeiro_nsr_ruim bigint,
    integro          boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    RETURN QUERY
    WITH encadeado AS (
        SELECT r.dispositivo_id,
               r.nsr,
               r.hash_encadeado,
               encode(
                   sha256(convert_to(
                       COALESCE(LAG(r.hash_encadeado) OVER (
                           PARTITION BY r.dispositivo_id ORDER BY r.nsr
                       ), '') || r.linha_sha256, 'UTF8')),
                   'hex'
               ) AS hash_esperado
          FROM public.rep_afd_registros r
         WHERE p_dispositivo_id IS NULL OR r.dispositivo_id = p_dispositivo_id
    )
    SELECT e.dispositivo_id,
           count(*)::bigint,
           min(e.nsr) FILTER (WHERE e.hash_encadeado IS DISTINCT FROM e.hash_esperado),
           count(*) FILTER (WHERE e.hash_encadeado IS DISTINCT FROM e.hash_esperado) = 0
      FROM encadeado e
     GROUP BY e.dispositivo_id;
END;
$fn$;

COMMENT ON FUNCTION public.fn_verificar_integridade_afd(uuid) IS
    'Recalcula a cadeia sha256(hash_anterior || linha_sha256) por dispositivo e aponta o primeiro '
    'NSR divergente. Deteccao de adulteracao, nao prevencao. Rodar no cron diario.';

GRANT EXECUTE ON FUNCTION public.fn_verificar_integridade_afd(uuid) TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--   1) TESTE DE IMUTABILIDADE - as tres devem FALHAR com restrict_violation.
--      Rode dentro de uma transacao e desfaca, para nao deixar residuo:
--
--   BEGIN;
--     INSERT INTO public.marcacoes_ponto (origem, ocorrido_em, retroativa)
--          VALUES ('terminal', now(), true) RETURNING id;
--     -- guarde o id devolvido e tente alterar:
--     UPDATE public.marcacoes_ponto SET ocorrido_em = now() WHERE id = '<id>';  -- deve falhar
--     DELETE FROM public.marcacoes_ponto WHERE id = '<id>';                     -- deve falhar
--   ROLLBACK;
--
--   2) Nao deve existir policy de escrita em marcacoes_ponto (esperado: so SELECT):
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'marcacoes_ponto';
--
--   3) authenticated e service_role nao devem ter escrita (esperado: 0 linhas):
--
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'marcacoes_ponto'
--      AND grantee IN ('anon','authenticated','service_role')
--      AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');
--
--   4) A verificacao de integridade deve rodar sem erro (0 linhas com a tabela vazia):
--
--   SELECT * FROM public.fn_verificar_integridade_afd();
