-- ============================================================================
-- FUNDIR SETOR - transferir todos os vinculos para outro setor e entao excluir
-- ============================================================================
-- 29/08/2026
--
-- POR QUE
--   20260827010000 deu ao Administrador Geral o botao "Excluir Setor", mas ele so' alcanca
--   setor SEM vinculo nenhum. Medido em producao em 29/08/2026: dos 646 setores, apenas 200
--   estao nessa situacao - e dos 16 setores ja' INATIVOS (que sao justamente os que alguem
--   quer tirar do cadastro), 7 tem vinculo e ficam presos para sempre. Quem tenta excluir
--   recebe a lista de vinculos e nao tem nenhuma acao a tomar a partir dela.
--
--   Esta migration da' a acao: escolher um SETOR DE DESTINO, mover tudo para la' e so' entao
--   apagar o setor de origem.
--
-- POR QUE FUSAO E NAO EXCLUSAO EM CASCATA
--   Metade das FKs que apontam para setores e' ON DELETE CASCADE ou SET NULL, entao um DELETE
--   direto apagaria escala e anularia historico EM SILENCIO. Pior: as tabelas presas ao setor
--   sao escala_mensal (1.658 linhas), marcacoes_ponto (26.834) e servidores (1.396) - registro
--   de ponto de servidor publico, que e' prova legal (Portaria 671/2021). Cascata aqui e'
--   destruicao de prova; fusao move o dado de dono e nao perde nada.
--
-- O QUE E' MOVIDO
--   A varredura e' dinamica sobre pg_constraint, mesma escolha de fn_dependencias_setor: as
--   tabelas base do sistema (servidores, escala_mensal, profile_setores, logs_sistema...) foram
--   criadas FORA do versionamento (armadilha 2 do CLAUDE.md), entao uma lista escrita a mao
--   nasceria incompleta e envelheceria a cada tabela nova. Medido hoje, 14 colunas de FK tem uso
--   real; a funcao move todas, e move tambem a que aparecer depois desta migration.
--
-- ⚠️ A EXCECAO NO TRIGGER DE IMUTABILIDADE DA MARCACAO
--   marcacoes_ponto e' INSERT-only por trigger (20260808010000). Sem uma excecao, nenhum setor
--   que ja' teve batida (107 dos 646) poderia ser fundido - a FK barraria o DELETE no fim.
--   A excecao criada aqui e' a mais estreita possivel e vale a pena ser lida com atencao:
--
--     - vale so' dentro de fn_fundir_setor, que declara o GUC sisescala.fundir_setor (local a'
--       transacao, como o sisescala.reparse_afd de 20260818001000);
--     - o UPDATE precisa alterar EXCLUSIVAMENTE setor_id: a comparacao e'
--       to_jsonb(NEW) - 'setor_id' = to_jsonb(OLD) - 'setor_id', ou seja, o registro inteiro
--       menos essa coluna tem que ser identico. Horario, servidor, origem, dispositivo, NSR e
--       flag de sintetica nao tem como mudar por aqui, hoje nem depois de a tabela ganhar coluna
--       nova (a comparacao e' estrutural, nao uma lista de campos que envelhece).
--
--   O fato registrado - quem bateu, quando, por qual equipamento - continua intocado. O que muda
--   e' o rotulo de CONTEXTO "em que setor isso aconteceu", e ele passa a apontar para o setor que
--   absorveu o outro, que e' a resposta correta depois da fusao (a alternativa seria apontar para
--   um setor que nao existe mais). A operacao fica registrada em logs_sistema.
--
-- O QUE A FUSAO RECUSA (em vez de resolver sozinha)
--   1. destino em OUTRA unidade - mover servidor e escala de unidade e' transferencia, tem tela
--      propria e regra propria de quem pode (20260828100000). Nao e' efeito colateral de excluir
--      setor;
--   2. destino que e' SUBSETOR da origem - os filhos da origem sao reapontados para o destino, e
--      o destino viraria pai (ou avo) de si mesmo. Ciclo em parent_id trava a montagem de arvore
--      de TODA tela de setor;
--   3. o mesmo servidor com escala nos DOIS setores na mesma competencia - a unique de
--      escala_mensal e (mes, ano, servidor_id, unidade_id, setor_id) e as duas linhas viram uma
--      colisao. Mesclar escala e' decisao de escala, nao de cadastro: as duas escalas podem ter
--      turnos no mesmo dia, e o resultado seria dupla contagem de horas na folha (armadilha 23);
--   4. qualquer OUTRA colisao de unicidade que a varredura encontre. Duas tabelas de vinculo
--      puro sao a excecao explicita - ver abaixo.
--
--   Recusar e' o comportamento certo para tudo que a funcao nao sabe resolver: a alternativa e'
--   apagar linha de dado real para "caber" no destino, exatamente o modo de falha que a
--   20260827010000 evitou ao nao deixar a FK decidir.
--
-- AS DUAS EXCECOES DE DESCARTE
--   profile_setores (PK profile_id+setor_id) e dispositivos_rep_setores (PK dispositivo_id+
--   setor_id) sao vinculo puro: a linha nao carrega dado proprio, ela E' o par. Se o mesmo
--   usuario ja' tem acesso ao destino, ou o mesmo relogio ja' atende o destino, a linha da origem
--   nao tem para onde ir - e nao tem o que perder. Ela e' descartada e a contagem sai no resumo.
--   Qualquer outra tabela cai na regra 4 acima.
--
-- QUEM PODE
--   Somente super_admin, igual a fn_excluir_setor. A action do Next confere o papel por conta
--   propria - server action e' um POST cujo id sai no bundle (armadilha 12 do CLAUDE.md).
--
-- IDEMPOTENTE
--   CREATE OR REPLACE nas funcoes; DROP FUNCTION IF EXISTS antes do CREATE onde o retorno e'
--   TABLE (CREATE OR REPLACE nao altera lista de colunas de saida - 42P13).
-- ============================================================================


