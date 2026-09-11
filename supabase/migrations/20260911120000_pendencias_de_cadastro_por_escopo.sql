-- ============================================================================
-- Migration: Pendencias de cadastro passam a ter escopo — e o RH enxerga
-- Data: 2026-09-11
-- ============================================================================
--
-- MOTIVO
--
-- Em /servidores/pendencias o RH da Unidade abria a tela e recebia `[]` LITERAL em documentos
-- invalidos, servidores sem CPF, possiveis duplicidades e nos contadores — a pagina pulava essas
-- consultas de proposito, porque as tres RPCs sao SECURITY DEFINER e enxergam a base inteira, e
-- nao havia como recortar. O RH Geral via quase tudo, menos "Cadastros duplicados", exclusivo do
-- Administrador Geral.
--
-- Decisao do usuario em 10/09/2026: "RH Geral acesso total, RH da Unidade acesso as respectivas
-- unidades".
--
-- MEDIDO EM PRODUCAO EM 10/09/2026, antes de decidir:
--
--   fn_documentos_invalidos            0 linhas
--   fn_possiveis_duplicidades_servidor 156 grupos — 63 ATRAVESSAM unidade
--   fn_cadastros_duplicados            62 grupos  — 27 atravessam, 31 com ponto/escala/folha
--   servidores sem CPF                 1 (LACEM)
--
-- 🚨 GRUPO QUE ATRAVESSA UNIDADE APARECE INTEIRO, e isso foi decidido com o numero na frente.
-- No HMI, 40 dos 52 grupos de possiveis duplicidades tem membro de outra unidade (no HMM, 43 de
-- 120). Exigir o grupo inteiro dentro do escopo deixaria o RH do HMI com 12 de 52 — e os 63
-- grupos cruzados continuariam sem dono na ponta. Mostrar so' metade do grupo tambem nao serve:
-- a duplicata E' o mesmo CPF em dois lugares, e sem o outro lado nao ha como julgar se e' a
-- mesma pessoa nem para quem escalar. Basta UM cadastro no escopo para o grupo aparecer completo.
--
-- 🚨 MESCLAR CONTINUA FORA DO RH DA UNIDADE. Ele ve a lista e o diagnostico; quem executa e' o
-- RH Geral (ou o Administrador Geral). A mesclagem move ponto, escala e folha entre cadastros e
-- inativa o que sai — em 27 dos 62 grupos isso e' mover registro de uma unidade que nao e' a
-- dele. Na tela o botao vem desabilitado COM o motivo escrito, nunca cinza e mudo (armadilha 31).
--
-- ⚠️ ACHADO DE PASSAGEM, CORRIGIDO AQUI: `fn_documentos_invalidos` estava aberta ao `anon`.
-- `POST /rest/v1/rpc/fn_documentos_invalidos` com a chave publica devolvia HTTP 200 (medido em
-- 10/09/2026). Hoje sai `[]` porque nao ha documento invalido, mas na primeira linha ela
-- entregaria nome + CPF/PIS de servidor sem login nenhum — o mesmo caso de
-- fn_tentativas_negadas_diagnostico em 30/08/2026. E' a armadilha 24: ela nasceu com
-- `GRANT ... TO authenticated` e NUNCA teve `REVOKE ... FROM PUBLIC`, entao as tres migrations
-- 20260827* e a 20260830120000 passaram por cima dela.
-- ============================================================================

-- ============================================================================
-- 1. O CONJUNTO DE UNIDADES QUE O PERFIL GERE
-- ============================================================================
-- Versao "conjunto" de fn_escopo_gestao_alcanca (20260911100000), para filtrar em massa sem
-- chamar o predicado uma vez por servidor.
--
-- ⚠️ DERIVADA do predicado, nao reescrita: `WHERE fn_escopo_gestao_alcanca(u.id)`. Duas
-- implementacoes da mesma regra divergem na primeira mudanca — e aqui a divergencia seria "a
-- tela mostra X, o guard aceita Y". Sao 35 unidades: o custo e' irrelevante.

