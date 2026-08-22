-- Vinculo explicito entre o usuario do sistema (profiles) e o cadastro de servidor.
--
-- Ate aqui o vinculo NAO existia: a tela de usuarios tinha um <input hidden name="servidor_id">
-- que nenhuma action jamais leu, e a associacao mostrada na lista era recalculada a cada render
-- casando por e-mail OU por nome iguais (usuarios/page.tsx). Consequencia medida em producao em
-- 22/08/2026: corrigir o e-mail no cadastro do servidor nao alcancava auth.users, o casamento por
-- e-mail quebrava e sobrava so o casamento por nome -- e as telas de escala que identificam o
-- servidor logado por `servidores.email = auth.email` deixavam de achar a pessoa.
--
-- 1 servidor -> no maximo 1 usuario. Servidor sem usuario e o caso normal (499 servidores para
-- 63 usuarios), por isso o indice unico e parcial e a coluna e anulavel.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS servidor_id uuid REFERENCES public.servidores(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.servidor_id IS
  'Cadastro de servidor deste usuario. Fonte unica do vinculo -- nao casar por e-mail nem por nome.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_servidor_id
  ON public.profiles (servidor_id)
  WHERE servidor_id IS NOT NULL;

-- Backfill passo 1: e-mail exato. Reproduz o primeiro criterio do casamento heuristico que a tela
-- usava. As duas janelas garantem 1:1 -- um servidor nunca fica com dois usuarios e vice-versa,
-- mesmo que algum dia surja e-mail repetido (em 22/08/2026 nao ha nenhum).
WITH candidatos AS (
  SELECT p.id AS profile_id,
         s.id AS serv_id,
         row_number() OVER (PARTITION BY s.id ORDER BY p.id) AS rn_serv,
         row_number() OVER (PARTITION BY p.id ORDER BY s.id) AS rn_prof
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  JOIN public.servidores s
    ON lower(btrim(s.email)) = lower(btrim(u.email))
  WHERE p.servidor_id IS NULL
    AND coalesce(btrim(s.email), '') <> ''
    AND coalesce(btrim(u.email), '') <> ''
)
UPDATE public.profiles p
SET servidor_id = c.serv_id
FROM candidatos c
WHERE p.id = c.profile_id
  AND c.rn_serv = 1
  AND c.rn_prof = 1;

-- Backfill passo 2: nome exato, so onde o e-mail nao resolveu. E o segundo criterio da mesma
-- heuristica, e e ele que recupera justamente os casos que motivaram esta migration (e-mail do
-- login divergente do e-mail do cadastro, ou cadastro sem e-mail nenhum).
WITH candidatos AS (
  SELECT p.id AS profile_id,
         s.id AS serv_id,
         row_number() OVER (PARTITION BY s.id ORDER BY p.id) AS rn_serv,
         row_number() OVER (PARTITION BY p.id ORDER BY s.id) AS rn_prof
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  JOIN public.servidores s
    ON lower(btrim(s.nome)) = lower(btrim(coalesce(p.full_name, u.raw_user_meta_data->>'full_name')))
  WHERE p.servidor_id IS NULL
    AND coalesce(btrim(s.nome), '') <> ''
    AND coalesce(btrim(coalesce(p.full_name, u.raw_user_meta_data->>'full_name')), '') <> ''
    AND NOT EXISTS (SELECT 1 FROM public.profiles p2 WHERE p2.servidor_id = s.id)
)
UPDATE public.profiles p
SET servidor_id = c.serv_id
FROM candidatos c
WHERE p.id = c.profile_id
  AND c.rn_serv = 1
  AND c.rn_prof = 1;

-- Conferencia: lista os usuarios que ficaram SEM vinculo e diz se e por nao serem servidor
-- (admin do sistema, por exemplo) ou por divergencia de cadastro a resolver na tela.
-- Esperado em producao em 22/08/2026: 61 vinculados, e sobram PAULA DHESSICA (nome e e-mail
-- divergentes nos dois lados) e admin@admin.com (nao e servidor).
--
-- SELECT u.email,
--        p.full_name,
--        p.role,
--        p.servidor_id
-- FROM public.profiles p
-- JOIN auth.users u ON u.id = p.id
-- WHERE p.servidor_id IS NULL
-- ORDER BY p.full_name;
