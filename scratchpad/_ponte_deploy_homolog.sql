-- Ponte de deploy para HOMOLOGACAO — cole no SQL Editor do Supabase de homologacao.
--
-- scratchpad/envia_homolog.mjs precisa dela para aplicar uma migration statement a statement via
-- PostgREST (nao ha DATABASE_URL nem psql para homologacao neste ambiente). Ela e' criada antes de
-- validar e REMOVIDA depois — por isso nao estava no repositorio, e por isso, quando some, ninguem
-- sabe recria-la. Agora sabe.
--
-- 🚨 SO EM HOMOLOGACAO. Isto executa SQL arbitrario vindo de uma tabela: em producao seria uma
-- porta de execucao remota permanente. A remocao no fim NAO e' opcional.

CREATE TABLE IF NOT EXISTS public._deploy_sql (
    id    text    NOT NULL,
    ordem integer NOT NULL,
    texto text    NOT NULL,
    PRIMARY KEY (id, ordem)
);

-- Sem policy de leitura/escrita para anon/authenticated: so service_role alcanca.
ALTER TABLE public._deploy_sql ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._deploy_run(p_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $ponte$
DECLARE
    v_sql text;
BEGIN
    SELECT string_agg(texto, '' ORDER BY ordem) INTO v_sql
    FROM public._deploy_sql WHERE id = p_id;

    IF v_sql IS NULL THEN
        RAISE EXCEPTION 'statement % nao encontrado em _deploy_sql', p_id;
    END IF;

    EXECUTE v_sql;
    RETURN format('%s aplicado (%s bytes)', p_id, length(v_sql));
END;
$ponte$;

REVOKE ALL ON FUNCTION public._deploy_run(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._deploy_run(text) TO service_role;


-- ============================================================================
-- DEPOIS DE VALIDAR, RODE ISTO (e confira que sumiu):
-- ============================================================================
-- DROP FUNCTION IF EXISTS public._deploy_run(text);
-- DROP TABLE    IF EXISTS public._deploy_sql;
