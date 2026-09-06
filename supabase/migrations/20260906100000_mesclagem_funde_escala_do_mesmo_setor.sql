-- ============================================================================
-- MESCLAGEM DE CADASTRO: FUNDIR A ESCALA DO MESMO SETOR EM VEZ DE TRAVAR
-- ============================================================================
-- 06/09/2026
--
-- POR QUE
--   fn_mesclar_servidores (20260904130000) move TODO vinculo do cadastro duplicado para o
--   cadastro que fica -- inclusive escala. Mas quando os DOIS cadastros tem escala na mesma
--   competencia, unidade e setor, o UPDATE escala_mensal SET servidor_id do laco generico
--   esbarraria na unique (mes, ano, servidor_id, unidade_id, setor_id); a colisao era detectada
--   antes e a mesclagem recusada por inteiro.
--
--   Medido em producao em 05/09/2026, nos 16 grupos de CPF duplicado: 5 travavam ai. E o
--   travamento nao distinguia dois casos muito diferentes --
--
--     a) as duas escalas cobrem dias DIFERENTES do mesmo mes. Nada disputa nada: e uma escala
--        so, lancada metade sob cada matricula. ELIETE MATOS DIAS (CPF 25896334249) tem 26
--        dias num cadastro e 20 no outro, em 9 e 10/2026, sem UM dia em comum -- e a mesclagem
--        recusava;
--     b) as duas escalas disputam o mesmo dia com turnos diferentes (MT num cadastro, N no
--        outro, categoria Regular -- 4 dos 5 casos). Ai nao ha o que migrar: um dos dois
--        lancamentos nao aconteceu, e escolher qual e decisao de quem escala.
--
--   Esta migration separa os dois: (a) passa a FUNDIR, (b) continua recusando -- agora dizendo
--   setor, competencia, dia e o turno de cada lado, em vez de "escala_mensal: 2 registro(s)
--   ... resolva esses registros antes", que nao dizia nem onde olhar (armadilha 44 do
--   CLAUDE.md: apontar o problema sem dar a saida).
--
-- COMO A FUSAO FUNCIONA
--   escala_diaria NAO tem servidor_id -- herda de escala_mensal (armadilha 47). Entao fundir e
--   repontar escala_diaria.escala_mensal_id para a escala do cadastro que fica e apagar a
--   escala_mensal que ficou vazia. Nada e fabricado e nada e apagado: a presenca ja gravada
--   viaja na propria linha do dia.
--
-- O QUE CONTINUA RECUSADO (e por que nao deve deixar de ser)
--   1. (dia, categoria) presente nos DOIS lados - escala_diaria e unica por (escala_mensal_id,
--      dia, categoria); medido em 05/09/2026 sobre as 35.566 linhas: zero violacoes dessa
--      tripla, e 2.083 pares (escala, dia) com mais de uma linha, sempre de categorias
--      diferentes. Ficar com um turno e descartar o outro seria a ferramenta decidindo escala;
--   2. competencia encerrada ou escala Fechada - mesma regra de fn_validar_destino_escala
--      (20260903120000): a porta e reabrir, que ja e ato registrado;
--   3. folha_ponto presa a escala que vai sair - folha_ponto.escala_mensal_id e unico, e o
--      destino tem (ou tera) a folha dele na mesma competencia (unique_servidor_mes_ano).
--      Juntar dois documentos de folha nao e mesclagem de cadastro.
--
-- POR QUE O CADASTRO DUPLICADO CONTINUA SENDO INATIVADO, E NAO EXCLUIDO
--   A pergunta voltou em 06/09/2026 e a resposta nao mudou: a linha errada carrega uma
--   MATRICULA que ja pode ter sido impressa em folha, escala e relatorio. O dado migra; o
--   NUMERO impresso continua no papel, e sem a linha ele fica sem explicacao possivel. O
--   cadastro perdedor fica Inativo apontando para quem o absorveu (mesclado_em_servidor_id) e
--   ja sai das checagens de CPF desde 20260904140000 - nao atrapalha cadastro novo nem
--   duplicidade futura.
--
-- GERADA POR SCRIPT
--   scratchpad/gen_fusao_escala_mesclagem.js copia as duas funcoes da versao VIGENTE
--   (20260904130000) e aplica substituicoes pontuais, abortando se a contagem divergir. Nao
--   editar este arquivo a mao (armadilha 1 do CLAUDE.md).
--
-- IDEMPOTENTE
--   DROP FUNCTION IF EXISTS antes do CREATE onde o retorno e TABLE (CREATE OR REPLACE nao
--   altera a lista de colunas de saida - 42P13), CREATE OR REPLACE no resto.
-- ============================================================================


