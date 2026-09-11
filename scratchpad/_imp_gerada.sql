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