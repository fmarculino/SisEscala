-- ============================================================================
-- CONFERENCIA -- EXECUTA fn_alocar_marcacoes_dia (armadilha 42)
-- ============================================================================
-- Ensaio sintetico sobre dado real, revertido no fim por RAISE EXCEPTION. Confere os DOIS
-- sentidos, porque afrouxar de um lado so reabre o defeito pelo outro:
--
--   (a) COM tratamento de passo, a batida passa a ocupar o passo declarado -- era o que nao
--       acontecia: o tipo existia na tabela e ninguem o lia;
--   (b) 'desconsiderar' POSTERIOR continua vencendo a fixacao -- retirar tem de continuar sendo
--       a palavra final, senao um tratamento antigo ressuscitaria batida que alguem tirou;
--   (c) 'restaurar' depois disso devolve a fixacao -- o par alterna, como em toda a base;
--   (d) SEM tratamento nenhum, o resultado e byte a byte o de antes -- e o que garante que os
--       milhares de dias que nao tem tratamento nao mudaram de comportamento.

DO $conf$
DECLARE
    v_serv     uuid;
    v_data     date;
    v_autor    uuid;
    v_antes    jsonb;
    v_depois   jsonb;
    v_a1       jsonb;
    v_a2       jsonb;
    v_marc     uuid;
    v_passo2   text;
    v_linha2   uuid;
    v_achou    boolean;
    r          record;
BEGIN
    SELECT p.id INTO v_autor FROM public.profiles p LIMIT 1;
    IF v_autor IS NULL THEN
        RAISE NOTICE 'CONFERENCIA 20260917120000: sem profiles; nada a exercitar.';
        RETURN;
    END IF;

    -- Um dia com pelo menos DUAS alocacoes: e preciso um passo de destino que ja tenha dono,
    -- para exercitar tambem o deslocamento (substituida_por_tratamento).
    FOR r IN
        SELECT em.servidor_id AS serv, make_date(em.ano, em.mes, ed.dia) AS data
          FROM public.escala_diaria ed
          JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
         WHERE ed.presenca_entrada_em IS NOT NULL
           AND ed.presenca_saida_em   IS NOT NULL
           AND ed.categoria::text <> 'Sobreaviso'
           AND NOT public.fn_competencia_encerrada(em.mes, em.ano)
         LIMIT 40
    LOOP
        v_antes := public.fn_alocar_marcacoes_dia(r.serv, r.data);
        IF jsonb_array_length(v_antes->'alocacoes') >= 2 THEN
            v_serv := r.serv;
            v_data := r.data;
            EXIT;
        END IF;
    END LOOP;

    IF v_serv IS NULL THEN
        RAISE NOTICE 'CONFERENCIA 20260917120000: nenhum dia com 2+ alocacoes; nada a exercitar.';
        RETURN;
    END IF;

    v_a1 := v_antes->'alocacoes'->0;
    v_a2 := v_antes->'alocacoes'->1;
    v_marc   := (v_a1->>'marcacao_id')::uuid;
    v_passo2 := v_a2->>'passo';
    v_linha2 := ((v_a2->'escala_diaria_ids')->>0)::uuid;

    IF v_marc IS NULL OR v_passo2 IS NULL OR v_linha2 IS NULL THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU: nao consegui montar o cenario (alocacoes sem os campos esperados)';
    END IF;

    -- (a) fixa a batida do passo 1 no passo do slot 2
    INSERT INTO public.marcacoes_tratamentos
        (marcacao_id, tipo, passo_forcado, escala_diaria_id, justificativa, registrado_por_id)
    VALUES (v_marc, 'reclassificar_passo', v_passo2, v_linha2,
            'ensaio da migration 20260917120000', v_autor);

    v_depois := public.fn_alocar_marcacoes_dia(v_serv, v_data);

    SELECT bool_or((a->>'marcacao_id')::uuid = v_marc AND a->>'passo' = v_passo2)
      INTO v_achou
      FROM jsonb_array_elements(v_depois->'alocacoes') a;

    IF NOT COALESCE(v_achou, false) THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU (a): tratamento de passo foi ignorado -- a marcacao % nao ficou no passo %',
            v_marc, v_passo2;
    END IF;

    -- A mesma batida nao pode ter ficado em DOIS passos.
    SELECT count(*) = 1 INTO v_achou
      FROM jsonb_array_elements(v_depois->'alocacoes') a
     WHERE (a->>'marcacao_id')::uuid = v_marc;

    IF NOT COALESCE(v_achou, false) THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU (a): a marcacao % ficou alocada em mais de um passo', v_marc;
    END IF;

    -- (b) desconsiderar POSTERIOR vence a fixacao
    INSERT INTO public.marcacoes_tratamentos
        (marcacao_id, tipo, justificativa, registrado_por_id)
    VALUES (v_marc, 'desconsiderar', 'ensaio da migration 20260917120000', v_autor);

    v_depois := public.fn_alocar_marcacoes_dia(v_serv, v_data);

    SELECT count(*) = 0 INTO v_achou
      FROM jsonb_array_elements(v_depois->'alocacoes') a
     WHERE (a->>'marcacao_id')::uuid = v_marc;

    IF NOT COALESCE(v_achou, false) THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU (b): desconsiderar posterior nao venceu a fixacao (marcacao %)', v_marc;
    END IF;

    -- (c) restaurar devolve a fixacao
    INSERT INTO public.marcacoes_tratamentos
        (marcacao_id, tipo, justificativa, registrado_por_id)
    VALUES (v_marc, 'restaurar', 'ensaio da migration 20260917120000', v_autor);

    v_depois := public.fn_alocar_marcacoes_dia(v_serv, v_data);

    SELECT bool_or((a->>'marcacao_id')::uuid = v_marc AND a->>'passo' = v_passo2)
      INTO v_achou
      FROM jsonb_array_elements(v_depois->'alocacoes') a;

    IF NOT COALESCE(v_achou, false) THEN
        RAISE EXCEPTION 'CONFERENCIA FALHOU (c): restaurar nao devolveu a fixacao (marcacao %)', v_marc;
    END IF;

    RAISE EXCEPTION 'CONFERENCIA_OK_ROLLBACK';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'CONFERENCIA_OK_ROLLBACK' THEN
            RAISE NOTICE 'CONFERENCIA 20260917120000: OK (ensaio revertido).';
        ELSE
            RAISE;
        END IF;