-- ============================================================================
-- 1. O QUE IMPEDE A MESCLAGEM
-- ============================================================================
-- Copia integral de 20260904130000 MAIS o tratamento proprio da escala do mesmo setor. Os
-- impedimentos que ja existiam TEM que continuar: CPF divergente e o unico dado que diz que os
-- dois cadastros sao a mesma pessoa, e escala_sobreposta e a armadilha 23 aplicada antes de
-- criar o estado que o trigger existe para impedir.
DROP FUNCTION IF EXISTS public.fn_impedimentos_mesclagem_servidor(uuid, uuid);

CREATE FUNCTION public.fn_impedimentos_mesclagem_servidor(
    p_origem  uuid,
    p_destino uuid
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

    -- CPF divergente: e o unico dado que diz que sao a MESMA pessoa. Sem ele nao ha mesclagem que
    -- se possa desfazer depois - o ponto de uma teria virado ponto da outra.
    IF v_o.cpf_norm IS NOT NULL AND v_d.cpf_norm IS NOT NULL
       AND v_o.cpf_norm <> v_d.cpf_norm THEN
        motivo := 'cpf_divergente';
        detalhe := 'Os dois cadastros tem CPF diferente. Se for a mesma pessoa, corrija o CPF '
                || 'errado na ficha antes de mesclar; se nao for, nao mescle.';
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

COMMENT ON FUNCTION public.fn_impedimentos_mesclagem_servidor(uuid, uuid) IS
    'O que impede mesclar p_origem (cadastro duplicado) em p_destino (cadastro que absorve): CPF '
    'divergente, ausencia de CPF nos dois, cadastro ja mesclado, escala sobreposta no mesmo dia e '
    'colisao de unicidade. Vazio = pode mesclar.';

REVOKE ALL ON FUNCTION public.fn_impedimentos_mesclagem_servidor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_impedimentos_mesclagem_servidor(uuid, uuid) TO authenticated, service_role;

-- ============================================================================
-- 2. A MESCLAGEM
-- ============================================================================
-- Copia integral de 20260904130000 MAIS a secao 6.0 (fusao da escala do mesmo setor).
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
    IF (SELECT public.get_my_role()) <> 'super_admin'::public.user_role THEN
        RAISE EXCEPTION 'Apenas o Administrador Geral pode mesclar cadastros de servidor.'
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

COMMENT ON FUNCTION public.fn_mesclar_servidores(uuid, uuid, text) IS
    'Move TODO vinculo do cadastro duplicado (p_origem) para o cadastro que fica (p_destino) - '
    'varredura dinamica de pg_constraint -, completa no destino apenas os campos de pessoa que '
    'estavam vazios, e INATIVA a origem apontando para o destino (mesclado_em_servidor_id). Nao '
    'exclui: a matricula pode ter sido impressa em folha e escala. So super_admin. Recusa em '
    'bloco quando ha impedimento (fn_impedimentos_mesclagem_servidor). Registra em logs_sistema.';

REVOKE ALL ON FUNCTION public.fn_mesclar_servidores(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mesclar_servidores(uuid, uuid, text) TO authenticated, service_role;

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) Os grupos que travavam so por escala do mesmo setor passam a nao ter impedimento
--      nenhum. Em 05/09/2026, ELIETE MATOS DIAS (CPF 25896334249) era o unico:
--
--   SELECT * FROM public.fn_impedimentos_mesclagem_servidor(
--       (SELECT id FROM public.servidores WHERE matricula = '67766'),
--       (SELECT id FROM public.servidores WHERE matricula = '1009'));
--   -- esperado: nenhuma linha
--
--   2) ...e os que disputam o mesmo dia continuam recusados, agora nomeando dia e turno de
--      cada lado (esperado: escala_em_conflito, com "dia 1 (68316: MT x 33568: N)"):
--
--   SELECT * FROM public.fn_impedimentos_mesclagem_servidor(
--       (SELECT id FROM public.servidores WHERE matricula = '68316'),
--       (SELECT id FROM public.servidores WHERE matricula = '33568'));
--
--   3) Nenhuma escala_mensal orfa de servidor e nenhuma escala_diaria apontando para
--      escala_mensal inexistente (esperado: 0 e 0):
--
--   SELECT count(*) FROM public.escala_mensal em
--    WHERE NOT EXISTS (SELECT 1 FROM public.servidores s WHERE s.id = em.servidor_id);
--   SELECT count(*) FROM public.escala_diaria ed
--    WHERE NOT EXISTS (SELECT 1 FROM public.escala_mensal em WHERE em.id = ed.escala_mensal_id);
--
--   4) A tripla que a fusao nao pode violar (esperado: nenhuma linha):
--
--   SELECT escala_mensal_id, dia, categoria, count(*)
--     FROM public.escala_diaria GROUP BY 1,2,3 HAVING count(*) > 1;
