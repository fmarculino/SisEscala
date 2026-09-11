-- ============================================================================
-- MESCLAGEM COM IDENTIDADE DIVERGENTE — quando o CPF errado E O DEFEITO
-- ============================================================================
-- 11/09/2026
--
-- O PROBLEMA. A mesclagem de cadastros duplicados sempre exigiu o MESMO CPF nos dois lados, e
-- por um motivo que continua valendo: o CPF e o dado que diz que os dois cadastros descrevem a
-- mesma pessoa, e mesclar pessoas diferentes e o pior erro que esta ferramenta comete — o ponto
-- de uma vira ponto da outra, e nao ha desfazer.
--
-- So que existe o caso oposto, e ele apareceu em producao: o cadastro foi refeito com um CPF
-- de OUTRA pessoa. Ai o CPF divergente nao e o sinal de que sao duas pessoas — e o proprio erro
-- que se quer corrigir.
--
-- 🚨 E A SAIDA QUE A MENSAGEM MANDAVA SEGUIR ERA CIRCULAR. O texto do impedimento dizia
-- "corrija o CPF errado na ficha antes de mesclar". Gravar na ficha o CPF que ja esta no outro
-- cadastro esbarra em fn_cpf_ja_cadastrado (o portao de createServidor/updateServidor desde que
-- o indice unico caiu), e a unica saida que ele oferece e marcar "vinculo adicional" — que e
-- exatamente a caixa cujo uso indevido cria a duplicata (armadilha 50 do CLAUDE.md). Nao havia
-- caminho nenhum: a tela apontava o problema e mandava fazer o que o sistema nao permite
-- (armadilha 44).
--
-- MEDIDO EM PRODUCAO EM 11/09/2026, antes de decidir:
--
--   * 2.643 servidores ativos nao mesclados; 62 grupos com NOME identico.
--   * 61 desses grupos tem o MESMO CPF dos dois lados (ja eram mesclaveis). 1 nao tem.
--   * o unico grupo com CPF divergente e por nome: SAMU-SMS, dois cadastros criados com 25 min
--     de diferenca no mesmo dia, mesma unidade, mesmo cargo, mesmo telefone, um deles com
--     matricula temporaria — assinatura de recadastro por engano.
--   * 10 dos 156 grupos suspeitos tem CPF divergente: 1 por nome, 6 por TELEFONE e 3 por EMAIL
--     (um deles e um endereco compartilhado por 12 pessoas).
--
-- 🚨 E NAO E SO O CPF QUE DIVERGE NAQUELE GRUPO. PIS, data de nascimento (20 anos de
-- diferenca) e NOME DA MAE tambem divergem. Uma tela que dissesse apenas "os CPFs sao
-- diferentes, confirma?" esconderia justamente o que decide. Por isso a peca central desta
-- migration nao e a escotilha — e fn_divergencias_identidade_servidor, que poe a identidade
-- inteira na frente de quem vai declarar.
--
-- O QUE MUDA:
--
--   1. fn_divergencias_identidade_servidor (NOVA) — os campos de identidade que divergem.
--   2. fn_impedimentos_mesclagem_servidor ganha p_confirmar_identidade (DEFAULT false).
--      So o impedimento cpf_divergente e suprimido. Todos os outros continuam.
--   3. fn_mesclar_servidores ganha p_confirmar_identidade (DEFAULT false), exige MOTIVO
--      escrito quando a declaracao e efetiva, e NAO copia campo de pessoa nesse caso.
--
-- O QUE NAO MUDA, e cada um tem motivo medido:
--
--   * DEFAULT false nos dois lados: quem nao declara nada continua barrado, exatamente como
--     antes. O lado seguro e o default (armadilha 41).
--   * a declaracao so tem efeito quando o CPF DE FATO diverge (v_declarada). Nas outras 61
--     mesclagens ela nao autoriza nada e nao muda comportamento nenhum.
--   * sem_cpf (nenhum dos dois tem CPF) continua impedimento DURO. Nao ha caso medido, e sem
--     CPF em lado nenhum nao ha nem o que declarar.
--   * escala_sobreposta, origem/destino ja mesclados, colisao de unicidade: intactos.
--   * quem mescla continua sendo RH Geral ou Administrador Geral (20260911120000).
--   * a TELA so oferece este caminho em grupo de NOME IDENTICO com exatamente 2 cadastros.
--     Telefone e email continuam fechados: sao compartilhados, e ha um email com 12 pessoas.
--
-- ⚠️ BLOCOS GERADOS por scratchpad/gen_mesclagem_declarada.js a partir das versoes VIGENTES
-- (impedimentos: 20260906100000; mesclagem: 20260911120000 — NAO 20260904130000, onde as duas
-- nasceram). Nao editar a mao: o gerador confere 14 invariantes antes e 12 depois, e ABORTA se
-- a contagem divergir. E ele que garante que o GUC da imutabilidade da marcacao, a varredura
-- por pg_index, a fusao de escala antes do laco generico e o "inativa, nunca exclui"
-- atravessaram a copia (armadilha 1).
--
-- ⚠️ ASSINATURA NOVA E OBJETO NOVO (armadilha 41): nasce com EXECUTE para PUBLIC, entao os
-- REVOKE/GRANT sao reescritos aqui; e as assinaturas antigas precisam de DROP, senao duas
-- sobrecargas fazem o PostgREST devolver PGRST203.
-- ============================================================================


