-- Migration: relaxa a unicidade de CPF para vinculo multiplo legitimo, com confirmacao explicita
-- Data: 2026-08-10
--
-- Plano: docs/planos/2026-08-10-plano-de-importacao-de-dados-cadastrais-rh.md
-- Estudo: docs/planos/2026-08-10-estudo-importacao-dados-cadastrais-rh.md § 3.10, § 5 (Opcao B)
-- Depende de: 20260809110000 (servidores_cpf_unico, fn_cpf_ja_cadastrado, fn_possiveis_duplicidades_servidor)
--
-- CONTEXTO
--   servidores_cpf_unico (20260809110000) foi criado porque toda ocorrencia de CPF repetido
--   encontrada ate 09/08/2026 era erro de cadastro (caso da VIVIAN). O relatorio de RH mostrou que
--   isso nao e universal: 110 CPFs tem 2 vinculos ATIVOS simultaneos de verdade - mesma pessoa,
--   matricula e cargo diferentes (ex.: enfermeira concursada num turno e a mesma pessoa contratada
--   noutro cargo). O indice unico bloquearia a importacao desses 110 casos.
--
--   Decisao do usuario (10/08/2026): manter servidores como 1 linha = 1 vinculo (nao separar
--   pessoa de vinculo numa tabela propria - Opcao B do estudo, nao a Opcao A). Isso exige trocar o
--   bloqueio automatico do banco por uma CONFIRMACAO EXPLICITA na camada de aplicacao.
--
-- O CUSTO DESTA DECISAO, escrito por extenso porque nao pode ficar so no estudo
--   servidores_cpf_unico era o "backstop que sobrevive a um INSERT pelo SQL editor" (linguagem do
--   proprio CLAUDE.md, mesmo raciocinio do indice de matricula). Derrubar o indice e trocar por
--   uma gate na action ABRE MAO dessa garantia de banco - um INSERT direto no SQL editor ou uma
--   migration futura descuidada podem voltar a criar duplicata sem ninguem ser avisado no ato.
--   A rede que sobra e fn_possiveis_duplicidades_servidor (diagnostico, revisao humana periodica
--   em /servidores/pendencias), nao bloqueio automatico. Foi a troca aceita.
--
-- COMO FUNCIONA DAQUI PRA FRENTE
--   1. servidores ganha vinculo_multiplo_confirmado - true quando alguem confirmou, com
--      informacao na tela, que aquele CPF repetido e vinculo adicional da mesma pessoa (nao erro).
--   2. fn_cpf_ja_cadastrado (20260809110000) NAO MUDA - continua devolvendo os vinculos existentes
--      do CPF. Muda quem chama e o que faz com o resultado (createServidor/updateServidor, fora
--      desta migration - ver servidores/actions.ts).
--   3. fn_possiveis_duplicidades_servidor precisa ser recriada: o balde criterio='cpf' passa a
--      EXCLUIR grupos onde todo mundo ja esta com vinculo_multiplo_confirmado = true - senao as
--      110 duplas legitimas poluem a tela de pendencias para sempre. Os baldes nome/telefone/email
--      continuam identicos - nao mudam neste caso, porque eles nao dependiam do indice de CPF.

ALTER TABLE public.servidores
    ADD COLUMN IF NOT EXISTS vinculo_multiplo_confirmado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.servidores.vinculo_multiplo_confirmado IS
    'true quando um segundo (ou terceiro...) vinculo ativo para o mesmo CPF foi confirmado como '
    'legitimo (pessoa com dois cargos/matriculas), nao erro de cadastro. Faz '
    'fn_possiveis_duplicidades_servidor parar de sinalizar o grupo. Ver 20260810140000.';

DROP INDEX IF EXISTS public.servidores_cpf_unico;

