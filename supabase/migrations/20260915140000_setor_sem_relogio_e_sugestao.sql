-- Migration: setor sem relogio - deteccao e sugestao (Parte 2 do plano de 15/09/2026)
-- Data: 2026-09-15
--
-- Plano: docs/planos/2026-09-15-relogio-que-atende-setor-de-outra-unidade.md (secoes 8 a 12)
--
-- MOTIVACAO
--   Setor criado numa unidade cujo relogio trabalha com LISTA nasce fora do relogio, em silencio,
--   ate alguem lembrar de ir nas configuracoes marca-lo. Medido em 15/09/2026, antes de o usuario
--   corrigir 565 vinculos a mao: 37 setores orfaos, 29 com gente, 115 lotados, 113 sem uma unica
--   batida - e os 37 criados DEPOIS de o relogio da unidade estar configurado.
--
--   Isto e LEITURA PURA mais UMA escrita aditiva. Nao existe trigger, nao existe automatismo:
--   nenhum vinculo e criado sem alguem clicar.
--
-- 🚨 POR QUE A HERANCA NAO PODE SER AUTOMATICA
--   Subir a arvore ate o ancestral mais proximo com relogio resolve todos os orfaos medidos. Como
--   REGRA VIVA, porem, ampliaria em silencio a abrangencia de 31 setores que JA tem relogio (
--   medido em 15/09/2026), entre eles ENFERMAGEM > ENFERMEIROS > AMENT - ALA PSICOSSOCIAL, que
--   tem relogio PROPRIO em outro predio. Seria o erro do HMM-03 x CCE de novo.
--
-- 🚨 E O PALPITE DA HIERARQUIA ERRA JUSTAMENTE NO CASO DA PARTE 1
--   Medido: os 3 polos do CAF sairiam "herdando" os relogios da SEDE do CAF - e eles funcionam em
--   OUTROS PREDIOS. Por isso a sugestao carrega a FORCA do sinal, e a tela so pre-marca o forte:
--     forca 2 (evidencia): a gente deste setor JA BATE naquele relogio hoje;
--     forca 1 (palpite)  : o ancestral mais proximo e atendido por ele;
--     forca 0 (nenhuma)  : ninguem bate em lugar nenhum e nao ha ancestral - e preciso saber em
--                          qual predio o setor funciona (o caso dos polos).
--
-- IDEMPOTENTE: DROP + CREATE nas que devolvem TABLE (42P13 exige DROP para mudar colunas de
-- saida, e aqui elas nascem), CREATE OR REPLACE na de escrita.


-- ============================================================================
-- 1. SUGESTAO DE RELOGIO PARA UM SETOR
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_relogios_sugeridos_para_setor(uuid);