-- ============================================================================
-- 0. NORMALIZACAO DE TEXTO DE IDENTIDADE
-- ============================================================================
-- Caixa alta, sem acento, sem espaco duplo. Usada so para COMPARAR — o que a tela exibe e
-- sempre o valor bruto de cada ficha.
--
-- ⚠️ translate() em vez da extensao unaccent de proposito: a extensao pode nao estar instalada
-- e o unico efeito de errar aqui e acusar divergencia a mais num acento. Preso a nao instalar
-- extensao por causa de uma comparacao de nome de mae.
CREATE OR REPLACE FUNCTION public.fn_texto_identidade_normalizado(p_valor text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
    SELECT nullif(
        btrim(regexp_replace(
            translate(upper(COALESCE(p_valor, '')),
                      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                      'AAAAAEEEEIIIIOOOOOUUUUCN'),
            '\s+', ' ', 'g')),
        '')
$fn$;

REVOKE ALL ON FUNCTION public.fn_texto_identidade_normalizado(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_texto_identidade_normalizado(text) TO authenticated, service_role;


-- ============================================================================
-- 1. A IDENTIDADE QUE DIVERGE — a informacao que faltava na tela
-- ============================================================================
-- Devolve uma linha por campo de identidade preenchido NOS DOIS cadastros e diferente entre
-- eles. E leitura pura: nao decide nada, nao bloqueia nada.
--
-- ⚠️ Campo preenchido em UM lado so NAO e divergencia. Ausencia nao sugere pessoa diferente, e
-- listar ausencia junto afogaria o sinal que importa no ruido de ficha incompleta.
--
-- ⚠️ A lista e explicita, como a allowlist de campos de pessoa de fn_mesclar_servidores, e pelo
-- mesmo motivo invertido: aqui, ESQUECER um campo e pior do que ter um a mais — o campo
-- esquecido e uma divergencia que ninguem ve antes de declarar. Coluna nova de identidade
-- entra aqui junto.
DROP FUNCTION IF EXISTS public.fn_divergencias_identidade_servidor(uuid, uuid);

CREATE FUNCTION public.fn_divergencias_identidade_servidor(
    p_origem  uuid,
    p_destino uuid
)
RETURNS TABLE (
    campo         text,
    rotulo        text,
    valor_origem  text,
    valor_destino text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH o AS (SELECT * FROM public.servidores WHERE id = p_origem),
         d AS (SELECT * FROM public.servidores WHERE id = p_destino),
    -- Normalizacao por TIPO de campo: documento vira so digitos (018.123.456-78 e 01812345678
    -- sao o mesmo CPF), nome vira caixa alta sem acento e sem espaco duplo, o resto vira texto
    -- aparado. Sem isto, diferenca de digitacao viraria "identidade divergente" e a tela
    -- gritaria a toa — aviso que grita a toa e o caminho mais curto para ninguem mais ler
    -- nenhum.
    pares AS (
        SELECT * FROM (VALUES
            ('cpf',             'CPF',                 1, public.fn_cpf_normalizado((SELECT cpf FROM o)),             public.fn_cpf_normalizado((SELECT cpf FROM d)),             (SELECT cpf FROM o),             (SELECT cpf FROM d)),
            ('pis_pasep',       'PIS/PASEP',           2, nullif(regexp_replace(COALESCE((SELECT pis_pasep FROM o), ''), '\D', '', 'g'), ''), nullif(regexp_replace(COALESCE((SELECT pis_pasep FROM d), ''), '\D', '', 'g'), ''), (SELECT pis_pasep FROM o), (SELECT pis_pasep FROM d)),
            ('data_nascimento', 'data de nascimento',  3, (SELECT data_nascimento::text FROM o),                      (SELECT data_nascimento::text FROM d),                      (SELECT data_nascimento::text FROM o), (SELECT data_nascimento::text FROM d)),
            ('nome_mae',        'nome da mae',         4, public.fn_texto_identidade_normalizado((SELECT nome_mae FROM o)), public.fn_texto_identidade_normalizado((SELECT nome_mae FROM d)), (SELECT nome_mae FROM o), (SELECT nome_mae FROM d)),
            ('nome_pai',        'nome do pai',         5, public.fn_texto_identidade_normalizado((SELECT nome_pai FROM o)), public.fn_texto_identidade_normalizado((SELECT nome_pai FROM d)), (SELECT nome_pai FROM o), (SELECT nome_pai FROM d)),
            ('sexo',            'sexo',                6, public.fn_texto_identidade_normalizado((SELECT sexo::text FROM o)), public.fn_texto_identidade_normalizado((SELECT sexo::text FROM d)), (SELECT sexo::text FROM o), (SELECT sexo::text FROM d)),
            ('rg_numero',       'RG',                  7, nullif(regexp_replace(COALESCE((SELECT rg_numero FROM o), ''), '\D', '', 'g'), ''), nullif(regexp_replace(COALESCE((SELECT rg_numero FROM d), ''), '\D', '', 'g'), ''), (SELECT rg_numero FROM o), (SELECT rg_numero FROM d))
        ) AS t(campo, rotulo, ordem, norm_o, norm_d, bruto_o, bruto_d)
    )
    SELECT p.campo, p.rotulo, p.bruto_o, p.bruto_d
      FROM pares p
     WHERE p.norm_o IS NOT NULL
       AND p.norm_d IS NOT NULL
       AND p.norm_o <> p.norm_d
     ORDER BY p.ordem
$fn$;

COMMENT ON FUNCTION public.fn_divergencias_identidade_servidor(uuid, uuid) IS
    'Campos de identidade preenchidos nos dois cadastros e diferentes entre si. Leitura pura, para a tela poder mostrar a identidade inteira antes de alguem declarar que sao a mesma pessoa.';

REVOKE ALL ON FUNCTION public.fn_divergencias_identidade_servidor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_divergencias_identidade_servidor(uuid, uuid) TO authenticated, service_role;


-- ============================================================================
-- 2. O QUE IMPEDE A MESCLAGEM — agora com a escotilha declarada
-- ============================================================================
-- ⚠️ BLOCO GERADO (ver cabecalho). Copia da versao vigente (20260906100000) com UMA mudanca de
-- comportamento: o impedimento cpf_divergente passa a respeitar p_confirmar_identidade.
--
-- ⚠️ DROP da assinatura de 2 argumentos: RETURNS TABLE nao aceita CREATE OR REPLACE com lista
-- de colunas diferente (42P13), e deixar as duas vivas daria PGRST203 em qualquer chamada de 2
-- argumentos, que e justamente a que a tela fazia ate agora.
DROP FUNCTION IF EXISTS public.fn_impedimentos_mesclagem_servidor(uuid, uuid);
DROP FUNCTION IF EXISTS public.fn_impedimentos_mesclagem_servidor(uuid, uuid, boolean);

CREATE FUNCTION public.fn_impedimentos_mesclagem_servidor(
    p_origem  uuid,
    p_destino uuid,
    -- Declaracao explicita de que os dois cadastros sao a mesma pessoa APESAR do CPF nao bater.
    -- DEFAULT false de proposito: quem nao passa nada continua recebendo o impedimento, que e'
    -- o comportamento de sempre. O lado seguro e' o default (armadilha 41).
    p_confirmar_identidade boolean DEFAULT false
)
RETURNS TABLE (
    motivo    text,
    detalhe   text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_o       record;
    v_d       record;
    r         record;
    u         record;
    v_outras  text[];
    v_pred    text;
    v_qtd      bigint;
    v_lista    text;
    g          record;
    v_conflito text;
BEGIN
    SELECT s.id, s.nome, s.matricula, s.status, s.mesclado_em_servidor_id,
           public.fn_cpf_normalizado(s.cpf) AS cpf_norm
      INTO v_o
      FROM public.servidores s WHERE s.id = p_origem;

    SELECT s.id, s.nome, s.matricula, s.status, s.mesclado_em_servidor_id,
           public.fn_cpf_normalizado(s.cpf) AS cpf_norm
      INTO v_d
      FROM public.servidores s WHERE s.id = p_destino;

    IF v_o.id IS NULL THEN
        motivo := 'origem_inexistente';
        detalhe := 'O cadastro duplicado nao foi encontrado.';
        RETURN NEXT; RETURN;
    END IF;

    IF v_d.id IS NULL THEN
        motivo := 'destino_inexistente';
        detalhe := 'O cadastro que vai absorver nao foi encontrado.';
        RETURN NEXT; RETURN;
    END IF;

    IF p_origem = p_destino THEN
        motivo := 'destino_igual_origem';
        detalhe := 'Escolha dois cadastros diferentes.';
        RETURN NEXT; RETURN;
    END IF;

    IF v_o.mesclado_em_servidor_id IS NOT NULL THEN
        motivo := 'origem_ja_mesclada';
        detalhe := format('A matricula %s ja foi mesclada em outro cadastro. Nao ha o que mover.',
                          v_o.matricula);
        RETURN NEXT;
    END IF;

    IF v_d.mesclado_em_servidor_id IS NOT NULL THEN
        motivo := 'destino_ja_mesclado';
        detalhe := format('A matricula %s ja foi mesclada em outro cadastro e nao e mais o '
                       || 'cadastro final. Escolha aquele que a absorveu.', v_d.matricula);
        RETURN NEXT;
    END IF;

    -- CPF divergente. Continua sendo impedimento POR PADRAO: e' o dado que diz que os dois
    -- cadastros sao a mesma pessoa, e mesclar pessoas diferentes e' o pior erro que esta
    -- ferramenta comete (o ponto de uma vira ponto da outra, sem desfazer).
    --
    -- O QUE MUDOU EM 11/09/2026: existe caso real em que o CPF errado E' o defeito — cadastro
    -- refeito com o CPF de outra pessoa. Medido em producao: 1 grupo (SAMU-SMS), dois cadastros
    -- criados com 25 min de diferenca no mesmo dia, mesma unidade, mesmo cargo, mesmo telefone.
    -- A saida que o texto antigo mandava seguir era CIRCULAR: gravar na ficha o CPF do outro
    -- cadastro exige marcar "vinculo adicional" em fn_cpf_ja_cadastrado, que e' exatamente a
    -- caixa cujo uso indevido cria a duplicata (armadilha 50). Nao havia caminho nenhum.
    --
    -- A declaracao NAO afrouxa nada alem disto: todos os outros impedimentos continuam, e a tela
    -- mostra a identidade inteira divergente (fn_divergencias_identidade_servidor), nunca so o
    -- CPF — no caso medido, PIS, data de nascimento e nome da mae tambem divergem, e quem so
    -- visse "CPF diferente" decidiria sem o que importa.
    IF v_o.cpf_norm IS NOT NULL AND v_d.cpf_norm IS NOT NULL
       AND v_o.cpf_norm <> v_d.cpf_norm AND NOT COALESCE(p_confirmar_identidade, false) THEN
        motivo := 'cpf_divergente';
        detalhe := 'Os dois cadastros tem CPF diferente. Se for a mesma pessoa com um CPF '
                || 'cadastrado errado, use a mesclagem com identidade declarada; se nao for a '
                || 'mesma pessoa, nao mescle.';
        RETURN NEXT;
    END IF;

    IF v_o.cpf_norm IS NULL AND v_d.cpf_norm IS NULL THEN
        motivo := 'sem_cpf';
        detalhe := 'Nenhum dos dois cadastros tem CPF. Sem CPF nao ha como afirmar que sao a '
                || 'mesma pessoa - preencha o CPF na ficha antes de mesclar.';
        RETURN NEXT;
    END IF;

    -- Sobreposicao de escala. Mesma regra de fn_prevent_cross_sector_shift_overlap
    -- (20260826220000): mesma competencia, mesmo dia, escalas diferentes, slots que se cruzam.
    -- O trigger nao alcanca a mesclagem (ele olha escala_diaria; aqui se move escala_mensal), e
    -- por isso a checagem tem que acontecer antes - senao a mesclagem CRIA o estado que ele
    -- existe para impedir, e a folha passa a contar as mesmas horas duas vezes (armadilha 23).
    SELECT string_agg(DISTINCT format('%s/%s dia %s (%s x %s)',
                                      emo.mes, emo.ano, edo.dia, dto.codigo, dtd.codigo), '; ')
      INTO v_lista
      FROM public.escala_diaria edo
      JOIN public.escala_mensal emo ON emo.id = edo.escala_mensal_id
      JOIN public.dicionario_turnos dto ON dto.id = edo.dicionario_turnos_id
      JOIN public.escala_mensal emd ON emd.servidor_id = p_destino
                                   AND emd.mes = emo.mes AND emd.ano = emo.ano
      JOIN public.escala_diaria edd ON edd.escala_mensal_id = emd.id AND edd.dia = edo.dia
      JOIN public.dicionario_turnos dtd ON dtd.id = edd.dicionario_turnos_id
     WHERE emo.servidor_id = p_origem
       AND dto.slots && dtd.slots;

    IF v_lista IS NOT NULL THEN
        motivo := 'escala_sobreposta';
        detalhe := 'Os dois cadastros estao escalados no mesmo dia e horario: ' || v_lista
                || '. Um servidor nao ocupa dois lugares ao mesmo tempo - apague o lancamento '
                || 'que nao aconteceu na grade antes de mesclar.';
        RETURN NEXT;
    END IF;

    -- Escala do mesmo servidor na MESMA competencia, unidade e setor nos dois cadastros. As
    -- duas linhas de escala_mensal nao cabem numa so (unique mes/ano/servidor/unidade/setor), e
    -- ate 05/09/2026 isso caia na varredura generica de unicidade abaixo, travando a mesclagem
    -- inteira -- inclusive quando os dias eram DISJUNTOS e nada disputava nada.
    --
    -- A mesclagem passa a FUNDIR as duas escalas movendo os dias (secao 6.0 de
    -- fn_mesclar_servidores). O que continua recusado e o dia que os dois cadastros disputam:
    -- ficar com um turno e descartar o outro e decisao de quem escala, nunca da ferramenta.
    FOR g IN
        SELECT emo.id AS origem_id, emd.id AS destino_id, emo.mes, emo.ano,
               emo.status AS status_o, emd.status AS status_d,
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
        -- O dia que existe nos DOIS lados, com a mesma categoria: e ele que nao tem para onde
        -- ir (escala_diaria e unica por escala_mensal_id + dia + categoria). O turno de cada
        -- lado vai na mensagem porque e a informacao que decide o que apagar na grade -- a
        -- recusa anterior nao dizia nem em que dia olhar.
        SELECT string_agg(format('dia %s (%s: %s x %s: %s)',
                                 edo.dia,
                                 v_o.matricula, COALESCE(dto.codigo, '?'),
                                 v_d.matricula, COALESCE(dtd.codigo, '?')),
                          ', ' ORDER BY edo.dia)
          INTO v_conflito
          FROM public.escala_diaria edo
          JOIN public.escala_diaria edd
            ON edd.escala_mensal_id = g.destino_id
           AND edd.dia = edo.dia
           AND edd.categoria = edo.categoria
          LEFT JOIN public.dicionario_turnos dto ON dto.id = edo.dicionario_turnos_id
          LEFT JOIN public.dicionario_turnos dtd ON dtd.id = edd.dicionario_turnos_id
         WHERE edo.escala_mensal_id = g.origem_id;

        IF v_conflito IS NOT NULL THEN
            motivo := 'escala_em_conflito';
            detalhe := format(
                'Os dois cadastros estao escalados no mesmo dia em %s (%s/%s): %s. '
             || 'Os dois turnos nao cabem na mesma linha da folha - abra a grade, apague na '
             || 'competencia o lancamento que nao aconteceu, e volte aqui.',
                g.setor, lpad(g.mes::text, 2, '0'), g.ano, v_conflito);
            RETURN NEXT;
        END IF;

        -- Mes fechado nao se funde: mesma regra de fn_validar_destino_escala (20260903120000).
        -- A porta e reabrir a competencia, que ja e ato registrado.
        IF public.fn_competencia_encerrada(g.mes, g.ano) THEN
            motivo := 'competencia_encerrada';
            detalhe := format(
                'A competencia %s/%s esta encerrada e os dois cadastros tem escala em %s. '
             || 'Reabra a competencia em Configuracoes antes de mesclar.',
                lpad(g.mes::text, 2, '0'), g.ano, g.setor);
            RETURN NEXT;
        END IF;

        IF g.status_o = 'Fechada' OR g.status_d = 'Fechada' THEN
            motivo := 'escala_fechada';
            detalhe := format(
                'A escala de %s/%s em %s esta Fechada em um dos cadastros. Reabra a escala '
             || 'antes de mesclar.', lpad(g.mes::text, 2, '0'), g.ano, g.setor);
            RETURN NEXT;
        END IF;

        -- A folha aponta para a escala_mensal (unique_escala_mensal_id) e a escala do cadastro
        -- duplicado deixa de existir na fusao. Reapontar a folha esbarraria na folha que o
        -- destino ja tem na mesma competencia (unique_servidor_mes_ano), e juntar dois
        -- documentos de folha nao e mesclagem de cadastro - e outra decisao, com outra tela.
        IF EXISTS (SELECT 1 FROM public.folha_ponto f WHERE f.escala_mensal_id = g.origem_id) THEN
            motivo := 'folha_na_escala_fundida';
            detalhe := format(
                'O cadastro duplicado ja tem folha de ponto de %s/%s em %s, e essa escala '
             || 'precisa ser fundida com a do cadastro que fica. Apague a folha em Rascunho do '
             || 'cadastro duplicado (ela e regerada no cadastro correto) antes de mesclar.',
                lpad(g.mes::text, 2, '0'), g.ano, g.setor);
            RETURN NEXT;
        END IF;
    END LOOP;

    -- Colisao de unicidade em qualquer tabela que aponte para servidores. A varredura e por
    -- pg_INDEX (e nao pg_constraint) para alcancar tambem indice unico PARCIAL - ver o cabecalho.
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
        FOR u IN
            SELECT i.indexrelid::regclass::text AS idx,
                   i.indpred IS NOT NULL AS parcial,
                   COALESCE(pg_get_expr(i.indpred, i.indrelid), 'true') AS pred_idx,
                   (SELECT array_agg(a.attname::text ORDER BY k.ord)
                      FROM unnest((string_to_array(i.indkey::text, ' '))[1:i.indnkeyatts]::int2[])
                           WITH ORDINALITY AS k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                   ) AS cols
              FROM pg_index i
             WHERE i.indrelid = r.oid
               AND i.indisunique
               AND i.indexprs IS NULL          -- indice sobre expressao nao da para comparar
        LOOP
            CONTINUE WHEN u.cols IS NULL OR NOT (r.col = ANY (u.cols));

            v_outras := array_remove(u.cols, r.col);

            IF v_outras IS NULL OR array_length(v_outras, 1) IS NULL THEN
                -- A unicidade e a propria coluna do servidor: qualquer linha no destino colide.
                v_pred := 'true';
            ELSE
                SELECT string_agg(format('d.%I IS NOT DISTINCT FROM o.%I', k, k), ' AND ')
                  INTO v_pred
                  FROM unnest(v_outras) AS k;
            END IF;

            -- O predicado do indice PARCIAL entra na conta: sem ele, dois cadastros com uma
            -- solicitacao ja decidida seriam lidos como colisao e a mesclagem travaria a toa.
            -- Cada lado numa subconsulta propria para as colunas nuas do predicado resolverem
            -- no escopo mais interno, sem ambiguidade entre o e d.
            EXECUTE format(
                'SELECT count(*) FROM (SELECT * FROM %s WHERE %s) o WHERE o.%I = $1 '
                'AND EXISTS (SELECT 1 FROM (SELECT * FROM %s WHERE %s) d '
                            'WHERE d.%I = $2 AND %s)',
                r.rel, u.pred_idx, r.col, r.rel, u.pred_idx, r.col, v_pred
            ) INTO v_qtd USING p_origem, p_destino;

            -- Configuracao do REP que e o proprio par (servidor + equipamento): a duplicata nao
            -- carrega historico nenhum, e descartada pela mesclagem e nao impede - ver secao 6.
            IF v_qtd > 0
               AND r.rel NOT IN ('rep_excecoes_ponto', 'public.rep_excecoes_ponto',
                                 'rep_administradores_parque', 'public.rep_administradores_parque',
                                 'rep_cadastros_fila', 'public.rep_cadastros_fila',
                                 -- escala_mensal tem tratamento proprio no laco acima, que diz
                                 -- QUAL dia esta em disputa. Deixa-la aqui produziria duas
                                 -- linhas para o mesmo problema, uma delas ilegivel.
                                 'escala_mensal', 'public.escala_mensal')
            THEN
                motivo := 'colisao_unicidade';
                detalhe := format(
                    '%s: %s registro(s) do cadastro duplicado ja existem no cadastro que vai '
                    || 'absorver (%s%s). Mover criaria duplicidade - resolva esses registros '
                    || 'antes.',
                    r.rel, v_qtd, u.idx,
                    CASE WHEN u.parcial THEN ', indice parcial' ELSE '' END);
                RETURN NEXT;
            END IF;
        END LOOP;
    END LOOP;
END;
$fn$;

COMMENT ON FUNCTION public.fn_impedimentos_mesclagem_servidor(uuid, uuid, boolean) IS
    'O que impede mesclar este par. Com p_confirmar_identidade, o impedimento por CPF divergente da lugar a uma declaracao explicita de quem mescla; todos os demais continuam.';

REVOKE ALL ON FUNCTION public.fn_impedimentos_mesclagem_servidor(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_impedimentos_mesclagem_servidor(uuid, uuid, boolean) TO authenticated, service_role;


-- ============================================================================
-- 3. MESCLAR — com declaracao de identidade, motivo obrigatorio e sem copiar ficha
-- ============================================================================
-- ⚠️ BLOCO GERADO (ver cabecalho). Copia da versao vigente (20260911120000).
--
-- ⚠️ DROP da assinatura de 3 argumentos pelo mesmo motivo do bloco anterior: com as duas vivas,
-- a chamada de 3 argumentos que a tela faz hoje viraria PGRST203.
DROP FUNCTION IF EXISTS public.fn_mesclar_servidores(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.fn_mesclar_servidores(uuid, uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.fn_mesclar_servidores(
    p_origem  uuid,
    p_destino uuid,
    p_motivo  text DEFAULT NULL,
    -- "Sao a mesma pessoa, apesar do CPF nao bater." DEFAULT false: quem nao declara nada
    -- continua barrado, como sempre foi.
    p_confirmar_identidade boolean DEFAULT false
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
    -- Declaracao EFETIVA: o chamador pediu E o CPF de fato diverge. Sem esta conjuncao,
    -- p_confirmar_identidade viraria uma chave que muda o comportamento de toda mesclagem —
    -- inclusive as normais, onde ela nao tem nada a autorizar.
    v_declarada   boolean := false;
    v_divergentes text[] := ARRAY[]::text[];
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

    -- A identidade inteira que diverge entre os dois cadastros (CPF, PIS, nascimento, nome da
    -- mae...). Calculada SEMPRE: e' o que vai para o log do ato e para o relato da tela.
    SELECT COALESCE(array_agg(dv.rotulo ORDER BY dv.campo), ARRAY[]::text[])
      INTO v_divergentes
      FROM public.fn_divergencias_identidade_servidor(p_origem, p_destino) dv;

    v_declarada := COALESCE(p_confirmar_identidade, false)
                   AND v_o.cpf_norm IS NOT NULL AND v_d.cpf_norm IS NOT NULL
                   AND v_o.cpf_norm <> v_d.cpf_norm;

    -- Motivo OBRIGATORIO aqui, opcional no resto. Nas outras mesclagens o CPF igual e' a prova;
    -- nesta, a unica prova que vai existir e' o que a pessoa escreveu. Sem texto, o log
    -- registraria que alguem juntou dois cadastros de identidade diferente e mais nada.
    --
    -- ⚠️ RAISE exige LITERAL, nao expressao: 'texto ' || 'mais texto' da 42601 aqui (e so na
    -- execucao do CREATE, nunca no build). Por isso a mensagem vai numa linha so.
    IF v_declarada AND length(btrim(regexp_replace(COALESCE(p_motivo, ''), '\s+', ' ', 'g'))) < 10 THEN
        RAISE EXCEPTION 'Mesclagem com CPF diferente exige o motivo escrito (ao menos 10 caracteres): diga por que os dois cadastros sao a mesma pessoa.'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Todos os impedimentos de uma vez: quem esta na tela precisa ver a lista inteira, nao
    -- descobrir um por vez a cada tentativa.
    SELECT string_agg(imp.detalhe, ' | ')
      INTO v_impedimento
      FROM public.fn_impedimentos_mesclagem_servidor(p_origem, p_destino, p_confirmar_identidade) imp;

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
    -- COM IDENTIDADE DECLARADA, NAO COMPLETA NADA. Nas mesclagens normais o CPF igual prova que
    -- os dois cadastros descrevem a mesma pessoa, e completar um campo vazio do que fica e' ganho
    -- puro. Aqui nao ha essa prova: no caso que motivou, o cadastro duplicado trazia PIS, data de
    -- nascimento e nome da mae de OUTRA pessoa. Copiar isso para a ficha que fica contaminaria o
    -- cadastro correto com dado de terceiro — e em silencio, porque so alcanca campo VAZIO, que
    -- e' justamente onde ninguem olha. Mover vinculo e inativar o duplicado e' tudo que esta
    -- operacao precisa fazer.
    FOREACH v_campo IN ARRAY (CASE WHEN v_declarada THEN ARRAY[]::text[] ELSE c_campos_pessoa END) LOOP
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
               format('Cadastro duplicado - mesclado na matricula %s.%s%s',
                      v_d.matricula,
                      CASE WHEN v_declarada
                           THEN format(' Identidade declarada pelo responsavel apesar de '
                                    || 'divergencia em: %s.', array_to_string(v_divergentes, ', '))
                           ELSE '' END,
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
        'vinculo_multiplo_reavaliado', v_restantes = 0,
        'identidade_declarada', v_declarada,
        'identidade_divergente', to_jsonb(v_divergentes)
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
        'identidade_declarada', v_declarada,
        'identidade_divergente', to_jsonb(v_divergentes),
        'message', format('Cadastro %s mesclado na matricula %s.', v_o.matricula, v_d.matricula));
END;
$fn$;

COMMENT ON FUNCTION public.fn_mesclar_servidores(uuid, uuid, text, boolean) IS
    'Move todo vinculo do cadastro duplicado para o que fica e inativa o duplicado. Com p_confirmar_identidade e CPF divergente: exige motivo escrito e NAO copia campo de pessoa, porque a ficha duplicada pode trazer dado de terceiro.';

REVOKE ALL ON FUNCTION public.fn_mesclar_servidores(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mesclar_servidores(uuid, uuid, text, boolean) TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA — EXECUTA as funcoes, nos DOIS sentidos
-- ============================================================================
-- ⚠️ Conferir que a funcao EXISTE nao serve (armadilha 42): a que quebrou em producao existia.
-- Aqui a conferencia CHAMA cada funcao e confere o resultado.
--
-- Os dois sentidos em cada caso. Afrouxar so um lado e o que transforma "liberar o caso real"
-- em "liberar mesclagem de pessoas diferentes":
--   * sem declaracao, o par com CPF divergente CONTINUA impedido;
--   * com declaracao, ele passa — e nenhum outro impedimento sumiu junto.
--
-- ⚠️ A chamada de fn_mesclar_servidores e feita com motivo CURTO, que tem que falhar ANTES de
-- qualquer escrita. Se ela NAO falhar, a conferencia levanta excecao e a transacao inteira da
-- migration volta atras — inclusive a mesclagem que teria acontecido.
DO $conf$
DECLARE
    v_o        uuid;
    v_d        uuid;
    v_n        integer;
    v_tem_cpf  boolean;
    v_msg      text;
BEGIN
    -- Um par real com CPF divergente e nome identico. Se nao houver nenhum, a conferencia de
    -- comportamento e pulada (base limpa e resultado valido, nao motivo para abortar).
    SELECT a.id, b.id INTO v_o, v_d
      FROM public.servidores a
      JOIN public.servidores b
        ON public.fn_texto_identidade_normalizado(a.nome) = public.fn_texto_identidade_normalizado(b.nome)
       AND a.id < b.id
     WHERE a.status = 'Ativo' AND b.status = 'Ativo'
       AND a.mesclado_em_servidor_id IS NULL AND b.mesclado_em_servidor_id IS NULL
       AND public.fn_cpf_normalizado(a.cpf) IS NOT NULL
       AND public.fn_cpf_normalizado(b.cpf) IS NOT NULL
       AND public.fn_cpf_normalizado(a.cpf) <> public.fn_cpf_normalizado(b.cpf)
     LIMIT 1;

    IF v_o IS NULL THEN
        RAISE NOTICE $$CONFERENCIA DE COMPORTAMENTO PULADA: nenhum par ativo com nome identico e CPF divergente.$$;
    ELSE
        -- 1) a divergencia de identidade e ENCONTRADA, e o CPF esta nela
        SELECT count(*), bool_or(campo = $$cpf$$)
          INTO v_n, v_tem_cpf
          FROM public.fn_divergencias_identidade_servidor(v_o, v_d);
        IF v_n = 0 OR NOT v_tem_cpf THEN
            RAISE EXCEPTION $$FALHOU: fn_divergencias_identidade_servidor devolveu % linha(s), cpf presente=%$$, v_n, v_tem_cpf;
        END IF;
        RAISE NOTICE $$ok: identidade divergente em % campo(s), CPF entre eles.$$, v_n;

        -- 2) SEM declaracao, o impedimento por CPF continua (o sentido que protege)
        SELECT count(*) INTO v_n
          FROM public.fn_impedimentos_mesclagem_servidor(v_o, v_d)
         WHERE motivo = $$cpf_divergente$$;
        IF v_n <> 1 THEN
            RAISE EXCEPTION $$FALHOU: sem declaracao, cpf_divergente deveria aparecer 1 vez, apareceu %.$$, v_n;
        END IF;

        -- 2b) o default sozinho basta: chamada de 2 argumentos continua barrando
        SELECT count(*) INTO v_n
          FROM public.fn_impedimentos_mesclagem_servidor(v_o, v_d, false)
         WHERE motivo = $$cpf_divergente$$;
        IF v_n <> 1 THEN
            RAISE EXCEPTION $$FALHOU: com p_confirmar_identidade=false, cpf_divergente sumiu.$$;
        END IF;
        RAISE NOTICE $$ok: sem declaracao o par continua impedido.$$;

        -- 3) COM declaracao, o cpf_divergente sai — e SO ele
        SELECT count(*) INTO v_n
          FROM public.fn_impedimentos_mesclagem_servidor(v_o, v_d, true)
         WHERE motivo = $$cpf_divergente$$;
        IF v_n <> 0 THEN
            RAISE EXCEPTION $$FALHOU: com declaracao, cpf_divergente ainda aparece.$$;
        END IF;
        RAISE NOTICE $$ok: com declaracao o par passa.$$;

        -- 4) declarar SEM motivo escrito nao mescla nada
        BEGIN
            PERFORM public.fn_mesclar_servidores(v_o, v_d, $$erro$$, true);
            RAISE EXCEPTION $$FALHOU: mesclagem declarada passou com motivo de 4 caracteres.$$;
        EXCEPTION
            WHEN check_violation THEN
                GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
                IF v_msg NOT LIKE $$%motivo escrito%$$ THEN
                    RAISE EXCEPTION $$FALHOU: recusou por outro motivo: %$$, v_msg;
                END IF;
                RAISE NOTICE $$ok: declaracao sem motivo escrito e recusada.$$;
        END;
    END IF;

    -- 5) as assinaturas antigas nao podem ter sobrado (PGRST203)
    SELECT count(*) INTO v_n FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_mesclar_servidores';
    IF v_n <> 1 THEN
        RAISE EXCEPTION $$FALHOU: fn_mesclar_servidores tem % sobrecarga(s); o PostgREST devolveria PGRST203.$$, v_n;
    END IF;
    SELECT count(*) INTO v_n FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_impedimentos_mesclagem_servidor';
    IF v_n <> 1 THEN
        RAISE EXCEPTION $$FALHOU: fn_impedimentos_mesclagem_servidor tem % sobrecarga(s).$$, v_n;
    END IF;
    RAISE NOTICE $$ok: uma assinatura de cada, sem ambiguidade.$$;

    -- 6) anon nao executa nenhuma das quatro
    SELECT count(*) INTO v_n FROM (VALUES
        ('public.fn_divergencias_identidade_servidor(uuid, uuid)'),
        ('public.fn_texto_identidade_normalizado(text)'),
        ('public.fn_impedimentos_mesclagem_servidor(uuid, uuid, boolean)'),
        ('public.fn_mesclar_servidores(uuid, uuid, text, boolean)')
    ) AS f(assinatura)
     WHERE has_function_privilege('anon', f.assinatura, 'EXECUTE');
    IF v_n <> 0 THEN
        RAISE EXCEPTION $$FALHOU: % funcao(oes) continuam executaveis por anon.$$, v_n;
    END IF;

    -- 7) e authenticated continua executando as tres que a tela usa (revogar demais derruba a
    --    tela com a mesma discricao — a licao da 20260827050000)
    SELECT count(*) INTO v_n FROM (VALUES
        ('public.fn_divergencias_identidade_servidor(uuid, uuid)'),
        ('public.fn_impedimentos_mesclagem_servidor(uuid, uuid, boolean)'),
        ('public.fn_mesclar_servidores(uuid, uuid, text, boolean)')
    ) AS f(assinatura)
     WHERE has_function_privilege('authenticated', f.assinatura, 'EXECUTE');
    IF v_n <> 3 THEN
        RAISE EXCEPTION $$FALHOU: authenticated perdeu acesso (% de 3).$$, v_n;
    END IF;
    RAISE NOTICE $$ok: anon fora, authenticated dentro.$$;

    RAISE NOTICE $$CONFERENCIA OK.$$;
END;
$conf$;
