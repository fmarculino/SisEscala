-- Migration: Cadastro unico de servidor - o CPF passa a ser chave de identidade
-- Data: 2026-08-09
--
-- SINTOMA
--   Em 09/08/2026 a base de producao tinha a mesma pessoa cadastrada duas vezes:
--
--     T2600019 | cpf 06307223235 | VIVIAN MARTINS MACEDO | criado 2026-08-05 22:33
--     T2600014 | cpf 06307223235 | VIVIAN MARTINS MACEDO | criado 2026-08-07 17:34
--
--   Mesmo CPF, mesmo nome, mesmo e-mail, mesmo telefone (um com mascara, outro sem),
--   mesmo cargo, mesma unidade. Dois PINs diferentes, dois setores diferentes.
--
-- CAUSA RAIZ: a unica chave unica da tabela e gerada pelo proprio sistema
--   servidores tem UNIQUE em matricula e NADA em cpf - a migration que criou a coluna
--   (20260611165000) e uma linha so: ALTER TABLE ... ADD COLUMN IF NOT EXISTS cpf text.
--
--   Quando o cadastro e feito com a matricula em branco, trg_atribuir_matricula_temporaria
--   (20260807110000) gera uma temporaria NOVA. Ou seja: cadastrar a mesma pessoa duas vezes
--   sem matricula produz duas matriculas distintas e NADA colide. A unica protecao de
--   unicidade que existia e estruturalmente contornada justamente pelo caminho mais usado -
--   ha 15 matriculas temporarias em producao.
--
--   No codigo, o quadro e o mesmo: createServidor e updateServidor conferem SOMENTE matricula;
--   o cpf entra cru (cpf: cpf || null). importServidores nao confere nada - faz insert em lote
--   e so reage ao erro da constraint. Nenhum dos tres olha para o CPF.
--
-- POR QUE A CHECAGEM NAO PODE FICAR SO NO FRONTEND
--   E a licao de 20260807110000, identica: um SELECT feito com o cliente do usuario passa pela
--   policy "Users can view relevant servers", que escopa servidores por unidade/setor. Um
--   coordenador que nao enxerga a outra unidade NAO ACHA a duplicata e cadastra de novo.
--   A checagem tem de rodar como SECURITY DEFINER, e o indice unico e o unico backstop real.
--
-- ESCOPO DESTA MIGRATION
--   1. limpa a duplicata existente, e SOMENTE quando for comprovadamente segura;
--   2. cria o indice unico sobre o CPF normalizado;
--   3. expoe as funcoes que o frontend passa a chamar antes de gravar.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   Nao cria CHECK de digito verificador. Quatro CPFs em producao tem digito invalido
--   (HUGO MARCELO OSORIO, MICHELLE RAIANNE MORAIS DA SILVA, FRANCISCA ASSIS ALMEIDA SANTOS,
--   LUCILIA LIMA AZEVEDO) e um CHECK abortaria a migration ou travaria a edicao dessas pessoas.
--   A validacao de digito entra como AVISO no formulario, via fn_cpf_digito_valido.
--
--   Nao torna o CPF obrigatorio. 57 dos 184 servidores ativos (31%) estao sem CPF, e exigi-lo
--   agora travaria a edicao de um terco da base. O indice e PARCIAL: NULL nao conflita com NULL
--   no Postgres, entao quem esta sem CPF continua podendo ser cadastrado - e continua sem
--   protecao, o que a varredura da secao 5 torna visivel em vez de deixar implicito.


-- ============================================================================
-- 1. NORMALIZACAO DO CPF
-- ============================================================================
-- Hoje os 127 CPFs preenchidos estao todos com 11 digitos e sem mascara, mas o campo e text
-- livre e nada impede "063.072.332-35" amanha. Normalizar no indice evita que a mascara vire
-- uma brecha para reintroduzir a duplicata.