-- ============================================================================
-- fn_possiveis_duplicidades_servidor — recriada para excluir vinculo multiplo confirmado
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_possiveis_duplicidades_servidor()
RETURNS TABLE (
    criterio    text,
    chave       text,
    quantidade  bigint,
    servidores  jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH base AS (
        SELECT s.id, s.nome, s.matricula, s.cpf, s.telefone, s.email, s.status,
               s.vinculo_multiplo_confirmado,
               u.nome AS unidade_nome,
               upper(regexp_replace(translate(s.nome,
                   'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                   'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'),
                   '\s+', ' ', 'g')) AS nome_norm,
               public.fn_cpf_normalizado(s.cpf) AS cpf_norm,
               NULLIF(regexp_replace(COALESCE(s.telefone, ''), '[^0-9]', '', 'g'), '') AS tel_norm
          FROM public.servidores s
          LEFT JOIN public.unidades u ON u.id = s.unidade_id
    ),
    agrupado AS (
        SELECT 'cpf'::text AS criterio, cpf_norm AS chave, id, nome, matricula, cpf, telefone,
               email, status, unidade_nome, vinculo_multiplo_confirmado
          FROM base WHERE cpf_norm IS NOT NULL
        UNION ALL
        SELECT 'nome', btrim(nome_norm), id, nome, matricula, cpf, telefone, email, status,
               unidade_nome, vinculo_multiplo_confirmado
          FROM base WHERE btrim(COALESCE(nome_norm, '')) <> ''
        UNION ALL
        SELECT 'telefone', right(tel_norm, 11), id, nome, matricula, cpf, telefone, email, status,
               unidade_nome, vinculo_multiplo_confirmado
          FROM base WHERE length(COALESCE(tel_norm, '')) >= 10
        UNION ALL
        SELECT 'email', lower(btrim(email)), id, nome, matricula, cpf, telefone, email, status,
               unidade_nome, vinculo_multiplo_confirmado
          FROM base WHERE btrim(COALESCE(email, '')) <> ''
    )
    SELECT criterio, chave, count(*),
           jsonb_agg(jsonb_build_object(
               'id', id, 'nome', nome, 'matricula', matricula, 'cpf', cpf,
               'telefone', telefone, 'email', email, 'status', status, 'unidade', unidade_nome)
               ORDER BY matricula)
      FROM agrupado
     GROUP BY criterio, chave
    HAVING count(*) > 1
       -- vinculo multiplo confirmado por todo mundo do grupo: nao e mais suspeita, e o balde 'cpf'
       -- e o unico onde isso se aplica (nome/telefone/email nao tem essa confirmacao).
       AND NOT (criterio = 'cpf' AND bool_and(vinculo_multiplo_confirmado))
     ORDER BY CASE criterio WHEN 'cpf' THEN 1 WHEN 'nome' THEN 2 WHEN 'telefone' THEN 3 ELSE 4 END, chave
$fn$;

COMMENT ON FUNCTION public.fn_possiveis_duplicidades_servidor() IS
    'Cadastros suspeitos de duplicidade por CPF, nome normalizado, telefone ou e-mail. Diagnostico, '
    'nao bloqueio. O balde cpf exclui grupos onde todo mundo tem vinculo_multiplo_confirmado=true '
    '(vinculo duplo ja confirmado como legitimo, nao erro) - ver 20260810140000.';

GRANT EXECUTE ON FUNCTION public.fn_possiveis_duplicidades_servidor() TO authenticated, service_role;

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--   1. O indice unico nao existe mais:
--      SELECT indexname FROM pg_indexes WHERE indexname = 'servidores_cpf_unico';  -- esperado: 0 linhas
--   2. A coluna existe, default false:
--      SELECT column_name, column_default FROM information_schema.columns
--       WHERE table_name = 'servidores' AND column_name = 'vinculo_multiplo_confirmado';
--   3. fn_possiveis_duplicidades_servidor continua funcionando (mesmo resultado de antes, ja que
--      nenhum servidor tem vinculo_multiplo_confirmado = true ainda):
--      SELECT * FROM public.fn_possiveis_duplicidades_servidor() WHERE criterio = 'cpf';