-- ============================================================================
-- 1. A EXCECAO NO TRIGGER DE IMUTABILIDADE DA MARCACAO
-- ============================================================================
-- ⚠️ Copia integral da versao vigente (20260818001000) MAIS o ramo da fusao. O ramo do reparse
--    de AFD tem que continuar aqui: sem ele, fn_reparse_afd_dispositivo para de conseguir dar
--    dono a batida orfa, e o sintoma e' "o ponto de fulano nao aparece" (armadilha 1 - seis
--    regressoes reais ja' vieram de recopiar corpo de funcao sem um trecho).

CREATE OR REPLACE FUNCTION public.fn_bloquear_alteracao_marcacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    -- Permite associar servidor_id a uma batida orfa durante sessao de reparse declarada
    IF TG_OP = 'UPDATE'
       AND OLD.servidor_id IS NULL
       AND NEW.servidor_id IS NOT NULL
       AND NEW.ocorrido_em = OLD.ocorrido_em
       AND NEW.nsr IS NOT DISTINCT FROM OLD.nsr
       AND NEW.dispositivo_id IS NOT DISTINCT FROM OLD.dispositivo_id
       AND COALESCE(current_setting('sisescala.reparse_afd', true), 'off') = 'on' THEN
        RETURN NEW;
    END IF;

    -- Permite reapontar SO' o setor durante uma fusao de setor declarada. A comparacao e' do
    -- registro inteiro menos setor_id: nenhum outro campo pode ter mudado, hoje nem depois de a
    -- tabela ganhar coluna nova. Ver o cabecalho desta migration.
    IF TG_OP = 'UPDATE'
       AND NEW.setor_id IS NOT NULL
       AND NEW.setor_id IS DISTINCT FROM OLD.setor_id
       AND (to_jsonb(NEW) - 'setor_id') = (to_jsonb(OLD) - 'setor_id')
       AND COALESCE(current_setting('sisescala.fundir_setor', true), 'off') = 'on' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'Marcacao de ponto e imutavel (Portaria 671/2021). Operacao rejeitada: %. '
        'Para desconsiderar, reclassificar ou reatribuir uma marcacao, registre um tratamento '
        'em marcacoes_tratamentos - a marcacao original permanece para auditoria.',
        TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$fn$;