CREATE OR REPLACE FUNCTION public.fn_cpf_normalizado(p_cpf text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
    SELECT NULLIF(regexp_replace(COALESCE(p_cpf, ''), '[^0-9]', '', 'g'), '')
$fn$;

COMMENT ON FUNCTION public.fn_cpf_normalizado(text) IS
    'CPF reduzido a digitos. NULL quando vazio. IMMUTABLE para poder indexar.';


-- ============================================================================
-- 2. LIMPEZA DA DUPLICATA EXISTENTE
-- ============================================================================
-- Regra de decisao: entre cadastros que dividem o mesmo CPF, fica o que TEM historico e
-- saem os que nao tem NENHUMA referencia em lugar nenhum.
--
-- Note que a regra NAO e "fica o mais antigo". No caso da producao seria exatamente o inverso:
--   T2600019 (mais ANTIGO, 05/08) setor ALMOXARIFADO -> 0 escalas, 0 marcacoes, 0 folhas
--   T2600014 (mais NOVO,   07/08) setor CAF          -> 1 escala 08/2026, 10 marcacoes, 1 folha
-- Apagar o mais novo levaria junto 10 batidas reais de ponto.
--
-- CONFIRMADO PELO USUARIO em 09/08/2026: a servidora e lotada na CAF - CENTRAL DE ABASTECIMENTO
-- FARMACEUTICO, e o cadastro do ALMOXARIFADO e o errado - ela nem esta na escala de la. A regra
-- por historico e o conhecimento do dominio convergiram no mesmo cadastro, o que e a validacao
-- da regra: quem tem escala, marcacao e folha e quem de fato trabalha ali.
--
-- Se DOIS cadastros do mesmo CPF tiverem historico, esta migration ABORTA. Fundir historico de
-- ponto de duas identidades e decisao de quem responde pela folha, nao efeito colateral de
-- migration - vide CLAUDE.md, correcao de dados aqui e irreversivel.
--
-- As tabelas que referenciam servidores sao descobertas em pg_constraint, nao listadas a mao:
-- uma FK nova criada depois desta migration passa a ser considerada automaticamente.

DO $limpeza$
DECLARE
    v_grupo      record;
    v_linha      record;
    v_fk         record;
    v_refs       bigint;
    v_total      bigint;
    v_com_hist   integer;
    v_removidos  integer := 0;
BEGIN
    FOR v_grupo IN
        SELECT public.fn_cpf_normalizado(cpf) AS cpf_norm, count(*) AS qtd
          FROM public.servidores
         WHERE public.fn_cpf_normalizado(cpf) IS NOT NULL
         GROUP BY 1
        HAVING count(*) > 1
    LOOP
        v_com_hist := 0;

        -- Primeira passada: quantos cadastros do grupo tem historico?
        FOR v_linha IN
            SELECT id, matricula, nome
              FROM public.servidores
             WHERE public.fn_cpf_normalizado(cpf) = v_grupo.cpf_norm
             ORDER BY created_at
        LOOP
            v_total := 0;

            FOR v_fk IN
                SELECT c.conrelid::regclass AS tabela,
                       a.attname           AS coluna
                  FROM pg_constraint c
                  JOIN pg_attribute  a ON a.attrelid = c.conrelid
                                      AND a.attnum   = c.conkey[1]
                 WHERE c.contype     = 'f'
                   AND c.confrelid   = 'public.servidores'::regclass
                   AND array_length(c.conkey, 1) = 1
            LOOP
                EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_fk.tabela, v_fk.coluna)
                   INTO v_refs USING v_linha.id;
                v_total := v_total + v_refs;
            END LOOP;

            IF v_total > 0 THEN
                v_com_hist := v_com_hist + 1;
                RAISE NOTICE 'CPF % - cadastro % (%) TEM % referencia(s): sera mantido',
                    v_grupo.cpf_norm, v_linha.matricula, v_linha.nome, v_total;
            ELSE
                RAISE NOTICE 'CPF % - cadastro % (%) sem nenhuma referencia: candidato a remocao',
                    v_grupo.cpf_norm, v_linha.matricula, v_linha.nome;
            END IF;
        END LOOP;

        IF v_com_hist > 1 THEN
            RAISE EXCEPTION
                'CPF % tem % cadastros COM historico. Fusao manual necessaria antes desta migration - '
                'apagar qualquer um deles destruiria registro de ponto.',
                v_grupo.cpf_norm, v_com_hist;
        END IF;

        IF v_com_hist = 0 THEN
            RAISE EXCEPTION
                'CPF % tem % cadastros e NENHUM com historico. Escolha manual de qual manter.',
                v_grupo.cpf_norm, v_grupo.qtd;
        END IF;

        -- Segunda passada: remove os sem referencia alguma.
        FOR v_linha IN
            SELECT id, matricula, nome
              FROM public.servidores
             WHERE public.fn_cpf_normalizado(cpf) = v_grupo.cpf_norm
        LOOP
            v_total := 0;

            FOR v_fk IN
                SELECT c.conrelid::regclass AS tabela,
                       a.attname           AS coluna
                  FROM pg_constraint c
                  JOIN pg_attribute  a ON a.attrelid = c.conrelid
                                      AND a.attnum   = c.conkey[1]
                 WHERE c.contype     = 'f'
                   AND c.confrelid   = 'public.servidores'::regclass
                   AND array_length(c.conkey, 1) = 1
            LOOP
                EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_fk.tabela, v_fk.coluna)
                   INTO v_refs USING v_linha.id;
                v_total := v_total + v_refs;
            END LOOP;

            IF v_total = 0 THEN
                DELETE FROM public.servidores WHERE id = v_linha.id;
                v_removidos := v_removidos + 1;
                RAISE NOTICE 'REMOVIDO cadastro duplicado % (%) - CPF %',
                    v_linha.matricula, v_linha.nome, v_grupo.cpf_norm;
            END IF;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Limpeza concluida: % cadastro(s) duplicado(s) sem historico removido(s).', v_removidos;
