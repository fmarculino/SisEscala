-- ============================================================================
-- CARGA CONSOLIDADA: os ids que faltavam para a tela levar ate a escala
-- ============================================================================
-- 29/08/2026
--
-- POR QUE
--   O relatorio /relatorios/carga-consolidada ja diz ONDE estao as horas ("289h - HMI / SHL \
--   ACOLHIMENTO"), mas so' em texto: para chegar na grade daquela pessoa era preciso decorar a
--   unidade e o setor, voltar em Escalas e procurar. A pessoa que aparece nessa lista esta acima
--   do teto -- ou seja, alguem PRECISA abrir a escala dela para reduzir.
--
--   fn_carga_mensal_servidor ja devolve unidade_id e setor_id; era a CTE 'carga' desta funcao que
--   nao os projetava e o jsonb_build_object que nao os repassava. Nenhuma consulta nova.
--
-- ⚠️ AS DUAS PONTAS ANDAM JUNTAS
--   A primeira versao mexeu SO' no jsonb e morreu com 42703 "column c.unidade_id does not exist"
--   -- e so' na hora de APLICAR, porque SQL/plpgsql nao resolve nome de coluna no CREATE
--   (armadilha 1 do CLAUDE.md). Ao acrescentar campo aqui, mexa na CTE 'carga' tambem; o script
--   gerador aborta se qualquer uma das duas ancoras nao aparecer exatamente uma vez.
--
-- O QUE NAO MUDA
--   A lista de colunas do RETURNS TABLE e' a mesma (as chaves entram DENTRO do jsonb 'escalas'),
--   entao aqui e' CREATE OR REPLACE puro -- sem o DROP da versao anterior, que derrubaria a funcao
--   para quem estivesse consultando o relatorio no momento da aplicacao. O criterio de quem
--   aparece, o escopo por unidade e o calculo do teto ficam intactos.
--
-- GERADA POR SCRIPT
--   scratchpad/gen_carga_link.js, copia mecanica de 20260828130000 (mesmo padrao de gen_ancora.js):
--   o corpo nao foi redigitado, e o script aborta se a contagem de ocorrencias divergir.
--
-- IDEMPOTENTE
--   CREATE OR REPLACE; REVOKE de privilegio ausente nao e erro.
-- ============================================================================


CREATE OR REPLACE FUNCTION public.fn_carga_mensal_consolidada(
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
               c.unidade_id,
               c.setor_id,
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
                       'unidade_id', c.unidade_id,
                       'setor_id', c.setor_id,
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


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) Cada escala do jsonb tem que trazer os dois ids (esperado: nenhuma linha):
--
--   SELECT r.servidor_nome, e->>'unidade_id' AS unidade_id, e->>'setor_id' AS setor_id
--     FROM public.fn_carga_mensal_consolidada(9, 2026) r,
--          LATERAL jsonb_array_elements(r.escalas) e
--    WHERE e->>'unidade_id' IS NULL OR e->>'setor_id' IS NULL;
--
--   2) O conteudo do relatorio NAO pode ter mudado - mesma gente, mesmas horas que antes:
--
--   SELECT servidor_nome, total_horas, escalas_com_carga, excede_horas
--     FROM public.fn_carga_mensal_consolidada(9, 2026)
--    ORDER BY total_horas DESC;