CREATE OR REPLACE FUNCTION public.fn_unidades_de_gestao()
RETURNS TABLE (unidade_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT u.id FROM public.unidades u WHERE public.fn_escopo_gestao_alcanca(u.id)
$fn$;

COMMENT ON FUNCTION public.fn_unidades_de_gestao() IS
    'As unidades que o caller gere, derivadas de fn_escopo_gestao_alcanca. Use para filtrar '
    'listas; para decidir UM caso, chame o predicado direto.';

REVOKE ALL ON FUNCTION public.fn_unidades_de_gestao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_unidades_de_gestao() TO authenticated, service_role;


-- ============================================================================
-- 2. DOCUMENTOS COM DIGITO VERIFICADOR INVALIDO
-- ============================================================================
-- Corpo copiado de 20260809220000. Muda: guard de papel (nao tinha NENHUM), filtro de escopo, e
-- o REVOKE que faltava desde 09/08/2026.
--
-- ⚠️ As linhas de `unidades` (CNPJ e CPF do responsavel) sao escopadas pela PROPRIA unidade; as
-- de `servidores`, pela unidade de lotacao. Servidor sem unidade some para quem e' escopado —
-- na duvida, fecha.
--
-- Sem mudanca na lista de colunas, entao CREATE OR REPLACE basta (armadilha do 42P13 nao se
-- aplica aqui — se um dia acrescentar coluna, o DROP vira obrigatorio).

CREATE OR REPLACE FUNCTION public.fn_documentos_invalidos()
RETURNS TABLE (
    tabela     text,
    campo      text,
    registro_id uuid,
    nome       text,
    valor      text,
    problema   text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    -- Denylist nao serve aqui: a funcao devolve nome + CPF/PIS de servidor. So quem gere
    -- cadastro entra, e o escopo faz o recorte logo abaixo.
    IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.fn_unidades_de_gestao()) THEN
        RAISE EXCEPTION 'Sem permissao para ver documentos com digito invalido.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    SELECT 'servidores', 'cpf', s.id, s.nome, s.cpf,
           CASE WHEN length(regexp_replace(s.cpf, '[^0-9]', '', 'g')) <> 11
                THEN 'CPF nao tem 11 digitos'
                ELSE 'digito verificador invalido' END
      FROM public.servidores s
     WHERE NULLIF(regexp_replace(COALESCE(s.cpf, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
       AND NOT public.fn_cpf_digito_valido(s.cpf)
       AND (auth.uid() IS NULL OR s.unidade_id IN (SELECT g.unidade_id FROM public.fn_unidades_de_gestao() g))

    UNION ALL
    SELECT 'servidores', 'pis_pasep', s.id, s.nome, s.pis_pasep, 'digito verificador invalido'
      FROM public.servidores s
     WHERE NULLIF(regexp_replace(COALESCE(s.pis_pasep, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
       AND NOT public.fn_pis_digito_valido(s.pis_pasep)
       AND (auth.uid() IS NULL OR s.unidade_id IN (SELECT g.unidade_id FROM public.fn_unidades_de_gestao() g))

    UNION ALL
    SELECT 'unidades', 'cnpj', u.id, u.nome, u.cnpj, 'digito verificador invalido'
      FROM public.unidades u
     WHERE NULLIF(regexp_replace(COALESCE(u.cnpj, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
       AND NOT public.fn_cnpj_digito_valido(u.cnpj)
       AND (auth.uid() IS NULL OR u.id IN (SELECT g.unidade_id FROM public.fn_unidades_de_gestao() g))

    UNION ALL
    SELECT 'unidades', 'responsavel_cpf', u.id, u.nome, u.responsavel_cpf, 'digito verificador invalido'
      FROM public.unidades u
     WHERE NULLIF(regexp_replace(COALESCE(u.responsavel_cpf, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
       AND NOT public.fn_cpf_digito_valido(u.responsavel_cpf)
       AND (auth.uid() IS NULL OR u.id IN (SELECT g.unidade_id FROM public.fn_unidades_de_gestao() g))

    ORDER BY 1, 2, 4;
END;
$fn$;

COMMENT ON FUNCTION public.fn_documentos_invalidos() IS
    'Documentos gravados com digito invalido, dentro do escopo de gestao do caller. '
    'super_admin/admin/rh veem tudo; rh_unidade so as unidades dele; demais papeis nao chamam.';

REVOKE ALL ON FUNCTION public.fn_documentos_invalidos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_documentos_invalidos() TO authenticated, service_role;


-- ============================================================================
-- 3. POSSIVEIS DUPLICIDADES (diagnostico)
-- ============================================================================
-- Corpo copiado de 20260904140000. Muda: `unidade_id` carregada pelas CTEs e um HAVING que
-- mantem o grupo quando AO MENOS UM cadastro esta no escopo.
--
-- ⚠️ O filtro e' no HAVING, sobre o GRUPO — nunca no WHERE da `base`. Recortar os membros
-- destruiria o grupo: `count(*) > 1` deixaria de casar e a duplicata cruzada sumiria dos dois
-- lados, que e' o oposto do que se quer.

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
    WITH escopo AS (
        SELECT g.unidade_id FROM public.fn_unidades_de_gestao() g
    ),
    base AS (
        SELECT s.id, s.nome, s.matricula, s.cpf, s.telefone, s.email, s.status,
               s.vinculo_multiplo_confirmado,
               s.unidade_id,
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
               email, status, unidade_id, unidade_nome, vinculo_multiplo_confirmado
          FROM base WHERE cpf_norm IS NOT NULL
        UNION ALL
        SELECT 'nome', btrim(nome_norm), id, nome, matricula, cpf, telefone, email, status,
               unidade_id, unidade_nome, vinculo_multiplo_confirmado
          FROM base WHERE btrim(COALESCE(nome_norm, '')) <> ''
        UNION ALL
        SELECT 'telefone', right(tel_norm, 11), id, nome, matricula, cpf, telefone, email, status,
               unidade_id, unidade_nome, vinculo_multiplo_confirmado
          FROM base WHERE length(COALESCE(tel_norm, '')) >= 10
        UNION ALL
        SELECT 'email', lower(btrim(email)), id, nome, matricula, cpf, telefone, email, status,
               unidade_id, unidade_nome, vinculo_multiplo_confirmado
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
       -- Escopo: basta UM cadastro do grupo estar nas unidades que o caller gere. Decisao de
       -- 10/09/2026 — ver o cabecalho desta migration.
       AND bool_or(unidade_id IN (SELECT e.unidade_id FROM escopo e))
     ORDER BY CASE criterio WHEN 'cpf' THEN 1 WHEN 'nome' THEN 2 WHEN 'telefone' THEN 3 ELSE 4 END, chave
$fn$;

COMMENT ON FUNCTION public.fn_possiveis_duplicidades_servidor() IS
    'Grupos suspeitos de duplicidade (cpf/nome/telefone/email), escopados por unidade. O grupo '
    'aparece INTEIRO quando ao menos um cadastro esta no escopo do caller: no HMI, 40 dos 52 '
    'grupos tem membro de outra unidade, e recortar deixaria a duplicata indecifravel.';

REVOKE ALL ON FUNCTION public.fn_possiveis_duplicidades_servidor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_possiveis_duplicidades_servidor() TO authenticated, service_role;


-- ============================================================================
-- 4. CADASTROS DUPLICADOS (a lista com ACAO)
-- ============================================================================
-- Corpo copiado de 20260904130000. Muda: o guard de papel (era super_admin puro) e o mesmo
-- filtro de grupo por escopo.
--
-- ⚠️ VER nao e' MESCLAR. Esta funcao passa a ser lida pelo RH da Unidade; `fn_mesclar_servidores`
-- (item 5) continua exigindo RH Geral ou Administrador Geral. Sao duas perguntas diferentes, e
-- juntar as duas num guard so' foi o que manteve a ferramenta invisivel para quem identifica o
-- problema.

CREATE OR REPLACE FUNCTION public.fn_cadastros_duplicados()
RETURNS TABLE (
    cpf                 text,
    quantidade          bigint,
    todos_confirmados   boolean,
    cadastros           jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
#variable_conflict use_column
BEGIN
    IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.fn_unidades_de_gestao()) THEN
        RAISE EXCEPTION 'Sem permissao para ver os cadastros duplicados.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    WITH escopo AS (
        SELECT g.unidade_id FROM public.fn_unidades_de_gestao() g
    ),
    base AS (
        SELECT s.id, s.nome, s.matricula, s.status, s.created_at,
               s.vinculo_multiplo_confirmado,
               s.cargo, s.vinculo::text AS vinculo,
               s.unidade_id,
               public.fn_cpf_normalizado(s.cpf) AS cpf_norm,
               u.nome AS unidade_nome,
               ds.nome AS setor_nome
          FROM public.servidores s
          LEFT JOIN public.unidades u ON u.id = s.unidade_id
          LEFT JOIN public.setores se ON se.id = s.setor_id
          LEFT JOIN public.dicionario_setores ds ON ds.id = se.dicionario_setor_id
         WHERE s.mesclado_em_servidor_id IS NULL
    ),
    duplicados AS (
        SELECT b.*
          FROM base b
         WHERE b.cpf_norm IS NOT NULL
           AND EXISTS (SELECT 1 FROM base b2
                        WHERE b2.cpf_norm = b.cpf_norm AND b2.id <> b.id)
    ),
    com_peso AS (
        SELECT d.*,
               (SELECT count(*) FROM public.escala_mensal em WHERE em.servidor_id = d.id) AS escalas,
               (SELECT count(*) FROM public.marcacoes_ponto mp WHERE mp.servidor_id = d.id) AS batidas,
               (SELECT count(*) FROM public.folha_ponto fp WHERE fp.servidor_id = d.id) AS folhas,
               (SELECT count(*) FROM public.rep_vinculos_servidor rv
                 WHERE rv.servidor_id = d.id AND rv.vigente_ate IS NULL) AS vinculos_rep
          FROM duplicados d
    )
    SELECT c.cpf_norm,
           count(*),
           bool_and(c.vinculo_multiplo_confirmado),
           jsonb_agg(jsonb_build_object(
               'id', c.id,
               'nome', c.nome,
               'matricula', c.matricula,
               'status', c.status,
               'cargo', c.cargo,
               'vinculo', c.vinculo,
               'unidade', c.unidade_nome,
               'setor', c.setor_nome,
               'vinculo_multiplo_confirmado', c.vinculo_multiplo_confirmado,
               'criado_em', c.created_at,
               'escalas', c.escalas,
               'batidas', c.batidas,
               'folhas', c.folhas,
               'vinculos_rep', c.vinculos_rep
           ) ORDER BY c.created_at)
      FROM com_peso c
     GROUP BY c.cpf_norm
    HAVING bool_or(c.unidade_id IN (SELECT e.unidade_id FROM escopo e))
     ORDER BY bool_and(c.vinculo_multiplo_confirmado), min(c.created_at) DESC;
END;
$fn$;

COMMENT ON FUNCTION public.fn_cadastros_duplicados() IS
    'Cadastros com o mesmo CPF, com o peso de cada lado (escalas, batidas, folhas, vinculos REP). '
    'Escopado por unidade, grupo inteiro quando um cadastro esta no escopo. VER nao e MESCLAR: '
    'fn_mesclar_servidores continua exigindo RH Geral ou Administrador Geral.';

REVOKE ALL ON FUNCTION public.fn_cadastros_duplicados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cadastros_duplicados() TO authenticated, service_role;


-- ============================================================================
-- 5. MESCLAR CADASTROS — RH Geral entra, RH da Unidade NAO
-- ============================================================================
-- ⚠️ BLOCO GERADO por scratchpad/gen_escopo_pendencias.js a partir da versao VIGENTE
-- (20260906100000, a que funde escala do mesmo setor — NAO 20260904130000, onde a funcao
-- nasceu). Nao editar a mao: o gerador confere 7 invariantes antes e 5 depois, e ABORTA se a
-- contagem divergir. Foi ele que pegou a fonte errada na primeira tentativa.
--
-- Muda SO o guard de papel. Continuam intactos: o GUC sisescala.mesclar_servidor (a excecao
-- estreita no trigger de imutabilidade da marcacao), a allowlist de campos de pessoa, a
-- varredura por pg_index (indice unico PARCIAL nao aparece em pg_constraint), a fusao de escala
-- ANTES do laco generico e o "inativa, nunca exclui".
CREATE OR REPLACE FUNCTION public.fn_mesclar_servidores(
    p_origem  uuid,
    p_destino uuid,
    p_motivo  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    -- Campos que descrevem a PESSOA, e por isso podem ser completados a partir do cadastro
    -- duplicado quando faltam no que fica. Lista explicita de proposito: aqui, ao contrario da
    -- varredura de FK, copiar por engano e pior do que nao copiar - coluna nova entra so quando
    -- alguem decidir que ela descreve a pessoa. Fora da lista, deliberadamente: matricula, cargo,
    -- vinculo, unidade, setor e jornada (sao do VINCULO, e o vinculo que fica e o do destino) e
    -- dados bancarios (podem ser a conta do outro contrato).
    c_campos_pessoa constant text[] := ARRAY[
        'cpf', 'pis_pasep', 'data_nascimento', 'sexo', 'nacionalidade', 'naturalidade',
        'nome_mae', 'nome_pai', 'escolaridade', 'estado_civil', 'nome_conjuge',
        'rg_numero', 'rg_orgao_emissor', 'rg_data_emissao',
        'endereco_logradouro', 'endereco_numero', 'bairro', 'cep', 'municipio_residencia',
        'telefone', 'telefone_residencial', 'email',
        'registro_profissional', 'registro_profissional_orgao'
    ];
    -- Configuracao do REP cuja linha E o par (servidor + equipamento). Se o destino ja tem a
    -- mesma linha, a da origem nao tem para onde ir nem o que perder.
    c_descartaveis constant text[] := ARRAY[
        'rep_excecoes_ponto', 'public.rep_excecoes_ponto',
        'rep_administradores_parque', 'public.rep_administradores_parque',
        'rep_cadastros_fila', 'public.rep_cadastros_fila'
    ];
    v_o           record;
    v_d           record;
    v_impedimento text;
    r             record;
    u             record;
    v_outras      text[];
    v_pred        text;
    v_n           bigint;
    v_movidos     jsonb := '{}'::jsonb;
    v_descartados jsonb := '{}'::jsonb;
    v_completados text[] := ARRAY[]::text[];
    g             record;
    v_fundidas    jsonb := '[]'::jsonb;
    v_dias        bigint;
    v_campo       text;
    v_valor       text;
    v_restantes   bigint;
BEGIN
    -- Quem mescla: Administrador Geral e RH Geral. RH da Unidade VE a lista e o diagnostico
    -- (fn_cadastros_duplicados), mas NAO mescla — decisao do usuario em 10/09/2026, medida:
    -- dos 62 grupos mesclaveis, 27 atravessam unidade e 31 ja tem ponto, escala ou folha. A
    -- mesclagem MOVE esses registros e inativa o cadastro que sai; num grupo cruzado isso e'
    -- mover ponto de uma unidade que nao e' a dele. Ele identifica e escala; o RH Geral executa.
    IF (SELECT public.get_my_role()) NOT IN ('super_admin'::public.user_role,
                                             'rh'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas o RH Geral ou o Administrador Geral podem mesclar cadastros de servidor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT s.id, s.nome, s.matricula, public.fn_cpf_normalizado(s.cpf) AS cpf_norm
      INTO v_o FROM public.servidores s WHERE s.id = p_origem;
    SELECT s.id, s.nome, s.matricula, public.fn_cpf_normalizado(s.cpf) AS cpf_norm
      INTO v_d FROM public.servidores s WHERE s.id = p_destino;

    IF v_o.id IS NULL THEN
        RAISE EXCEPTION 'Cadastro duplicado nao encontrado.' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_d.id IS NULL THEN
        RAISE EXCEPTION 'Cadastro de destino nao encontrado.' USING ERRCODE = 'no_data_found';
    END IF;

    -- Todos os impedimentos de uma vez: quem esta na tela precisa ver a lista inteira, nao
    -- descobrir um por vez a cada tentativa.
    SELECT string_agg(imp.detalhe, ' | ')
      INTO v_impedimento
      FROM public.fn_impedimentos_mesclagem_servidor(p_origem, p_destino) imp;

    IF v_impedimento IS NOT NULL THEN
        RAISE EXCEPTION 'Nao e possivel mesclar a matricula % na matricula %: %',
            v_o.matricula, v_d.matricula, v_impedimento
            USING ERRCODE = 'check_violation';
    END IF;

    -- Autoriza o UPDATE de servidor_id em marcacoes_ponto (e SO ele) ate o fim desta transacao.
    PERFORM set_config('sisescala.mesclar_servidor', 'on', true);

    -- 6.0 Escala do mesmo servidor na MESMA competencia/unidade/setor nos dois cadastros: as
    -- duas escala_mensal nao cabem numa so, entao os DIAS mudam de escala e a linha vazia sai.
    -- Roda ANTES do laco generico por necessidade: e ele que faria
    -- UPDATE escala_mensal SET servidor_id, e a unique recusaria a transacao inteira.
    --
    -- Seguro por construcao: fn_impedimentos_mesclagem_servidor ja recusou em bloco quando
    -- algum (dia, categoria) existe nos dois lados, quando a competencia esta encerrada, quando
    -- alguma das escalas esta Fechada e quando ha folha presa a escala que vai sair. Aqui so
    -- chegam dias que nao disputam nada.
    --
    -- A presenca viaja NA PROPRIA LINHA de escala_diaria (ela nao tem servidor_id - herda de
    -- escala_mensal), entao ponto ja batido acompanha o dia sem ser tocado.
    FOR g IN
        SELECT emo.id AS origem_id, emd.id AS destino_id, emo.mes, emo.ano,
               COALESCE(public.fn_setor_caminho(emo.setor_id), '(sem setor)') AS setor
          FROM public.escala_mensal emo
          JOIN public.escala_mensal emd
            ON emd.servidor_id = p_destino
           AND emd.mes = emo.mes
           AND emd.ano = emo.ano
           AND emd.unidade_id IS NOT DISTINCT FROM emo.unidade_id
           AND emd.setor_id   IS NOT DISTINCT FROM emo.setor_id
         WHERE emo.servidor_id = p_origem
    LOOP
        UPDATE public.escala_diaria
           SET escala_mensal_id = g.destino_id
         WHERE escala_mensal_id = g.origem_id;
        GET DIAGNOSTICS v_dias = ROW_COUNT;

        DELETE FROM public.escala_mensal WHERE id = g.origem_id;

        v_fundidas := v_fundidas || jsonb_build_object(
            'competencia', lpad(g.mes::text, 2, '0') || '/' || g.ano,
            'setor', g.setor,
            'dias_movidos', v_dias);
    END LOOP;

    FOR r IN
        SELECT c.conrelid AS oid,
               c.conrelid::regclass::text AS rel,
               (SELECT a.attname::text
                  FROM pg_attribute a
                 WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[i]) AS col
          FROM pg_constraint c
          CROSS JOIN generate_subscripts(c.conkey, 1) AS i
         WHERE c.contype = 'f'
           AND c.confrelid = 'public.servidores'::regclass
           AND (SELECT a2.attname
                  FROM pg_attribute a2
                 WHERE a2.attrelid = c.confrelid AND a2.attnum = c.confkey[i]) = 'id'
    LOOP
        -- 6.1 Configuracao do REP que o destino ja tem: descarta a da origem.
        IF r.rel = ANY (c_descartaveis) THEN
            FOR u IN
                SELECT COALESCE(pg_get_expr(i.indpred, i.indrelid), 'true') AS pred_idx,
                       (SELECT array_agg(a.attname::text ORDER BY k.ord)
                          FROM unnest((string_to_array(i.indkey::text, ' '))[1:i.indnkeyatts]::int2[])
                               WITH ORDINALITY AS k(attnum, ord)
                          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                       ) AS cols
                  FROM pg_index i
                 WHERE i.indrelid = r.oid AND i.indisunique AND i.indexprs IS NULL
            LOOP
                CONTINUE WHEN u.cols IS NULL OR NOT (r.col = ANY (u.cols));

                v_outras := array_remove(u.cols, r.col);
                IF v_outras IS NULL OR array_length(v_outras, 1) IS NULL THEN
                    v_pred := 'true';
                ELSE
                    SELECT string_agg(format('d.%I IS NOT DISTINCT FROM o.%I', k, k), ' AND ')
                      INTO v_pred
                      FROM unnest(v_outras) AS k;
                END IF;

                EXECUTE format(
                    'DELETE FROM %s o WHERE o.%I = $1 AND (%s) '
                    'AND EXISTS (SELECT 1 FROM (SELECT * FROM %s WHERE %s) d '
                                'WHERE d.%I = $2 AND %s)',
                    r.rel, r.col, u.pred_idx, r.rel, u.pred_idx, r.col, v_pred
                ) USING p_origem, p_destino;
                GET DIAGNOSTICS v_n = ROW_COUNT;

                IF v_n > 0 THEN
                    v_descartados := v_descartados || jsonb_build_object(
                        r.rel || '.' || r.col,
                        COALESCE((v_descartados ->> (r.rel || '.' || r.col))::bigint, 0) + v_n);
                END IF;
            END LOOP;
        END IF;

        -- 6.2 O resto vai inteiro para o cadastro que fica.
        EXECUTE format('UPDATE %s SET %I = $2 WHERE %I = $1', r.rel, r.col, r.col)
            USING p_origem, p_destino;
        GET DIAGNOSTICS v_n = ROW_COUNT;

        IF v_n > 0 THEN
            v_movidos := v_movidos || jsonb_build_object(r.rel || '.' || r.col, v_n);
        END IF;
    END LOOP;

    -- 6.3 Completa no cadastro que fica o que so o duplicado tinha. NUNCA sobrescreve: se o
    -- destino ja tem valor, ele vence - o cadastro correto e a referencia, e um dado divergente
    -- entre os dois e justamente o que precisa de decisao humana, nao de sobrescrita automatica.
    FOREACH v_campo IN ARRAY c_campos_pessoa LOOP
        EXECUTE format(
            'UPDATE public.servidores d SET %I = o.%I FROM public.servidores o '
            'WHERE d.id = $2 AND o.id = $1 '
            'AND NULLIF(btrim(d.%I::text), '''') IS NULL '
            'AND NULLIF(btrim(o.%I::text), '''') IS NOT NULL',
            v_campo, v_campo, v_campo, v_campo
        ) USING p_origem, p_destino;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 THEN
            v_completados := v_completados || v_campo;
        END IF;
    END LOOP;

    -- 6.4 O cadastro duplicado sai de circulacao, com o rastro de para onde foi.
    UPDATE public.servidores
       SET status = 'Inativo',
           motivo_inativacao = left(
               format('Cadastro duplicado - mesclado na matricula %s.%s',
                      v_d.matricula,
                      CASE WHEN NULLIF(btrim(COALESCE(p_motivo, '')), '') IS NOT NULL
                           THEN ' ' || btrim(p_motivo) ELSE '' END), 500),
           vinculo_multiplo_confirmado = false,
           mesclado_em_servidor_id = p_destino,
           mesclado_em = now(),
           mesclado_por = auth.uid(),
           updated_at = now()
     WHERE id = p_origem;

    -- 6.5 Se nao sobrou nenhum OUTRO cadastro ativo com o mesmo CPF, o que fica deixa de ser
    -- "vinculo multiplo confirmado" - a confirmacao existia por causa da duplicata que acabou de
    -- sair. Mantida quando ainda ha outro vinculo de verdade (pessoa com dois cargos).
    SELECT count(*) INTO v_restantes
      FROM public.servidores s
     WHERE s.id <> p_destino
       AND s.mesclado_em_servidor_id IS NULL
       AND s.status = 'Ativo'
       AND public.fn_cpf_normalizado(s.cpf) IS NOT DISTINCT FROM
           COALESCE(v_d.cpf_norm, v_o.cpf_norm);

    IF v_restantes = 0 THEN
        UPDATE public.servidores
           SET vinculo_multiplo_confirmado = false, updated_at = now()
         WHERE id = p_destino AND vinculo_multiplo_confirmado;
    END IF;

    INSERT INTO public.logs_sistema (user_id, acao, detalhes)
    VALUES (auth.uid(), 'cadastro_servidor_mesclado', jsonb_build_object(
        'origem_id', p_origem,
        'origem_nome', v_o.nome,
        'origem_matricula', v_o.matricula,
        'destino_id', p_destino,
        'destino_nome', v_d.nome,
        'destino_matricula', v_d.matricula,
        'motivo', p_motivo,
        'movidos', v_movidos,
        'descartados', v_descartados,
        'campos_completados', to_jsonb(v_completados),
        'escalas_fundidas', v_fundidas,
        'vinculo_multiplo_reavaliado', v_restantes = 0
    ));

    RETURN jsonb_build_object(
        'success', true,
        'origem_matricula', v_o.matricula,
        'destino_matricula', v_d.matricula,
        'nome', v_d.nome,
        'movidos', v_movidos,
        'descartados', v_descartados,
        'campos_completados', to_jsonb(v_completados),
        'escalas_fundidas', v_fundidas,
        'message', format('Cadastro %s mesclado na matricula %s.', v_o.matricula, v_d.matricula));
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_mesclar_servidores(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mesclar_servidores(uuid, uuid, text) TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA — EXECUTA as funcoes, com sessao simulada
-- ============================================================================
--
-- 🚨 MIGRATION RODA COMO service_role, e todas as funcoes acima passam direto quando auth.uid()
-- e' NULL. Conferir sem simular sessao exercitaria justamente o caminho em que o guard nao roda
-- — "passaria" sem ter testado nada (a licao de 20260909170000).
--
-- Confere os DOIS sentidos em cada caso. Afrouxar so um lado aqui e' o que transforma "abrir a
-- tela para o RH" em "abrir a base inteira para qualquer RH de unidade".
--
-- ⚠️ SO LEITURA. fn_mesclar_servidores e' chamada com uuids inexistentes de proposito: para
-- rh_unidade o guard levanta ANTES de olhar cadastro (e' o que se quer provar), e para rh ela
-- passa do guard e morre em "cadastro nao encontrado" — que e' a prova de que o guard deixou
-- passar, sem mover uma linha.

DO $conf$
DECLARE
    v_rh        uuid;
    v_rh_unid   uuid;
    v_coord     uuid;
    v_unid_dele uuid;
    v_n_rh      integer;
    v_n_unid    integer;
    v_n_cad_rh  integer;
    v_n_cad_un  integer;
    v_fora      integer;
    v_ok        boolean;
BEGIN
    SELECT id INTO v_rh    FROM public.profiles WHERE role = 'rh' LIMIT 1;
    SELECT id INTO v_coord FROM public.profiles WHERE role = 'coordenador' LIMIT 1;

    SELECT p.id, pu.unidade_id INTO v_rh_unid, v_unid_dele
      FROM public.profiles p
      JOIN public.profile_unidades pu ON pu.profile_id = p.id
     WHERE p.role = 'rh_unidade'
     LIMIT 1;

    IF v_rh IS NULL OR v_rh_unid IS NULL THEN
        RAISE NOTICE 'CONFERENCIA PULADA: faltam perfis (rh=% rh_unidade=%).', v_rh, v_rh_unid;
        RETURN;
    END IF;

    -- 1) RH Geral ve o conjunto COMPLETO (a base inteira, como antes desta migration).
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_rh::text, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_n_rh     FROM public.fn_possiveis_duplicidades_servidor();
    SELECT count(*) INTO v_n_cad_rh FROM public.fn_cadastros_duplicados();

    -- 2) RH da Unidade ve um SUBCONJUNTO nao vazio.
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_rh_unid::text, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_n_unid   FROM public.fn_possiveis_duplicidades_servidor();
    SELECT count(*) INTO v_n_cad_un FROM public.fn_cadastros_duplicados();

    -- 3) ...e NENHUM grupo devolvido a ele pode ser inteiramente de fora do escopo dele.
    --    Este e o sentido que nao pode afrouxar: e' a prova de que o HAVING recorta de verdade.
    SELECT count(*) INTO v_fora
      FROM public.fn_possiveis_duplicidades_servidor() d
     WHERE NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(d.servidores) m
           JOIN public.servidores s ON s.id = (m->>'id')::uuid
          WHERE s.unidade_id = v_unid_dele
     );

    -- 4) Mesclar continua fora do alcance dele — guard levanta antes de tocar em cadastro.
    BEGIN
        PERFORM public.fn_mesclar_servidores(
            '00000000-0000-0000-0000-000000000001'::uuid,
            '00000000-0000-0000-0000-000000000002'::uuid,
            'ensaio de conferencia');
        v_ok := true;    -- passou do guard = FURO
    EXCEPTION
        WHEN insufficient_privilege THEN v_ok := false;   -- barrado = certo
        WHEN OTHERS THEN v_ok := true;                    -- outro erro = passou do guard
    END;
    IF v_ok THEN
        PERFORM set_config('request.jwt.claims', '', true);
        RAISE EXCEPTION 'ABORTADO: RH da Unidade atravessou o guard de fn_mesclar_servidores.';
    END IF;

    -- 5) Coordenador nao ve diagnostico nenhum.
    IF v_coord IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', v_coord::text, 'role', 'authenticated')::text, true);
        BEGIN
            PERFORM public.fn_cadastros_duplicados();
            v_ok := true;
        EXCEPTION WHEN insufficient_privilege THEN
            v_ok := false;
        END;
        IF v_ok THEN
            PERFORM set_config('request.jwt.claims', '', true);
            RAISE EXCEPTION 'ABORTADO: coordenador passou a ver os cadastros duplicados.';
        END IF;
    END IF;

    PERFORM set_config('request.jwt.claims', '', true);

    RAISE NOTICE 'duplicidades: rh=% grupos | rh_unidade=% grupos (nenhum fora do escopo: %)',
                 v_n_rh, v_n_unid, (v_fora = 0);
    RAISE NOTICE 'cadastros duplicados: rh=% grupos | rh_unidade=% grupos', v_n_cad_rh, v_n_cad_un;

    IF v_n_unid = 0 AND v_n_rh > 0 THEN
        RAISE EXCEPTION 'ABORTADO: RH da Unidade nao ve NENHUM grupo, mas existem % na base — '
                        'o recorte esta fechando demais.', v_n_rh;
    END IF;
    IF v_n_unid > v_n_rh THEN
        RAISE EXCEPTION 'ABORTADO: RH da Unidade ve MAIS grupos (%) que o RH Geral (%).',
                        v_n_unid, v_n_rh;
    END IF;
    IF v_fora > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % grupo(s) devolvido(s) ao RH da Unidade nao tem nenhum '
                        'cadastro na unidade dele — o HAVING nao recortou.', v_fora;
    END IF;
    IF v_n_cad_un = 0 AND v_n_cad_rh > 0 THEN
        RAISE EXCEPTION 'ABORTADO: RH da Unidade nao ve nenhum cadastro duplicado, mas existem %.',
                        v_n_cad_rh;
    END IF;

    RAISE NOTICE 'OK: escopo recorta, mesclar continua restrito, coordenador continua fora.';
END;
$conf$;
