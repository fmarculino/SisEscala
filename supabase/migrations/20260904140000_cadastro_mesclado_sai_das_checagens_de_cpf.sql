-- ============================================================================
-- CADASTRO MESCLADO SAI DAS CHECAGENS DE CPF DUPLICADO
-- ============================================================================
-- 04/09/2026 - complementa 20260904130000 (mesclagem de cadastros duplicados)
--
-- O DEFEITO, ACHADO NO PRIMEIRO USO REAL
--   fn_mesclar_servidores MOVE e INATIVA o cadastro duplicado; nao exclui, de proposito (a
--   matricula pode ter sido impressa em folha e escala). Mas as duas checagens de CPF do sistema
--   olham a tabela inteira, sem distinguir cadastro vivo de duplicata ja resolvida:
--
--     - fn_cpf_ja_cadastrado (20260809110000) e o portao de createServidor/updateServidor desde
--       que o indice unico de CPF foi derrubado (20260810140000). Depois de mesclar, editar o
--       cadastro que FICOU passava a acusar "Este CPF ja esta cadastrado para <a duplicata>" e
--       exigir a confirmacao de vinculo adicional - a MESMA caixa cujo uso indevido criou o
--       problema que a mesclagem acabou de desfazer. E como o cadastro mesclado nunca e apagado,
--       o bloqueio seria PARA SEMPRE;
--     - fn_possiveis_duplicidades_servidor continuaria listando o par (o mesclado + o que ficou)
--       como suspeita em /servidores/pendencias, tambem para sempre.
--
--   Medido em 04/09/2026, no caso que motivou a ferramenta: MARIA NAZARE (65567) foi mesclada com
--   T2600103 e, ao ser transferida para a unidade correta, a tela recusou por CPF duplicado
--   apontando para a propria duplicata inativada.
--
-- A CORRECAO
--   As duas funcoes passam a ignorar quem tem mesclado_em_servidor_id preenchido. O criterio e
--   esse, e nao "status = Inativo": servidor inativado por exoneracao continua sendo motivo
--   legitimo de alerta ao recadastrar o mesmo CPF - quem foi MESCLADO, nao, porque aquele
--   cadastro ja foi declarado duplicata de outro que existe.
--
-- COPIA MECANICA
--   Os dois corpos foram COPIADOS dos arquivos vigentes (20260809110000 e 20260810140000) por
--   scratchpad/gen_mesclado_fora_cpf.js, com uma substituicao pontual cada e conferencia de
--   invariantes - armadilha 1 do CLAUDE.md.
--
-- IDEMPOTENTE
--   CREATE OR REPLACE nas duas (a lista de colunas de saida nao muda, entao nao ha 42P13).
-- ============================================================================


-- ============================================================================
-- 1. O PORTAO DE CADASTRO/EDICAO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cpf_ja_cadastrado(
    p_cpf        text,
    p_ignorar_id uuid DEFAULT NULL
)
RETURNS TABLE (
    servidor_id   uuid,
    nome          text,
    matricula     text,
    unidade_nome  text,
    status        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT s.id, s.nome, s.matricula, u.nome, s.status
      FROM public.servidores s
      LEFT JOIN public.unidades u ON u.id = s.unidade_id
     WHERE public.fn_cpf_normalizado(s.cpf) IS NOT NULL
       AND public.fn_cpf_normalizado(s.cpf) = public.fn_cpf_normalizado(p_cpf)
       AND (p_ignorar_id IS NULL OR s.id <> p_ignorar_id)
       -- Cadastro ja mesclado nao e duplicata pendente: ele E a duplicata, ja resolvida.
       AND s.mesclado_em_servidor_id IS NULL
$fn$;

-- ============================================================================
-- 2. O DIAGNOSTICO DA TELA DE PENDENCIAS
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
         WHERE s.mesclado_em_servidor_id IS NULL
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

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) O cadastro mesclado nao pode mais bloquear o que ficou. Esperado: 0 linhas.
--
--   SELECT * FROM public.fn_cpf_ja_cadastrado(
--       (SELECT cpf FROM public.servidores WHERE matricula = '65567'),
--       (SELECT id  FROM public.servidores WHERE matricula = '65567'));
--
--   2) ...e o par mesclado nao pode mais aparecer como duplicidade suspeita. Esperado: o CPF
--      93052707272 NAO consta no balde 'cpf'.
--
--   SELECT criterio, chave FROM public.fn_possiveis_duplicidades_servidor()
--    WHERE criterio = 'cpf';
--
--   3) Duplicata NAO mesclada continua sendo pega (a checagem nao pode ter sido afrouxada
--      demais). Esperado: as linhas dos CPFs que ainda tem dois cadastros vivos.
--
--   SELECT cpf, quantidade FROM public.fn_cadastros_duplicados();
