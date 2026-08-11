-- Migration: mapeamento N:1 de codigo do RH para cargo canonico
-- Data: 2026-08-10
--
-- Plano: docs/planos/2026-08-10-plano-de-importacao-de-dados-cadastrais-rh.md
-- Estudo: docs/planos/2026-08-10-estudo-importacao-dados-cadastrais-rh.md § 3.1
--
-- CONTEXTO
--   cargos.codigo (20260714232318) e UNIQUE - uma linha, um codigo. O relatorio de RH tem o MESMO
--   cargo sob DOIS codigos dependendo do regime: "0101 TEC.ENFERM." (concursado) e
--   "3716 TEC.ENFERM_CONTRATADO" (contratado) sao a mesma profissao. Normalizar (decisao do
--   usuario, 10/08/2026) significa um cargo so, com o regime vivendo em servidores.vinculo - mas
--   ainda precisa existir onde amarrar os DOIS codigos de origem ao MESMO cargo canonico, senao a
--   proxima importacao nao acha o cargo certo para quem esta sob o codigo "perdedor" da fusao.
--
--   servidores.cargo continua texto livre (nao ha cargo_id na tabela servidores hoje, confirmado
--   em src/app/(dashboard)/servidores/actions.ts) - esta tabela serve so para resolver, na hora da
--   importacao, qual cargo.nome usar a partir do codigo do CSV. Nao e FK de servidores.
--
--   Cargos "perdedores" na fusao nao sao apagados (viram ativo = false, mesmo padrao ja usado
--   hoje) - apagar quebraria o mapeamento numa reimportacao futura sem quebrar nada visivelmente
--   agora, o tipo de erro que so aparece semanas depois.

CREATE TABLE IF NOT EXISTS public.cargos_codigos_origem (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cargo_id       uuid NOT NULL REFERENCES public.cargos(id) ON DELETE CASCADE,
    codigo         text NOT NULL,
    sistema_origem text NOT NULL DEFAULT 'SFPRC01M',
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cargos_codigos_origem_codigo_sistema_key UNIQUE (codigo, sistema_origem)
);

COMMENT ON TABLE public.cargos_codigos_origem IS
    'Codigos de cargo do sistema de RH que apontam para o mesmo cargo canonico em cargos. '
    'Existe porque a mesma profissao tem codigo diferente por regime na fonte (ex.: '
    '0101 TEC.ENFERM. e 3716 TEC.ENFERM_CONTRATADO -> um so cargo canonico).';

CREATE INDEX IF NOT EXISTS idx_cargos_codigos_origem_cargo_id
    ON public.cargos_codigos_origem (cargo_id);

-- Backfill: todo cargo que ja tem cargos.codigo preenchido hoje entra aqui tambem, para que a
-- resolucao por codigo passe a olhar sempre esta tabela (fonte unica), nao duas.
INSERT INTO public.cargos_codigos_origem (cargo_id, codigo)
SELECT id, codigo FROM public.cargos WHERE codigo IS NOT NULL AND btrim(codigo) <> ''
ON CONFLICT (codigo, sistema_origem) DO NOTHING;

ALTER TABLE public.cargos_codigos_origem ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura de cargos_codigos_origem para autenticados" ON public.cargos_codigos_origem;
CREATE POLICY "Permitir leitura de cargos_codigos_origem para autenticados" ON public.cargos_codigos_origem
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Permitir gerenciamento de cargos_codigos_origem para administradores" ON public.cargos_codigos_origem;
CREATE POLICY "Permitir gerenciamento de cargos_codigos_origem para administradores" ON public.cargos_codigos_origem
    FOR ALL TO authenticated USING (((SELECT get_my_role()) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])));

GRANT SELECT ON public.cargos_codigos_origem TO authenticated;
GRANT ALL ON public.cargos_codigos_origem TO service_role;

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--   1. Um codigo de cargo por linha (nenhum duplicado dentro do mesmo sistema_origem):
--      SELECT codigo, count(*) FROM public.cargos_codigos_origem
--       WHERE sistema_origem = 'SFPRC01M' GROUP BY codigo HAVING count(*) > 1;  -- esperado: 0 linhas
--   2. Contagem bate com os cargos.codigo preenchidos antes desta migration:
--      SELECT count(*) FROM public.cargos_codigos_origem;
--      SELECT count(*) FROM public.cargos WHERE codigo IS NOT NULL;
