-- ============================================================================
-- EXCLUSAO DE SETOR - exclusiva do Administrador Geral, e so' sem vinculo nenhum
-- ============================================================================
-- 27/08/2026
--
-- POR QUE
--   Setor cadastrado errado nao tinha como sair: a tela so' oferece Inativar. O resultado
--   medido em producao em 27/08/2026 sao 645 setores, 17 inativos - e 225 deles sem vinculo
--   NENHUM (nem servidor, nem escala, nem perfil, nem dispositivo, nem terminal, nem filho).
--   Esses 225 sao ruido puro no cadastro, e engordam todo dropdown de setor do sistema.
--
-- POR QUE NAO E' UM DELETE DIRETO DA TELA
--   As FKs que apontam para setores NAO sao uniformes: ha' ON DELETE CASCADE (pontos
--   facultativos) e varios ON DELETE SET NULL (historico de transferencia, justificativas,
--   solicitacoes). Um DELETE direto, portanto, apagaria e anularia dado real EM SILENCIO -
--   exatamente o modo de falha que este projeto evita.
--
--   Por isso a funcao RECUSA a exclusao quando existe qualquer dependente, em vez de deixar a
--   FK decidir. So' sai do banco o setor que nao segura nada.
--
-- POR QUE A VARREDURA E' DINAMICA (pg_constraint) E NAO UMA LISTA DE TABELAS
--   As tabelas base do sistema foram criadas FORA do versionamento (armadilha 2 do CLAUDE.md):
--   servidores, escala_mensal, escala_diaria e profile_setores nao aparecem em migration
--   nenhuma. Uma lista escrita a mao aqui nasceria incompleta e envelheceria a cada tabela
--   nova - e o preco de esquecer uma e' apagar setor que ainda era usado. Perguntar ao catalogo
--   do proprio Postgres e' a unica forma que continua correta depois da proxima migration.
--
-- QUEM PODE
--   Somente super_admin. Inativar continua com quem ja' podia: e' reversivel e nao apaga nada.
--   A action do Next confere o papel por conta propria - server action e' um POST cujo id sai
--   no bundle (armadilha 12 do CLAUDE.md), entao a tela filtrada nunca e' a defesa.
-- ============================================================================


-- ============================================================================
-- 1. O QUE SEGURA O SETOR
-- ============================================================================
-- Devolve uma linha por (tabela, coluna) que ainda referencia este setor, com a contagem.
--
-- A contagem para em 1000 de proposito: marcacoes_ponto e escala_diaria tem centenas de
-- milhares de linhas e nem toda coluna setor_id tem indice - um count(*) cheio faria a tela
-- travar para responder algo que ja' esta' decidido no primeiro registro encontrado. Acima
-- disso a resposta e' "1000+", que e' informacao suficiente para quem so' precisa saber que
-- NAO da' para excluir.
--
-- RETURNS TABLE exige DROP antes do CREATE: CREATE OR REPLACE nao altera a lista de colunas de
-- saida e a reaplicacao morreria com 42P13 (armadilha registrada no CLAUDE.md, secao Cobertura
-- de ponto).
DROP FUNCTION IF EXISTS public.fn_dependencias_setor(uuid);