END
$limpeza$;


-- ============================================================================
-- 3. O BACKSTOP: INDICE UNICO
-- ============================================================================
-- Parcial (WHERE ... IS NOT NULL) porque 31% da base esta sem CPF e um UNIQUE cheio nao
-- ajudaria mesmo - NULL nunca conflita com NULL no Postgres. Sobre o valor NORMALIZADO para
-- que mascara nao seja rota de fuga.
--
-- Esta e a unica defesa que sobrevive a um deploy que esqueca a checagem no codigo, a um
-- INSERT feito direto no SQL editor e a um usuario com visao restrita pela RLS.

CREATE UNIQUE INDEX IF NOT EXISTS servidores_cpf_unico
    ON public.servidores (public.fn_cpf_normalizado(cpf))
 WHERE public.fn_cpf_normalizado(cpf) IS NOT NULL;

COMMENT ON INDEX public.servidores_cpf_unico IS
    'Cadastro unico por CPF. Parcial: quem esta sem CPF nao e coberto (ver fn_possiveis_duplicidades_servidor).';


-- ============================================================================
-- 4. CHECAGEM PREVIA PARA O FRONTEND (SEM RLS)
-- ============================================================================
-- Existe para dar mensagem util ANTES de estourar a constraint, e principalmente para enxergar
-- o que a RLS esconderia do usuario. Devolve so o suficiente para orientar - nao vaza dado
-- pessoal de servidor fora do escopo: nome, matricula e unidade, que e o que o coordenador
-- precisa para saber a quem pedir a transferencia.

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
$fn$;

COMMENT ON FUNCTION public.fn_cpf_ja_cadastrado(text, uuid) IS
    'Servidores que ja usam este CPF. SECURITY DEFINER de proposito: a RLS de servidores esconderia '
    'a duplicata de outra unidade e o usuario cadastraria de novo (mesma causa de 20260807110000).';

GRANT EXECUTE ON FUNCTION public.fn_cpf_ja_cadastrado(text, uuid) TO authenticated, service_role;


-- ============================================================================
-- 5. VARREDURA DE DUPLICIDADE PROVAVEL (COBRE QUEM ESTA SEM CPF)
-- ============================================================================
-- O indice unico protege os 127 com CPF. Os 57 sem CPF continuam desprotegidos, e nao ha como
-- resolver isso por constraint sem inventar identidade. O que da para fazer e tornar o problema
-- VISIVEL: nome normalizado igual e a evidencia mais forte disponivel quando falta o documento.
--
-- Serve para a tela de cadastros e para conferencia periodica. Nao bloqueia nada.

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
        SELECT 'cpf'::text AS criterio, cpf_norm AS chave, id, nome, matricula, cpf, telefone, email, status, unidade_nome
          FROM base WHERE cpf_norm IS NOT NULL
        UNION ALL
        SELECT 'nome', btrim(nome_norm), id, nome, matricula, cpf, telefone, email, status, unidade_nome
          FROM base WHERE btrim(COALESCE(nome_norm, '')) <> ''
        UNION ALL
        SELECT 'telefone', right(tel_norm, 11), id, nome, matricula, cpf, telefone, email, status, unidade_nome
          FROM base WHERE length(COALESCE(tel_norm, '')) >= 10
        UNION ALL
        SELECT 'email', lower(btrim(email)), id, nome, matricula, cpf, telefone, email, status, unidade_nome
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
     ORDER BY CASE criterio WHEN 'cpf' THEN 1 WHEN 'nome' THEN 2 WHEN 'telefone' THEN 3 ELSE 4 END, chave