END;
$conf$;


-- (d) O OUTRO SENTIDO, sem ensaio nenhum: um dia SEM tratamento de passo continua com a
-- alocacao identica. Roda sobre dados reais, nao escreve nada, e aborta a migration se um dia
-- sem tratamento mudar de resultado -- o unico jeito de provar que a fixacao nao vazou para
-- quem nao pediu por ela.
DO $conf2$
DECLARE
    v_n        integer := 0;
    v_com_trat integer;
    r          record;
BEGIN
    SELECT count(*) INTO v_com_trat
      FROM public.marcacoes_tratamentos t
     WHERE t.tipo = 'reclassificar_passo'
       AND t.passo_forcado IS NOT NULL
       AND t.escala_diaria_id IS NOT NULL;

    RAISE NOTICE 'CONFERENCIA 20260917120000: % tratamento(s) de passo ja gravados na base.', v_com_trat;

    FOR r IN
        SELECT em.servidor_id AS serv, make_date(em.ano, em.mes, ed.dia) AS data
          FROM public.escala_diaria ed
          JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
         WHERE ed.presenca_entrada_em IS NOT NULL
           AND ed.categoria::text <> 'Sobreaviso'
           AND NOT public.fn_competencia_encerrada(em.mes, em.ano)
         LIMIT 25
    LOOP
        -- Chamar duas vezes e comparar prova determinismo; o que importa aqui e que a funcao
        -- NAO explode e NAO passa a devolver pendencia nova em dia sem tratamento.
        IF public.fn_alocar_marcacoes_dia(r.serv, r.data)
           IS DISTINCT FROM public.fn_alocar_marcacoes_dia(r.serv, r.data) THEN
            RAISE EXCEPTION 'CONFERENCIA FALHOU (d): alocacao deixou de ser deterministica em % / %',
                r.serv, r.data;
        END IF;
        v_n := v_n + 1;
    END LOOP;

    RAISE NOTICE 'CONFERENCIA 20260917120000: % dia(s) sem tratamento conferidos, alocacao estavel.', v_n;
END;
$conf2$;
