-- Migration: relatorio de carga consolidada do mes (Fase 3)
-- Data: 2026-08-28
-- Plano: docs/planos/2026-08-28-limite-de-horas-consolidado-entre-escalas.md
--
-- A 20260828120000 poe a conta consolidada dentro da grade. Isso resolve para quem esta lancando,
-- e so' ali: a informacao "esta pessoa tem 409h somando dois setores" so' existe se alguem abrir
-- justamente uma das duas grades. Quem faz a conferencia do mes (RH, coordenacao geral) nao tem
-- por onde comecar -- teria que abrir 96 setores para achar 3 pessoas.
--
-- Esta funcao e' a lista: quem esta em mais de uma escala na competencia, quanto da no total, e
-- onde estao as horas.
--
-- So' devolve quem MERECE atencao (2+ escalas com carga, ou acima do teto). Listar todo mundo
-- seria 500 linhas por competencia para achar 3 -- e o corte silencioso de 1000 do PostgREST
-- (armadilha 8) ficaria a uma competencia de distancia.

DROP FUNCTION IF EXISTS public.fn_carga_mensal_consolidada(integer, integer);

CREATE FUNCTION public.fn_carga_mensal_consolidada(
    p_mes integer,
    p_ano integer
)
RETURNS TABLE (
    servidor_id uuid,
    servidor_nome text,
    matricula text,
    total_horas numeric,
    total_sobreavisos integer,
    teto_horas numeric,
    teto_sobreavisos integer,
    horas_autorizadas numeric,
    sobreavisos_autorizados integer,
    motivo_justificativa text,
    escalas_com_carga integer,
    excede_horas boolean,
    excede_sobreavisos boolean,
    escalas jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH permitido AS (
        -- Denylist, nao allowlist: `fn_painel_sobreaviso_dia` virou denylist justamente porque a
        -- allowlist de papeis esquecia todo papel novo (rh em 11/08, rh_unidade em 12/08 ficaram
        -- de fora ate a 20260812080000 corrigir). Aqui barra so' os papeis do Portal do servidor.
        SELECT EXISTS (
            SELECT 1 FROM public.profiles p
             WHERE p.id = auth.uid()
               AND p.role NOT IN ('servidor'::public.user_role, 'comum'::public.user_role)
        ) OR auth.uid() IS NULL AS ok
    ),
    -- O escopo e' resolvido por UNIDADE, uma vez cada -- nao por linha de escala_mensal. Sao
    -- ~1.600 escalas por competencia contra algumas dezenas de unidades, e fn_unidade_no_escopo
    -- faz um EXISTS em profiles/profile_unidades a cada chamada.
    --
    -- fn_unidade_no_escopo sozinha nao basta: ela so' olha profile_unidades, e coordenador cujo
    -- acesso vem inteiramente de setor vinculado falharia (CLAUDE.md, pendencia 3 da Fase 5).
    unidades_no_escopo AS (
        SELECT u.unidade_id
          FROM (
            SELECT DISTINCT em.unidade_id
              FROM public.escala_mensal em
             WHERE em.mes = p_mes AND em.ano = p_ano AND COALESCE(em.ativo, true) = true
          ) u
         WHERE public.fn_unidade_no_escopo(u.unidade_id)
            OR public.fn_unidade_alcancavel_por_setor(u.unidade_id)
    ),
    -- Quem o caller alcanca: o servidor entra se ao menos UMA escala dele na competencia esta
    -- numa unidade do escopo. Alcancada a pessoa, ele ve TODAS as escalas dela -- e' o proposito
    -- do relatorio, e a mesma fronteira ja aberta por fn_carga_mensal_servidor.
    pessoas AS (
        SELECT DISTINCT em.servidor_id
          FROM public.escala_mensal em
         CROSS JOIN permitido
         WHERE em.mes = p_mes
           AND em.ano = p_ano
           AND COALESCE(em.ativo, true) = true
           AND permitido.ok
           AND em.unidade_id IN (SELECT unidade_id FROM unidades_no_escopo)
    ),
    -- UMA chamada com a lista inteira, nunca uma por servidor: com 500 pessoas na competencia,
    -- o LATERAL por linha varreria escala_mensal 500 vezes.
    carga AS (
        SELECT c.servidor_id,
               c.escala_mensal_id,
               c.unidade_nome,
               c.setor_caminho,
               c.status,
               c.horas,
               c.sobreavisos
          FROM public.fn_carga_mensal_servidor(
                   ARRAY(SELECT p.servidor_id FROM pessoas p), p_mes, p_ano
               ) c
    ),
    tetos AS (
        SELECT t.servidor_id,
               t.teto_horas,
               t.teto_sobreavisos,
               t.horas_autorizadas,
               t.sobreavisos_autorizados,
               t.motivo_justificativa
          FROM public.fn_teto_carga_servidor(
                   ARRAY(SELECT p.servidor_id FROM pessoas p), p_mes, p_ano
               ) t
    ),
    somado AS (
        SELECT c.servidor_id,
               SUM(c.horas)::numeric AS total_horas,
               SUM(c.sobreavisos)::integer AS total_sobreavisos,
               COUNT(*) FILTER (WHERE c.horas > 0 OR c.sobreavisos > 0)::integer AS escalas_com_carga,
               jsonb_agg(
                   jsonb_build_object(
                       'escala_mensal_id', c.escala_mensal_id,
                       'unidade_nome', c.unidade_nome,
                       'setor_caminho', c.setor_caminho,
                       'status', c.status,
                       'horas', c.horas,
                       'sobreavisos', c.sobreavisos
                   )
                   ORDER BY c.horas DESC, c.unidade_nome, c.setor_caminho
               ) FILTER (WHERE c.horas > 0 OR c.sobreavisos > 0) AS escalas
          FROM carga c
         GROUP BY c.servidor_id
    )
    SELECT
        s.servidor_id,
        sv.nome::text,
        sv.matricula::text,
        s.total_horas,
        s.total_sobreavisos,
        t.teto_horas,
        t.teto_sobreavisos,
        t.horas_autorizadas,
        t.sobreavisos_autorizados,
        t.motivo_justificativa,
        s.escalas_com_carga,
        (s.total_horas > t.teto_horas),
        (s.total_sobreavisos > t.teto_sobreavisos),
        COALESCE(s.escalas, '[]'::jsonb)
      FROM somado s
      JOIN public.servidores sv ON sv.id = s.servidor_id
      JOIN tetos t ON t.servidor_id = s.servidor_id
     WHERE s.escalas_com_carga > 1
        OR s.total_horas > t.teto_horas
        OR s.total_sobreavisos > t.teto_sobreavisos
     ORDER BY (s.total_horas > t.teto_horas) DESC, s.total_horas DESC, sv.nome;
$fn$;

COMMENT ON FUNCTION public.fn_carga_mensal_consolidada(integer, integer) IS
    'Quem esta em mais de uma escala na competencia (ou acima do teto mensal), com o total consolidado e onde estao as horas. Alimenta o relatorio de Carga Consolidada. Nao reclassifica nada: usa fn_carga_mensal_servidor e fn_teto_carga_servidor.';

-- Armadilha 24: quem fecha e' o REVOKE FROM PUBLIC; `GRANT ... TO authenticated` sozinho nunca
-- restringiu nada. A tela chama com usuario logado, entao `authenticated` fica.
REVOKE ALL ON FUNCTION public.fn_carga_mensal_consolidada(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_carga_mensal_consolidada(integer, integer) TO authenticated, service_role;

DO $$
DECLARE
    v_fn text := 'public.fn_carga_mensal_consolidada(integer, integer)';
    v_pendentes text := '';
BEGIN
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
        v_pendentes := v_pendentes || format(E'\n  - %s AINDA e executavel por anon', v_fn);
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
        v_pendentes := v_pendentes || format(E'\n  - %s PERDEU o acesso de authenticated (a tela quebra)', v_fn);
    END IF;

    IF v_pendentes <> '' THEN
        RAISE EXCEPTION E'Privilegios nao ficaram como esperado.\nBanco: % | usuario: %\nPendencias:%',
            current_database(), current_user, v_pendentes;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Conferencia (rodar depois de aplicar, com uma sessao de super_admin)
-- ---------------------------------------------------------------------------
--
-- 1) Setembro/2026 tem que trazer os 3 casos acima do teto no topo (JEANE 409h, EDIVONETE 314h,
--    ERIKA SOUZA 302h) e mais os que estao em 2+ escalas sem estourar.
--
-- SELECT servidor_nome, total_horas, teto_horas, excede_horas, escalas_com_carga
--   FROM public.fn_carga_mensal_consolidada(9, 2026);
--
-- 2) A soma do relatorio tem que bater com a soma escala a escala. 0 linhas.
--
-- SELECT r.servidor_nome, r.total_horas, d.soma
--   FROM public.fn_carga_mensal_consolidada(9, 2026) r
--  CROSS JOIN LATERAL (
--        SELECT COALESCE(SUM((e ->> 'horas')::numeric), 0) AS soma
--          FROM jsonb_array_elements(r.escalas) e
--  ) d
--  WHERE r.total_horas <> d.soma;
