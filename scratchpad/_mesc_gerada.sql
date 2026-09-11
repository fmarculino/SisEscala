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