CREATE FUNCTION public.fn_dependencias_setor(p_setor_id uuid)
RETURNS TABLE (
    tabela    text,
    coluna    text,
    qtd       bigint,
    truncado  boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    r      record;
    v_qtd  bigint;
BEGIN
    FOR r IN
        SELECT c.conrelid::regclass::text AS rel,
               (SELECT a.attname
                  FROM pg_attribute a
                 WHERE a.attrelid = c.conrelid
                   AND a.attnum = c.conkey[i]) AS col
          FROM pg_constraint c
          CROSS JOIN generate_subscripts(c.conkey, 1) AS i
         WHERE c.contype = 'f'
           AND c.confrelid = 'public.setores'::regclass
           -- Em FK composta (o destino de sobreaviso e' (setor_id, unidade_id), migration
           -- 20260808160000) so' interessa a coluna que aponta para setores.id.
           AND (SELECT a2.attname
                  FROM pg_attribute a2
                 WHERE a2.attrelid = c.confrelid
                   AND a2.attnum = c.confkey[i]) = 'id'
    LOOP
        EXECUTE format(
            'SELECT count(*) FROM (SELECT 1 FROM %s WHERE %I = $1 LIMIT 1000) x',
            r.rel, r.col
        ) INTO v_qtd USING p_setor_id;

        IF v_qtd > 0 THEN
            tabela   := r.rel;
            coluna   := r.col;
            qtd      := v_qtd;
            truncado := (v_qtd >= 1000);
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$fn$;

COMMENT ON FUNCTION public.fn_dependencias_setor(uuid) IS
    'O que ainda referencia este setor, por (tabela, coluna), varrendo pg_constraint em vez de '
    'uma lista fixa - as tabelas base do sistema nao estao versionadas. Contagem limitada a 1000.';

GRANT EXECUTE ON FUNCTION public.fn_dependencias_setor(uuid) TO authenticated, service_role;


-- ============================================================================
-- 2. A EXCLUSAO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_excluir_setor(p_setor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_nome        text;
    v_unidade     text;
    v_dependentes text;
    v_total       bigint;
BEGIN
    IF (SELECT public.get_my_role()) <> 'super_admin'::public.user_role THEN
        RAISE EXCEPTION 'Apenas o Administrador Geral pode excluir setores.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT COALESCE(d.nome, 'SETOR SEM NOME'), COALESCE(u.nome, '(sem unidade)')
      INTO v_nome, v_unidade
      FROM public.setores s
      LEFT JOIN public.dicionario_setores d ON d.id = s.dicionario_setor_id
      LEFT JOIN public.unidades u ON u.id = s.unidade_id
     WHERE s.id = p_setor_id;

    IF v_nome IS NULL THEN
        RAISE EXCEPTION 'Setor nao encontrado.' USING ERRCODE = 'no_data_found';
    END IF;

    -- O que ainda segura o setor. Recusar aqui, e nao deixar a FK agir, e' o ponto inteiro
    -- desta migration: metade das FKs apagaria ou anularia dado sem avisar ninguem.
    SELECT string_agg(
               format('%s.%s: %s%s', dep.tabela, dep.coluna, dep.qtd,
                      CASE WHEN dep.truncado THEN '+' ELSE '' END),
               '; ' ORDER BY dep.qtd DESC),
           count(*)
      INTO v_dependentes, v_total
      FROM public.fn_dependencias_setor(p_setor_id) dep;

    IF COALESCE(v_total, 0) > 0 THEN
        RAISE EXCEPTION
            'O setor "%" (%) ainda tem vinculos e nao pode ser excluido: %. Inative o setor '
            'ou transfira os vinculos antes.', v_nome, v_unidade, v_dependentes
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    DELETE FROM public.setores WHERE id = p_setor_id;

    -- O nome fica no dicionario municipal de proposito: ele e' compartilhado entre unidades e
    -- apagar dali mudaria o cadastro de outros setores que nada tem a ver com este.
    INSERT INTO public.logs_sistema (user_id, acao, detalhes)
    VALUES (auth.uid(), 'setor_excluido', jsonb_build_object(
        'setor_id', p_setor_id,
        'nome', v_nome,
        'unidade', v_unidade
    ));

    RETURN jsonb_build_object(
        'success', true,
        'nome', v_nome,
        'unidade', v_unidade,
        'message', format('Setor "%s" (%s) excluido.', v_nome, v_unidade));
END;
$fn$;

COMMENT ON FUNCTION public.fn_excluir_setor(uuid) IS
    'Exclui setor SEM nenhum vinculo. So super_admin. Recusa (nao deixa a FK agir) quando algo '
    'ainda referencia o setor, porque parte das FKs e ON DELETE CASCADE/SET NULL e apagaria ou '
    'anularia dado real em silencio. Registra em logs_sistema.';

REVOKE ALL ON FUNCTION public.fn_excluir_setor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_excluir_setor(uuid) TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) Quantas FKs a varredura enxerga (esperado: mais que as 13 declaradas em migrations,
--      porque servidores/escala_mensal/profile_setores nasceram fora do versionamento):
--
--   SELECT c.conrelid::regclass::text AS tabela, count(*)
--     FROM pg_constraint c
--    WHERE c.contype = 'f' AND c.confrelid = 'public.setores'::regclass
--    GROUP BY 1 ORDER BY 1;
--
--   2) Um setor com gente dentro tem que APARECER como dependente:
--
--   SELECT * FROM public.fn_dependencias_setor(
--       (SELECT setor_id FROM public.servidores WHERE setor_id IS NOT NULL LIMIT 1));
--   -- esperado: pelo menos servidores.setor_id
--
--   3) Quantos setores estao realmente livres hoje (esperado: 225 em 27/08/2026):
--
--   SELECT count(*) FROM public.setores s
--    WHERE NOT EXISTS (SELECT 1 FROM public.fn_dependencias_setor(s.id));
--
--   4) A exclusao recusa quem tem vinculo, e recusa quem nao e' Administrador Geral:
--
--   SELECT public.fn_excluir_setor('<setor_com_servidor>');  -- esperado: erro listando vinculos
--   -- com JWT de coordenador/RH: esperado 'Apenas o Administrador Geral pode excluir setores.'
--
--   5) Depois de excluir um setor de teste, o log tem que registrar:
--
--   SELECT acao, detalhes FROM public.logs_sistema
--    WHERE acao = 'setor_excluido' ORDER BY created_at DESC LIMIT 5;