CREATE FUNCTION public.fn_relogios_sugeridos_para_setor(p_setor_id uuid)
RETURNS TABLE (
    dispositivo_id   uuid,
    dispositivo_nome text,
    unidade_nome     text,
    forca            integer,
    motivo           text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
    v_unidade_id uuid;
BEGIN
    SELECT s.unidade_id INTO v_unidade_id FROM public.setores s WHERE s.id = p_setor_id;
    IF v_unidade_id IS NULL THEN
        RETURN;
    END IF;

    -- Papel: ver sugestao e visibilidade, nao autoridade. Denylist (armadilha 44).
    IF auth.uid() IS NOT NULL THEN
        IF (SELECT public.get_my_role()) IS NULL
           OR (SELECT public.get_my_role()) IN ('servidor'::public.user_role, 'comum'::public.user_role) THEN
            RAISE EXCEPTION 'Sem permissao para ver sugestoes de relogio.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    RETURN QUERY
    WITH RECURSIVE ancestrais AS (
        -- nivel 0 = o proprio setor; cada passo sobe um pai. O LIMITE de 10 protege contra
        -- ciclo em parent_id, que ja apareceu neste projeto (sim_caminho_setor.js).
        SELECT s.id, s.parent_id, 0 AS nivel
          FROM public.setores s WHERE s.id = p_setor_id
         UNION ALL
        SELECT p.id, p.parent_id, a.nivel + 1
          FROM ancestrais a
          JOIN public.setores p ON p.id = a.parent_id
         WHERE a.nivel < 10
    ),
    -- EVIDENCIA: onde a gente DESTE setor ja bate hoje. E o sinal forte, porque vem do fato,
    -- nao da arvore. Cobre o caso em que o setor ficou orfao depois de alguem restringir um
    -- relogio - ali as pessoas continuam batendo e o lugar certo e obvio pelo dado.
    evidencia AS (
        SELECT m.dispositivo_id AS did, count(*) AS n
          FROM public.marcacoes_ponto m
          JOIN public.servidores sv ON sv.id = m.servidor_id
         WHERE sv.setor_id = p_setor_id
           AND sv.status = 'Ativo'
           AND m.origem = 'rep'
           AND m.dispositivo_id IS NOT NULL
           AND m.ocorrido_em >= now() - interval '60 days'
         GROUP BY m.dispositivo_id
    ),
    -- PALPITE: o ancestral mais proximo (menor nivel > 0) que tenha algum relogio.
    palpite AS (
        SELECT d.id AS did, a.nivel, a.id AS via
          FROM ancestrais a
          JOIN public.dispositivos_rep d
            ON d.ativo
           AND public.fn_dispositivo_atende_setor(d.id, a.id, v_unidade_id)
         WHERE a.nivel > 0
    ),
    melhor_nivel AS (SELECT min(nivel) AS n FROM palpite)
    SELECT d.id,
           d.nome,
           u.nome,
           CASE WHEN e.did IS NOT NULL THEN 2 ELSE 1 END,
           CASE WHEN e.did IS NOT NULL
                THEN format('%s pessoa(s) deste setor ja bate(m) neste relogio (60 dias)', e.n)
                ELSE format('o setor %s e atendido por ele', public.fn_setor_caminho(p.via))
           END
      FROM public.dispositivos_rep d
      JOIN public.unidades u ON u.id = d.unidade_id
      LEFT JOIN evidencia e ON e.did = d.id
      LEFT JOIN palpite   p ON p.did = d.id
                           AND p.nivel = (SELECT n FROM melhor_nivel)
     WHERE d.ativo
       AND (e.did IS NOT NULL OR p.did IS NOT NULL)
       -- Nunca sugerir um relogio que JA atende o setor: seria ruido puro.
       AND NOT public.fn_dispositivo_atende_setor(d.id, p_setor_id, v_unidade_id)
     ORDER BY 4 DESC, 2;
END;
$fn$;

COMMENT ON FUNCTION public.fn_relogios_sugeridos_para_setor(uuid) IS
    'Relogios que provavelmente atendem este setor, com a FORCA do sinal: 2 = a gente do setor ja '
    'bate ali (fato), 1 = o ancestral mais proximo e atendido por ele (palpite pela arvore). '
    'Sugestao, nunca vinculo: o palpite erra no setor que funciona em outro predio.';

REVOKE ALL ON FUNCTION public.fn_relogios_sugeridos_para_setor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_relogios_sugeridos_para_setor(uuid) TO authenticated, service_role;


-- ============================================================================
-- 2. OS SETORES QUE NENHUM RELOGIO ATENDE
-- ============================================================================
-- A rede de seguranca. O formulario de setor nao basta sozinho: setor entra por outros caminhos
-- (fusao, correcao de hierarquia, script) e o parent_id muda DEPOIS da criacao.

DROP FUNCTION IF EXISTS public.fn_setores_sem_relogio(integer, integer);

CREATE FUNCTION public.fn_setores_sem_relogio(
    p_mes integer DEFAULT NULL,
    p_ano integer DEFAULT NULL
)
RETURNS TABLE (
    setor_id        uuid,
    setor_caminho   text,
    unidade_id      uuid,
    unidade_nome    text,
    lotados         integer,
    escalados       integer,
    criado_em       timestamptz,
    forca_sugestao  integer,
    sugestao        text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
    v_tz   text;
    v_hoje date;
    v_mes  integer;
    v_ano  integer;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF (SELECT public.get_my_role()) IS NULL
           OR (SELECT public.get_my_role()) IN ('servidor'::public.user_role, 'comum'::public.user_role) THEN
            RAISE EXCEPTION 'Sem permissao para ver setores sem relogio.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- Mes corrente NO FUSO CONFIGURADO (armadilha 12). configuracoes_globais e chave/valor.
    SELECT (valor#>>'{}')::text INTO v_tz
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    v_tz := COALESCE(v_tz, 'America/Sao_Paulo');
    v_hoje := (now() AT TIME ZONE v_tz)::date;
    v_mes := COALESCE(p_mes, EXTRACT(MONTH FROM v_hoje)::integer);
    v_ano := COALESCE(p_ano, EXTRACT(YEAR  FROM v_hoje)::integer);

    RETURN QUERY
    WITH alvo AS (
        SELECT s.id, s.unidade_id, s.created_at
          FROM public.setores s
         WHERE s.ativo IS DISTINCT FROM false
           AND public.fn_escopo_gestao_alcanca(s.unidade_id)
           -- So faz sentido cobrar setor de unidade QUE TEM relogio. Unidade inteira sem
           -- equipamento e outro problema, e apareceria aqui como ruido em toda linha.
           AND EXISTS (SELECT 1 FROM public.dispositivos_rep d
                        WHERE d.unidade_id = s.unidade_id AND d.ativo)
           AND NOT EXISTS (
               SELECT 1 FROM public.dispositivos_rep d
                WHERE d.ativo
                  AND public.fn_dispositivo_atende_setor(d.id, s.id, s.unidade_id)
           )
    ),
    contagem AS (
        SELECT a.id,
               (SELECT count(*) FROM public.servidores sv
                 WHERE sv.setor_id = a.id AND sv.status = 'Ativo')::integer AS lotados,
               (SELECT count(DISTINCT em.servidor_id) FROM public.escala_mensal em
                 WHERE em.setor_id = a.id AND em.mes = v_mes AND em.ano = v_ano)::integer AS escalados
          FROM alvo a
    )
    SELECT a.id,
           public.fn_setor_caminho(a.id),
           a.unidade_id,
           u.nome,
           c.lotados,
           c.escalados,
           a.created_at,
           COALESCE((SELECT max(g.forca) FROM public.fn_relogios_sugeridos_para_setor(a.id) g), 0),
           (SELECT string_agg(g.dispositivo_nome, ', ' ORDER BY g.forca DESC, g.dispositivo_nome)
              FROM public.fn_relogios_sugeridos_para_setor(a.id) g
             WHERE g.forca = (SELECT max(g2.forca) FROM public.fn_relogios_sugeridos_para_setor(a.id) g2))
      FROM alvo a
      JOIN contagem c ON c.id = a.id
      JOIN public.unidades u ON u.id = a.unidade_id
     -- Quem tem gente primeiro: e a fila de urgencia real.
     ORDER BY (c.lotados + c.escalados) DESC, u.nome, 2;
END;
$fn$;

COMMENT ON FUNCTION public.fn_setores_sem_relogio(integer, integer) IS
    'Setores ativos, em unidade que TEM relogio, que nenhum equipamento atende - com a sugestao '
    'e a forca dela. Rede de seguranca: o formulario de setor nao e o unico caminho de criacao, '
    'e o parent_id muda depois.';

REVOKE ALL ON FUNCTION public.fn_setores_sem_relogio(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_setores_sem_relogio(integer, integer) TO authenticated, service_role;


-- ============================================================================
-- 2b. UM SETOR SO: "este aqui esta orfao?"
-- ============================================================================
-- Existe para o aviso logo depois de CRIAR um setor, onde perguntar pela lista inteira seria
-- caro e responderia outra coisa. Devolve false para setor de unidade SEM relogio - la o
-- problema e outro, e acusar seria alarme fabricado (mesmo criterio de fn_setores_sem_relogio).

CREATE OR REPLACE FUNCTION public.fn_setor_sem_relogio(p_setor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT EXISTS (SELECT 1 FROM public.setores s
                    WHERE s.id = p_setor_id
                      AND s.ativo IS DISTINCT FROM false
                      AND EXISTS (SELECT 1 FROM public.dispositivos_rep d
                                   WHERE d.unidade_id = s.unidade_id AND d.ativo)
                      AND NOT EXISTS (
                          SELECT 1 FROM public.dispositivos_rep d
                           WHERE d.ativo
                             AND public.fn_dispositivo_atende_setor(d.id, s.id, s.unidade_id)));
$fn$;

COMMENT ON FUNCTION public.fn_setor_sem_relogio(uuid) IS
    'true = este setor esta em unidade que TEM relogio e nenhum equipamento o atende.';

REVOKE ALL ON FUNCTION public.fn_setor_sem_relogio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_setor_sem_relogio(uuid) TO authenticated, service_role;


-- ============================================================================
-- 3. VINCULAR UM SETOR A RELOGIOS (ADITIVO)
-- ============================================================================
-- ⚠️ NAO reusa fn_definir_setores_dispositivo_rep de proposito: aquela SUBSTITUI a lista inteira
-- do dispositivo. Aplicar em lote com ela exigiria ler a lista de cada relogio e somar no
-- cliente - e um erro ali apagaria a configuracao de um equipamento inteiro. Esta so ACRESCENTA.

CREATE OR REPLACE FUNCTION public.fn_vincular_setor_a_relogios(
    p_setor_id        uuid,
    p_dispositivo_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_unidade_setor uuid;
    v_invalidos     integer;
    v_sem_escopo    integer;
    v_vinculados    integer := 0;
BEGIN
    SELECT s.unidade_id INTO v_unidade_setor FROM public.setores s WHERE s.id = p_setor_id;
    IF v_unidade_setor IS NULL THEN
        RAISE EXCEPTION 'Setor % nao encontrado.', p_setor_id;
    END IF;

    IF COALESCE(array_length(p_dispositivo_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'Nenhum relogio informado.';
    END IF;

    SELECT count(*) INTO v_invalidos
      FROM unnest(p_dispositivo_ids) x(id)
     WHERE NOT EXISTS (SELECT 1 FROM public.dispositivos_rep d WHERE d.id = x.id AND d.ativo);
    IF v_invalidos > 0 THEN
        RAISE EXCEPTION '% relogio(s) informado(s) nao existe(m) ou esta(o) inativo(s).', v_invalidos;
    END IF;

    -- Mesma regra da Parte 1: o ato alcanca a unidade do RELOGIO e a unidade do SETOR.
    SELECT count(*) INTO v_sem_escopo
      FROM unnest(p_dispositivo_ids) x(id)
      JOIN public.dispositivos_rep d ON d.id = x.id
     WHERE NOT public.fn_escopo_gestao_alcanca(d.unidade_id)
        OR NOT public.fn_escopo_gestao_alcanca(v_unidade_setor);
    IF v_sem_escopo > 0 THEN
        RAISE EXCEPTION 'Sem permissao sobre a unidade de % relogio(s) ou do setor informado.', v_sem_escopo
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    INSERT INTO public.dispositivos_rep_setores (dispositivo_id, setor_id, criado_por_id)
    SELECT x.id, p_setor_id, auth.uid()
      FROM unnest(p_dispositivo_ids) x(id)
     ON CONFLICT (dispositivo_id, setor_id) DO NOTHING;
    GET DIAGNOSTICS v_vinculados = ROW_COUNT;

    -- Relata o que MUDOU, nao o que foi pedido (armadilha 22): pedir 4 e vincular 1 porque 3 ja
    -- estavam la e' informacao, nao detalhe.
    RETURN jsonb_build_object(
        'vinculados', v_vinculados,
        'ja_vinculados', COALESCE(array_length(p_dispositivo_ids, 1), 0) - v_vinculados,
        'atendido_agora', EXISTS (
            SELECT 1 FROM public.dispositivos_rep d
             WHERE d.ativo AND public.fn_dispositivo_atende_setor(d.id, p_setor_id, v_unidade_setor)
        )
    );
END;
$fn$;

COMMENT ON FUNCTION public.fn_vincular_setor_a_relogios(uuid, uuid[]) IS
    'Acrescenta um setor a um ou mais relogios, sem tocar no resto da lista de cada um. '
    'Existe separada de fn_definir_setores_dispositivo_rep, que SUBSTITUI a lista inteira.';

REVOKE ALL ON FUNCTION public.fn_vincular_setor_a_relogios(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_vincular_setor_a_relogios(uuid, uuid[]) TO authenticated, service_role;


-- ============================================================================
-- 4. CONFERENCIA (executa as funcoes - armadilha 42)
-- ============================================================================
DO $conf$
DECLARE
    v_orfao   record;
    v_n       integer;
    v_sug     integer;
    v_r       jsonb;
    v_disp    uuid;
    v_antes   integer;
    v_depois  integer;
BEGIN
    IF to_regprocedure('public.fn_dispositivo_atende_setor(uuid, uuid, uuid)') IS NULL THEN
        RAISE EXCEPTION 'ABORTADO: aplique 20260915100000 antes desta.';
    END IF;

    -- 4.1 A deteccao roda.
    SELECT count(*) INTO v_n FROM public.fn_setores_sem_relogio(NULL, NULL);
    RAISE NOTICE 'ok  4.1 fn_setores_sem_relogio executa: % setor(es) orfao(s)', v_n;

    -- 4.2 Nenhum setor listado pode ter relogio - seria contradicao da propria funcao.
    SELECT count(*) INTO v_sug
      FROM public.fn_setores_sem_relogio(NULL, NULL) o
     WHERE EXISTS (SELECT 1 FROM public.dispositivos_rep d
                    WHERE d.ativo AND public.fn_dispositivo_atende_setor(d.id, o.setor_id, o.unidade_id));
    IF v_sug > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % setor(es) listados como orfaos JA tem relogio.', v_sug;
    END IF;
    RAISE NOTICE 'ok  4.2 nenhum orfao listado e atendido por algum relogio';

    -- 4.3 A sugestao nunca aponta relogio que ja atende o setor (seria ruido).
    SELECT count(*) INTO v_sug
      FROM public.setores s,
           LATERAL public.fn_relogios_sugeridos_para_setor(s.id) g
     WHERE public.fn_dispositivo_atende_setor(g.dispositivo_id, s.id, s.unidade_id);
    IF v_sug > 0 THEN
        RAISE EXCEPTION 'ABORTADO: a sugestao apontou % relogio(s) que ja atendem o setor.', v_sug;
    END IF;
    RAISE NOTICE 'ok  4.3 sugestao nunca repete relogio que ja atende';

    -- 4.4 ENSAIO da escrita, revertido a mao (RAISE aqui derrubaria a migration inteira).
    SELECT * INTO v_orfao FROM public.fn_setores_sem_relogio(NULL, NULL)
     WHERE forca_sugestao > 0 LIMIT 1;
    IF v_orfao.setor_id IS NULL THEN
        RAISE NOTICE '-   4.4 pulado: nenhum orfao com sugestao para ensaiar';
    ELSE
        SELECT g.dispositivo_id INTO v_disp
          FROM public.fn_relogios_sugeridos_para_setor(v_orfao.setor_id) g LIMIT 1;

        SELECT count(*) INTO v_antes FROM public.fn_setores_sem_relogio(NULL, NULL);
        v_r := public.fn_vincular_setor_a_relogios(v_orfao.setor_id, ARRAY[v_disp]);
        SELECT count(*) INTO v_depois FROM public.fn_setores_sem_relogio(NULL, NULL);

        IF (v_r->>'vinculados')::integer <> 1 THEN
            RAISE EXCEPTION 'ABORTADO: o vinculo nao foi criado (retorno %).', v_r;
        END IF;
        IF (v_r->>'atendido_agora')::boolean IS NOT TRUE THEN
            RAISE EXCEPTION 'ABORTADO: o setor continua sem relogio depois de vincular.';
        END IF;
        IF v_depois <> v_antes - 1 THEN
            RAISE EXCEPTION 'ABORTADO: a lista de orfaos nao diminuiu (antes=%, depois=%).', v_antes, v_depois;
        END IF;

        -- reverte
        DELETE FROM public.dispositivos_rep_setores
              WHERE dispositivo_id = v_disp AND setor_id = v_orfao.setor_id;
        SELECT count(*) INTO v_depois FROM public.fn_setores_sem_relogio(NULL, NULL);
        IF v_depois <> v_antes THEN
            RAISE EXCEPTION 'ABORTADO: o ensaio nao foi revertido (voltou % de %).', v_depois, v_antes;
        END IF;
        RAISE NOTICE 'ok  4.4 vincular tira o setor da lista (% -> % -> %), ensaio revertido',
                     v_antes, v_antes - 1, v_depois;
    END IF;

    -- 4.5 fn_setor_sem_relogio concorda com fn_setores_sem_relogio, setor a setor. Duas
    --     respostas para a mesma pergunta divergem na primeira mudanca se ninguem conferir.
    SELECT count(*) INTO v_n
      FROM public.setores s
     WHERE public.fn_setor_sem_relogio(s.id)
       AND NOT EXISTS (SELECT 1 FROM public.fn_setores_sem_relogio(NULL, NULL) o
                        WHERE o.setor_id = s.id)
       AND public.fn_escopo_gestao_alcanca(s.unidade_id);
    IF v_n > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % setor(es) que fn_setor_sem_relogio acusa nao aparecem na lista.', v_n;
    END IF;
    SELECT count(*) INTO v_n
      FROM public.fn_setores_sem_relogio(NULL, NULL) o
     WHERE NOT public.fn_setor_sem_relogio(o.setor_id);
    IF v_n > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % setor(es) da lista que fn_setor_sem_relogio diz estarem cobertos.', v_n;
    END IF;
    RAISE NOTICE 'ok  4.5 as duas funcoes de deteccao concordam nos dois sentidos';

    -- 4.6 Privilegios.
    IF has_function_privilege('anon', 'public.fn_setores_sem_relogio(integer, integer)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.fn_relogios_sugeridos_para_setor(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.fn_setor_sem_relogio(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.fn_vincular_setor_a_relogios(uuid, uuid[])', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon pode executar alguma das funcoes novas.';
    END IF;
    RAISE NOTICE 'ok  4.6 anon fora das quatro funcoes novas';
END;
$conf$;