$fn$;

COMMENT ON FUNCTION public.fn_possiveis_duplicidades_servidor() IS
    'Cadastros suspeitos de duplicidade por CPF, nome normalizado, telefone ou e-mail. Diagnostico, '
    'nao bloqueio - existe porque 31% da base nao tem CPF e o indice unico nao os alcanca.';

GRANT EXECUTE ON FUNCTION public.fn_possiveis_duplicidades_servidor() TO authenticated, service_role;


-- ============================================================================
-- 6. DIGITO VERIFICADOR (AVISO, NAO BLOQUEIO)
-- ============================================================================
-- Um CPF digitado errado escapa do indice unico: 06307223235 e 06307223236 sao valores
-- diferentes e o banco aceita os dois. O digito verificador e o que transforma erro de
-- digitacao em erro detectavel - e por isso ele importa para a unicidade, nao so para o
-- cadastro estar bonito.
--
-- Fica como funcao consultavel, nao como CHECK: 4 CPFs ja gravados reprovam.

CREATE OR REPLACE FUNCTION public.fn_cpf_digito_valido(p_cpf text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
    v      text;
    v_soma integer;
    v_d1   integer;
    v_d2   integer;
    i      integer;
BEGIN
    v := regexp_replace(COALESCE(p_cpf, ''), '[^0-9]', '', 'g');

    IF length(v) <> 11 THEN
        RETURN false;
    END IF;

    -- 00000000000, 11111111111 etc. passam na conta dos digitos, mas nao sao CPF.
    IF v ~ ('^(' || substr(v, 1, 1) || '){11}$') THEN
        RETURN false;
    END IF;

    v_soma := 0;
    FOR i IN 1..9 LOOP
        v_soma := v_soma + substr(v, i, 1)::integer * (11 - i);
    END LOOP;
    v_d1 := (v_soma * 10) % 11;
    IF v_d1 = 10 THEN v_d1 := 0; END IF;
    IF v_d1 <> substr(v, 10, 1)::integer THEN
        RETURN false;
    END IF;

    v_soma := 0;
    FOR i IN 1..10 LOOP
        v_soma := v_soma + substr(v, i, 1)::integer * (12 - i);
    END LOOP;
    v_d2 := (v_soma * 10) % 11;
    IF v_d2 = 10 THEN v_d2 := 0; END IF;

    RETURN v_d2 = substr(v, 11, 1)::integer;
END;
$fn$;

COMMENT ON FUNCTION public.fn_cpf_digito_valido(text) IS
    'Confere os dois digitos verificadores do CPF. Aviso no formulario - NAO e CHECK: 4 CPFs ja '
    'gravados em producao reprovam e travariam a edicao dessas pessoas.';

GRANT EXECUTE ON FUNCTION public.fn_cpf_digito_valido(text) TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. Nenhum CPF duplicado (deve retornar zero linhas):
--
--      SELECT public.fn_cpf_normalizado(cpf), count(*)
--        FROM servidores WHERE cpf IS NOT NULL
--       GROUP BY 1 HAVING count(*) > 1;
--
--   2. O fantasma T2600019 saiu e o T2600014 (com as 10 marcacoes) ficou:
--
--      SELECT matricula, nome, cpf FROM servidores WHERE cpf = '06307223235';
--      -- esperado: exatamente 1 linha, matricula T2600014
--
--   3. O indice existe e e usado:
--
--      SELECT indexname FROM pg_indexes
--       WHERE tablename = 'servidores' AND indexname = 'servidores_cpf_unico';
--
--   4. O que sobrou de suspeita (esperado: grupos por nome/telefone/email de quem nao tem CPF):
--
--      SELECT criterio, chave, quantidade FROM public.fn_possiveis_duplicidades_servidor();
--
--   5. CPFs com digito invalido, para correcao no cadastro (esperado: 4):
--
--      SELECT nome, matricula, cpf FROM servidores
--       WHERE cpf IS NOT NULL AND NOT public.fn_cpf_digito_valido(cpf);