-- ============================================================================
-- 2. O DESTINO E' DESCENDENTE DA ORIGEM?
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_setor_e_descendente(
    p_ancestral uuid,
    p_candidato uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH RECURSIVE descendentes AS (
        SELECT s.id FROM public.setores s WHERE s.parent_id = p_ancestral
        UNION
        SELECT s.id FROM public.setores s
          JOIN descendentes d ON s.parent_id = d.id
         WHERE s.id <> p_ancestral            -- defesa contra ciclo ja' gravado em parent_id
    )
    SELECT EXISTS (SELECT 1 FROM descendentes WHERE id = p_candidato);
$fn$;

COMMENT ON FUNCTION public.fn_setor_e_descendente(uuid, uuid) IS
    'p_candidato esta em algum nivel abaixo de p_ancestral na arvore de parent_id?';

REVOKE ALL ON FUNCTION public.fn_setor_e_descendente(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_setor_e_descendente(uuid, uuid) TO authenticated, service_role;


-- ============================================================================
-- 3. O QUE IMPEDE A FUSAO (consulta - a tela mostra ANTES de o usuario confirmar)
-- ============================================================================
-- Devolve uma linha por impedimento. Lista vazia = a fusao passa.
--
-- Existe separada da fusao de proposito: a tela precisa dizer o que esta' errado enquanto o
-- Administrador ainda pode trocar o destino no <select>, nao depois de ele clicar em excluir.

DROP FUNCTION IF EXISTS public.fn_impedimentos_fusao_setor(uuid, uuid);

CREATE FUNCTION public.fn_impedimentos_fusao_setor(
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
    v_unid_o  uuid;
    v_unid_d  uuid;
    r         record;
    u         record;
    v_outras  text[];
    v_pred    text;
    v_qtd     bigint;
    v_lista   text;
BEGIN
    SELECT unidade_id INTO v_unid_o FROM public.setores WHERE id = p_origem;
    SELECT unidade_id INTO v_unid_d FROM public.setores WHERE id = p_destino;

    IF v_unid_o IS NULL THEN
        motivo := 'origem_inexistente';
        detalhe := 'Setor a excluir nao encontrado.';
        RETURN NEXT; RETURN;
    END IF;

    IF v_unid_d IS NULL THEN
        motivo := 'destino_inexistente';
        detalhe := 'Setor de destino nao encontrado.';
        RETURN NEXT; RETURN;
    END IF;

    IF p_origem = p_destino THEN
        motivo := 'destino_igual_origem';
        detalhe := 'O setor de destino tem que ser diferente do setor que sera excluido.';
        RETURN NEXT; RETURN;
    END IF;

    IF v_unid_o IS DISTINCT FROM v_unid_d THEN
        motivo := 'unidade_diferente';
        detalhe := 'O destino precisa ser um setor da MESMA unidade. Mover servidor e escala '
                || 'de unidade e transferencia, e tem tela propria.';
        RETURN NEXT;
    END IF;

    IF public.fn_setor_e_descendente(p_origem, p_destino) THEN
        motivo := 'destino_e_subsetor';
        detalhe := 'O destino e subsetor do setor que sera excluido. Troque o setor pai dele '
                || 'antes, senao ele viraria pai de si mesmo.';
        RETURN NEXT;
    END IF;

    -- Mesmo servidor com escala nos dois setores na mesma competencia.
    SELECT string_agg(DISTINCT format('%s (%s/%s)', sv.nome, em.mes, em.ano), '; ')
      INTO v_lista
      FROM public.escala_mensal em
      JOIN public.servidores sv ON sv.id = em.servidor_id
     WHERE em.setor_id = p_origem
       AND EXISTS (
           SELECT 1 FROM public.escala_mensal e2
            WHERE e2.setor_id = p_destino
              AND e2.servidor_id = em.servidor_id
              AND e2.mes = em.mes
              AND e2.ano = em.ano);

    IF v_lista IS NOT NULL THEN
        motivo := 'escala_duplicada';
        detalhe := 'Ja existe escala destes servidores no setor de destino, na mesma '
                || 'competencia: ' || v_lista || '. Resolva a escala antes - juntar as duas '
                || 'aqui contaria as mesmas horas duas vezes na folha.';
        RETURN NEXT;
    END IF;

    -- Colisao de unicidade em qualquer outra tabela que aponte para setores. Varredura dinamica
    -- pelo mesmo motivo de fn_dependencias_setor: as tabelas base nao estao versionadas.
    FOR r IN
        SELECT c.conrelid AS oid,
               c.conrelid::regclass::text AS rel,
               (SELECT a.attname::text
                  FROM pg_attribute a
                 WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[i]) AS col
          FROM pg_constraint c
          CROSS JOIN generate_subscripts(c.conkey, 1) AS i
         WHERE c.contype = 'f'
           AND c.confrelid = 'public.setores'::regclass
           AND (SELECT a2.attname
                  FROM pg_attribute a2
                 WHERE a2.attrelid = c.confrelid AND a2.attnum = c.confkey[i]) = 'id'
    LOOP
        FOR u IN
            SELECT c2.conname,
                   (SELECT array_agg(a.attname::text ORDER BY x.ord)
                      FROM unnest(c2.conkey) WITH ORDINALITY AS x(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c2.conrelid AND a.attnum = x.attnum
                   ) AS cols
              FROM pg_constraint c2
             WHERE c2.conrelid = r.oid
               AND c2.contype IN ('u', 'p')
               AND (SELECT a3.attnum FROM pg_attribute a3
                     WHERE a3.attrelid = r.oid AND a3.attname = r.col) = ANY (c2.conkey)
        LOOP
            v_outras := array_remove(u.cols, r.col);

            IF v_outras IS NULL OR array_length(v_outras, 1) IS NULL THEN
                -- A unicidade e' a propria coluna do setor: qualquer linha no destino colide.
                v_pred := 'true';
            ELSE
                SELECT string_agg(format('d.%I IS NOT DISTINCT FROM o.%I', k, k), ' AND ')
                  INTO v_pred
                  FROM unnest(v_outras) AS k;
            END IF;

            EXECUTE format(
                'SELECT count(*) FROM %s o WHERE o.%I = $1 '
                'AND EXISTS (SELECT 1 FROM %s d WHERE d.%I = $2 AND %s)',
                r.rel, r.col, r.rel, r.col, v_pred
            ) INTO v_qtd USING p_origem, p_destino;

            -- Vinculo puro (a linha E' o par) - a duplicata e' descartada pela fusao, nao impede.
            IF v_qtd > 0
               AND r.rel NOT IN ('profile_setores', 'public.profile_setores',
                                 'dispositivos_rep_setores', 'public.dispositivos_rep_setores')
            THEN
                motivo := 'colisao_unicidade';
                detalhe := format(
                    '%s: %s registro(s) da origem ja existem no destino (%s). Mover criaria '
                    'duplicidade - resolva esses registros antes.',
                    r.rel, v_qtd, u.conname);
                RETURN NEXT;
            END IF;
        END LOOP;
    END LOOP;
END;
$fn$;

COMMENT ON FUNCTION public.fn_impedimentos_fusao_setor(uuid, uuid) IS
    'O que impede fundir p_origem em p_destino (unidade diferente, destino subsetor, escala do '
    'mesmo servidor nos dois na mesma competencia, colisao de unicidade). Vazio = pode fundir.';

REVOKE ALL ON FUNCTION public.fn_impedimentos_fusao_setor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_impedimentos_fusao_setor(uuid, uuid) TO authenticated, service_role;


-- ============================================================================
-- 4. A FUSAO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_fundir_setor(
    p_origem  uuid,
    p_destino uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_nome_o      text;
    v_nome_d      text;
    v_unidade     text;
    v_impedimento text;
    r             record;
    u             record;
    v_outras      text[];
    v_pred        text;
    v_n           bigint;
    v_movidos     jsonb := '{}'::jsonb;
    v_descartados jsonb := '{}'::jsonb;
BEGIN
    IF (SELECT public.get_my_role()) <> 'super_admin'::public.user_role THEN
        RAISE EXCEPTION 'Apenas o Administrador Geral pode excluir setores.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT COALESCE(d.nome, 'SETOR SEM NOME'), COALESCE(un.nome, '(sem unidade)')
      INTO v_nome_o, v_unidade
      FROM public.setores s
      LEFT JOIN public.dicionario_setores d ON d.id = s.dicionario_setor_id
      LEFT JOIN public.unidades un ON un.id = s.unidade_id
     WHERE s.id = p_origem;

    SELECT COALESCE(d.nome, 'SETOR SEM NOME')
      INTO v_nome_d
      FROM public.setores s
      LEFT JOIN public.dicionario_setores d ON d.id = s.dicionario_setor_id
     WHERE s.id = p_destino;

    IF v_nome_o IS NULL THEN
        RAISE EXCEPTION 'Setor a excluir nao encontrado.' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_nome_d IS NULL THEN
        RAISE EXCEPTION 'Setor de destino nao encontrado.' USING ERRCODE = 'no_data_found';
    END IF;

    -- Todos os impedimentos de uma vez: quem esta' na tela precisa ver a lista inteira, nao
    -- descobrir um por vez a cada tentativa.
    SELECT string_agg(imp.detalhe, ' | ')
      INTO v_impedimento
      FROM public.fn_impedimentos_fusao_setor(p_origem, p_destino) imp;

    IF v_impedimento IS NOT NULL THEN
        RAISE EXCEPTION 'Nao e possivel transferir os vinculos de "%" para "%": %',
            v_nome_o, v_nome_d, v_impedimento
            USING ERRCODE = 'check_violation';
    END IF;

    -- Autoriza o UPDATE de setor_id em marcacoes_ponto (e SO' ele) ate' o fim desta transacao.
    PERFORM set_config('sisescala.fundir_setor', 'on', true);

    FOR r IN
        SELECT c.conrelid AS oid,
               c.conrelid::regclass::text AS rel,
               (SELECT a.attname::text
                  FROM pg_attribute a
                 WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[i]) AS col
          FROM pg_constraint c
          CROSS JOIN generate_subscripts(c.conkey, 1) AS i
         WHERE c.contype = 'f'
           AND c.confrelid = 'public.setores'::regclass
           AND (SELECT a2.attname
                  FROM pg_attribute a2
                 WHERE a2.attrelid = c.confrelid AND a2.attnum = c.confkey[i]) = 'id'
    LOOP
        -- 4.1 Vinculo puro que ja' existe no destino: a linha da origem nao tem para onde ir.
        IF r.rel IN ('profile_setores', 'public.profile_setores',
                     'dispositivos_rep_setores', 'public.dispositivos_rep_setores') THEN
            FOR u IN
                SELECT (SELECT array_agg(a.attname::text ORDER BY x.ord)
                          FROM unnest(c2.conkey) WITH ORDINALITY AS x(attnum, ord)
                          JOIN pg_attribute a ON a.attrelid = c2.conrelid AND a.attnum = x.attnum
                       ) AS cols
                  FROM pg_constraint c2
                 WHERE c2.conrelid = r.oid
                   AND c2.contype IN ('u', 'p')
                   AND (SELECT a3.attnum FROM pg_attribute a3
                         WHERE a3.attrelid = r.oid AND a3.attname = r.col) = ANY (c2.conkey)
            LOOP
                v_outras := array_remove(u.cols, r.col);
                IF v_outras IS NULL OR array_length(v_outras, 1) IS NULL THEN
                    v_pred := 'true';
                ELSE
                    SELECT string_agg(format('d.%I IS NOT DISTINCT FROM o.%I', k, k), ' AND ')
                      INTO v_pred
                      FROM unnest(v_outras) AS k;
                END IF;

                EXECUTE format(
                    'DELETE FROM %s o WHERE o.%I = $1 '
                    'AND EXISTS (SELECT 1 FROM %s d WHERE d.%I = $2 AND %s)',
                    r.rel, r.col, r.rel, r.col, v_pred
                ) USING p_origem, p_destino;
                GET DIAGNOSTICS v_n = ROW_COUNT;

                IF v_n > 0 THEN
                    v_descartados := v_descartados || jsonb_build_object(
                        r.rel || '.' || r.col,
                        COALESCE((v_descartados ->> (r.rel || '.' || r.col))::bigint, 0) + v_n);
                END IF;
            END LOOP;
        END IF;

        -- 4.2 O resto vai inteiro para o destino.
        EXECUTE format('UPDATE %s SET %I = $2 WHERE %I = $1', r.rel, r.col, r.col)
            USING p_origem, p_destino;
        GET DIAGNOSTICS v_n = ROW_COUNT;

        IF v_n > 0 THEN
            v_movidos := v_movidos || jsonb_build_object(r.rel || '.' || r.col, v_n);
        END IF;
    END LOOP;

    -- Se sobrou qualquer referencia, a FK derruba o DELETE e a transacao inteira volta atras -
    -- que e' o comportamento desejado: melhor nao excluir do que excluir pela metade.
    DELETE FROM public.setores WHERE id = p_origem;

    INSERT INTO public.logs_sistema (user_id, acao, detalhes)
    VALUES (auth.uid(), 'setor_fundido', jsonb_build_object(
        'setor_origem_id', p_origem,
        'setor_origem', v_nome_o,
        'setor_destino_id', p_destino,
        'setor_destino', v_nome_d,
        'unidade', v_unidade,
        'movidos', v_movidos,
        'vinculos_duplicados_descartados', v_descartados
    ));

    RETURN jsonb_build_object(
        'success', true,
        'origem', v_nome_o,
        'destino', v_nome_d,
        'unidade', v_unidade,
        'movidos', v_movidos,
        'descartados', v_descartados,
        'message', format('Vinculos de "%s" transferidos para "%s" e setor excluido.',
                          v_nome_o, v_nome_d));
END;
$fn$;

COMMENT ON FUNCTION public.fn_fundir_setor(uuid, uuid) IS
    'Move TODO vinculo de p_origem para p_destino (varredura dinamica de pg_constraint) e exclui '
    'a origem. So super_admin, so dentro da mesma unidade. Recusa em bloco quando ha impedimento '
    '(ver fn_impedimentos_fusao_setor). Registra em logs_sistema.';

REVOKE ALL ON FUNCTION public.fn_fundir_setor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fundir_setor(uuid, uuid) TO authenticated, service_role;


-- ============================================================================
-- 5. FECHA UM RESQUICIO DA MIGRATION ANTERIOR
-- ============================================================================
-- 20260827010000 criou fn_dependencias_setor so com GRANT, e GRANT nunca restringiu nada: no
-- PostgreSQL toda funcao nova ja nasce executavel por PUBLIC (armadilha 24 do CLAUDE.md), entao
-- ela continua alcancavel pela chave anon, que vai no bundle do navegador.

REVOKE ALL ON FUNCTION public.fn_dependencias_setor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dependencias_setor(uuid) TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) O trigger de imutabilidade tem que continuar recusando UPDATE comum de marcacao
--      (sem o GUC ligado). Esperado: erro 'Marcacao de ponto e imutavel'.
--
--   UPDATE public.marcacoes_ponto SET ocorrido_em = ocorrido_em + interval '1 minute'
--    WHERE id = (SELECT id FROM public.marcacoes_ponto LIMIT 1);
--
--   2) ...e recusar tambem quando o GUC esta ligado mas o UPDATE mexe em outra coluna:
--
--   BEGIN;
--     SELECT set_config('sisescala.fundir_setor', 'on', true);
--     UPDATE public.marcacoes_ponto SET sintetica = NOT sintetica
--      WHERE id = (SELECT id FROM public.marcacoes_ponto LIMIT 1);   -- esperado: erro
--   ROLLBACK;
--
--   3) Impedimentos de um par qualquer (troque os ids). Esperado: lista vazia quando os dois
--      setores sao da mesma unidade, o destino nao e subsetor e nao ha escala do mesmo servidor
--      nos dois na mesma competencia:
--
--   SELECT * FROM public.fn_impedimentos_fusao_setor('<origem>', '<destino>');
--
--   4) Ensaio SEM efeito - o resumo do que seria movido, sem excluir nada:
--
--   BEGIN;
--     SELECT public.fn_fundir_setor('<origem>', '<destino>');
--   ROLLBACK;
--
--   5) Depois de uma fusao de verdade, o log tem que registrar o de -> para:
--
--   SELECT acao, detalhes FROM public.logs_sistema
--    WHERE acao = 'setor_fundido' ORDER BY created_at DESC LIMIT 5;
--
--   6) A origem nao pode ter sobrado em lugar nenhum (esperado: 0 linhas):
--
--   SELECT * FROM public.fn_dependencias_setor('<origem>');
