-- ============================================================================
-- Migration: liberar a leitura publica da chave 'timezone'
-- Data: 2026-08-23
--
-- POR QUE
--   O fuso do sistema passa a ser lido da configuracao global pelo FRONTEND, e nao mais herdado
--   da maquina de quem abriu a tela (ver src/utils/horario.ts). O layout raiz publica o valor no
--   HTML, e ele cobre paginas ANONIMAS: /login, /presenca, /presenca-local, /consultar-escala e
--   /sobreaviso/[token].
--
--   A policy "Portal access to public configs" so liberava sobreaviso_%, instituicao_cabecalho_url
--   e terminal_classico_habilitado. Sem 'timezone' aqui, o terminal de ponto — justamente a tela
--   onde o horario mais importa — cairia no TIMEZONE_PADRAO e voltaria a nao respeitar a
--   configuracao. Mesmo caso e mesma correcao da 20260814140000.
--
--   Nao ha risco: o nome de um fuso horario nao e dado sensivel, e a escrita continua restrita a
--   admin/super_admin pela policy "Permitir atualizacao apenas para administradores".
--
-- Substitui a policy criada em 20260814140000.
-- ============================================================================

DROP POLICY IF EXISTS "Portal access to public configs" ON public.configuracoes_globais;
CREATE POLICY "Portal access to public configs" ON public.configuracoes_globais
  FOR SELECT TO public USING (
    chave LIKE 'sobreaviso_%'
    OR chave = 'instituicao_cabecalho_url'
    OR chave = 'terminal_classico_habilitado'
    OR chave = 'timezone'
  );


-- ============================================================================
-- CONFERENCIA (nao escreve)
-- ============================================================================
--
-- 1) A policy lista as quatro chaves:
--
--    SELECT polname, pg_get_expr(polqual, polrelid) AS usando
--      FROM pg_policy
--     WHERE polrelid = 'public.configuracoes_globais'::regclass
--       AND polname = 'Portal access to public configs';
--
-- 2) Com a anon key, GET /rest/v1/configuracoes_globais?select=chave,valor&chave=eq.timezone
--    deve devolver uma linha (antes desta migration devolvia []).
-- ============================================================================
