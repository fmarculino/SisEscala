-- ============================================================================
-- RECONCILIACAO PENDENTE NA GRADE DE ESCALA
--
-- O PROBLEMA (medido em producao em 08/09/2026, competencia 09/2026)
--   Quando a escala e lancada DEPOIS de a batida chegar, ninguem reprojeta.
--   fn_ingerir_afd reconcilia o dia DA BATIDA, e trg_reconciliar_apos_marcacao
--   e inerte enquanto nenhuma unidade estiver em fonte_ponto_oficial='rep'.
--   Resultado: a batida esta em marcacoes_ponto, a alocacao sabe a resposta, e a
--   celula da grade fica vazia. Hoje o coordenador resolve isso clicando celula a
--   celula no modal de validacao manual.
--
--   Dias ja passados de 09/2026, celulas com turno lancado:
--     - 1.333 sem presenca nenhuma (321 com batida fisica no dia)
--     -   376 com presenca parcial  (355 com batida fisica no dia)
--   Rodando fn_projecao_marcacoes_dia nos 619 pares (servidor, dia) resultantes:
--     - 275 pares em que reconciliar SO ACRESCENTA -> 720 horarios recuperados
--     -  20 pares em que o dia tem troca ou perda junto
--     - 324 sem ganho nenhum (a projecao recusa a batida, e a recusa esta certa)
--
-- POR QUE NAO E "PREENCHER O QUE ESTA VAZIO"
--   Caso real de 07/09/2026: a batida das 21:49 esta gravada hoje como SAIDA, e a
--   projecao diz que ela e a ENTRADA (a saida e 10:03 do dia seguinte). Preencher
--   so o campo vazio deixaria o dia com entrada 21:49 E saida 21:49 -- jornada
--   zero, pior que o estado atual, que ao menos e visivelmente incompleto.
--   Por isso a unidade de decisao e o PAR (servidor, dia), nunca o campo: so entra
--   na fila automatica o dia em que a reconciliacao exclusivamente ACRESCENTA.
--   Os demais continuam indo para o modal de validacao manual, um a um.
--
-- POR QUE UM ENVELOPE, E NAO UMA ALTERACAO EM fn_reconciliar_marcacoes_dia
--   Armadilha 1: as funcoes de presenca nao se alteram, se envolvem.
--   fn_reconciliar_marcacoes_dia e caminho de MAQUINA (GRANT so a service_role):
--   nao confere papel, escopo nem escala Fechada, porque quem a chama hoje e a
--   ingestao do AFD. Expo-la ao coordenador exige um envelope que confira tudo
--   isso -- e a checagem tem que estar no BANCO, nunca so na Server Action
--   (armadilha 33: Server Action e um POST chamavel direto).
--
-- ATENCAO: A ELEGIBILIDADE E RECALCULADA NA HORA DE APLICAR.
--   A previa que a tela mostra e uma leitura; entre ela e o clique pode chegar
--   batida nova pelo coletor. fn_reconciliar_dia_pendente refaz a conta e
--   recusa se o dia deixou de ser "so acrescenta". Confiar no que o cliente
--   mandou seria a armadilha 12 outra vez.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. QUEM PODE
--    Espelha podeValidarPresenca do ScaleGrid: quem ja pode validar presenca
--    celula a celula pode faze-lo em lote. O botao nao cria autoridade nova, so
--    tira o clique repetido.
--    ATENCAO: fn_unidade_no_escopo sozinha NAO basta -- coordenador cujo acesso
--    vem inteiramente de setor vinculado passa por fn_unidade_alcancavel_por_setor.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_pode_reconciliar_presenca(p_unidade_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.get_my_role() IN ('super_admin','admin','rh','rh_unidade','coordenador','ass_adm')
       AND (public.get_my_role() IN ('super_admin','rh')
            OR public.fn_unidade_no_escopo(p_unidade_id)
            OR public.fn_unidade_alcancavel_por_setor(p_unidade_id));
$$;

COMMENT ON FUNCTION public.fn_pode_reconciliar_presenca(uuid) IS
    'Quem pode aplicar a reconciliacao pendente na grade. Espelha podeValidarPresenca do '
    'ScaleGrid: quem valida presenca celula a celula pode faze-lo em lote. Ver 20260908110000.';

REVOKE ALL ON FUNCTION public.fn_pode_reconciliar_presenca(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pode_reconciliar_presenca(uuid) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 2. A PREVIA -- nao escreve nada
--
--    Recebe as escalas mensais da grade e devolve, campo a campo, o que a
--    reconciliacao faria. dia_elegivel e a decisao do PAR: false assim que
--    qualquer campo daquele dia for troca ou perda.
--
--    ATENCAO: o filtro barato vem ANTES da projecao, de proposito. A projecao e
--    cara e a grade pode ter dezenas de servidores; sem o recorte (dia passado,
--    turno lancado, algum passo vazio, batida fisica na vizinhanca) isto
--    encostaria no statement_timeout de 8s do papel authenticated -- armadilha 54.
--
--    ATENCAO: a comparacao e feita contra TODAS as linhas do dia devolvidas pela
--    projecao, nao so contra as candidatas do filtro. Uma linha ja completa que a
--    projecao mudaria e exatamente o que torna o dia inelegivel; deixa-la de fora
--    esconderia o caso que a checagem existe para achar.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_reconciliacao_pendente_escala(uuid[]);

CREATE OR REPLACE FUNCTION public.fn_reconciliacao_pendente_escala(
    p_escala_mensal_ids uuid[]
)
RETURNS TABLE (
    escala_mensal_id uuid,
    servidor_id      uuid,
    servidor_nome    text,
    dia              integer,
    data             date,
    escala_diaria_id uuid,
    categoria        text,
    turno_codigo     text,
    campo            text,
    valor_atual      timestamptz,
    valor_projetado  timestamptz,
    origem_projetada public.marcacao_origem,
    tipo             text,
    dia_elegivel     boolean,
    impedimento      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH cfg AS (
    SELECT COALESCE(
        (SELECT (valor #>> '{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'),
        'America/Sao_Paulo') AS tz
),
hoje AS (
    SELECT (now() AT TIME ZONE (SELECT tz FROM cfg))::date AS d
),
escalas AS (
    SELECT em.id, em.servidor_id, em.mes, em.ano, em.status, em.unidade_id, em.setor_id
      FROM public.escala_mensal em
     WHERE em.id = ANY(p_escala_mensal_ids)
       AND public.fn_pode_reconciliar_presenca(em.unidade_id)
),
candidatos AS (
    SELECT e.id AS escala_mensal_id, e.servidor_id, e.status, e.mes, e.ano,
           make_date(e.ano, e.mes, ed.dia) AS data
      FROM escalas e
      JOIN public.escala_diaria ed ON ed.escala_mensal_id = e.id
     WHERE ed.dicionario_turnos_id IS NOT NULL
       AND ed.categoria <> 'Sobreaviso'
       AND make_date(e.ano, e.mes, ed.dia) < (SELECT d FROM hoje)
       AND (ed.presenca_entrada_em IS NULL
         OR ed.presenca_saida_em IS NULL
         OR ed.presenca_intervalo_saida_em IS NULL
         OR ed.presenca_intervalo_retorno_em IS NULL)
     GROUP BY 1,2,3,4,5,6
),
com_batida AS (
    SELECT c.*
      FROM candidatos c
     WHERE EXISTS (
        SELECT 1 FROM public.marcacoes_ponto mp
         WHERE mp.servidor_id = c.servidor_id
           AND mp.origem IN ('rep','terminal')
           AND mp.ocorrido_em >= (c.data - 1)
           AND mp.ocorrido_em <  (c.data + 2))
),
proj AS (
    SELECT cb.escala_mensal_id, cb.servidor_id, cb.status, cb.mes, cb.ano, cb.data, p.*
      FROM com_batida cb
      CROSS JOIN LATERAL public.fn_projecao_marcacoes_dia(cb.servidor_id, cb.data) p
     WHERE p.confirmada
),
cmp AS (
    SELECT pr.escala_mensal_id, pr.servidor_id, pr.status, pr.mes, pr.ano, pr.data,
           ed.id AS escala_diaria_id, ed.dia, ed.categoria::text AS categoria,
           dt.codigo AS turno_codigo,
           v.campo, v.atual, v.projetado, v.origem
      FROM proj pr
      JOIN public.escala_diaria ed ON ed.id = pr.escala_diaria_id
      LEFT JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
      CROSS JOIN LATERAL (VALUES
          ('entrada'::text,     ed.presenca_entrada_em,           pr.entrada_em,   pr.entrada_origem),
          ('intervalo_saida',   ed.presenca_intervalo_saida_em,   pr.int_saida_em, pr.int_saida_origem),
          ('intervalo_retorno', ed.presenca_intervalo_retorno_em, pr.int_ret_em,   pr.int_ret_origem),
          ('saida',             ed.presenca_saida_em,             pr.saida_em,     pr.saida_origem)
      ) AS v(campo, atual, projetado, origem)
     WHERE v.projetado IS DISTINCT FROM v.atual
),
tipado AS (
    SELECT c.*,
           CASE WHEN c.atual IS NULL     THEN 'ganho'
                WHEN c.projetado IS NULL THEN 'perda'
                ELSE 'troca' END AS tipo,
           CASE WHEN public.fn_competencia_encerrada(c.mes, c.ano) THEN 'competencia_encerrada'
                WHEN c.status = 'Fechada'                          THEN 'escala_fechada'
                ELSE NULL END AS impedimento
      FROM cmp c
),
por_dia AS (
    SELECT t.servidor_id, t.data,
           bool_and(t.tipo = 'ganho' AND t.impedimento IS NULL) AS elegivel
      FROM tipado t
     GROUP BY 1,2
)
SELECT t.escala_mensal_id, t.servidor_id, s.nome::text, t.dia, t.data, t.escala_diaria_id,
       t.categoria, t.turno_codigo::text, t.campo, t.atual, t.projetado, t.origem,
       t.tipo, d.elegivel, t.impedimento
  FROM tipado t
  JOIN por_dia d ON d.servidor_id = t.servidor_id AND d.data = t.data
  JOIN public.servidores s ON s.id = t.servidor_id
 ORDER BY s.nome, t.data, t.categoria, t.campo;
$$;

COMMENT ON FUNCTION public.fn_reconciliacao_pendente_escala(uuid[]) IS
    'Previa read-only do que a reconciliacao faria nas escalas dadas. dia_elegivel e a decisao '
    'do par (servidor, dia): false assim que qualquer campo do dia for troca ou perda. '
    'Nao escreve nada. Ver 20260908110000.';

REVOKE ALL ON FUNCTION public.fn_reconciliacao_pendente_escala(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reconciliacao_pendente_escala(uuid[]) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 3. APLICAR UM DIA
--
--    ATENCAO: relata o que MUDOU, nunca o que foi calculado (armadilha 22/25).
--    fn_reconciliar_marcacoes_dia devolve `atualizadas` = linhas tocadas pelo
--    UPDATE, que e o total de linhas da projecao mesmo quando nada mudou de
--    valor. Aqui o numero vem da diferenca medida antes/depois.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_reconciliar_dia_pendente(uuid, date);

CREATE OR REPLACE FUNCTION public.fn_reconciliar_dia_pendente(
    p_servidor_id uuid,
    p_data        date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_mes        integer := extract(month from p_data)::integer;
    v_ano        integer := extract(year  from p_data)::integer;
    v_escalas    integer;
    v_sem_acesso integer;
    v_fechadas   integer;
    v_ganhos     integer;
    v_conflitos  integer;
    v_mudados    integer;
BEGIN
    -- 3.1 Escopo: aplicar reconcilia o DIA INTEIRO, entao e preciso poder validar
    --     presenca em TODAS as escalas do servidor naquele mes -- inclusive a de
    --     outro setor. Alcancar so uma delas nao autoriza mexer na outra.
    SELECT count(*), count(*) FILTER (WHERE NOT public.fn_pode_reconciliar_presenca(em.unidade_id))
      INTO v_escalas, v_sem_acesso
      FROM public.escala_mensal em
     WHERE em.servidor_id = p_servidor_id AND em.mes = v_mes AND em.ano = v_ano;

    IF COALESCE(v_escalas,0) = 0 THEN
        RETURN jsonb_build_object('status','sem_escala','campos',0,
            'motivo','Este servidor nao tem escala nesta competencia.');
    END IF;

    IF COALESCE(v_sem_acesso,0) > 0 THEN
        RETURN jsonb_build_object('status','acesso_negado','campos',0,
            'motivo','Voce nao tem acesso a todas as escalas deste servidor neste mes.');
    END IF;

    IF public.fn_competencia_encerrada(v_mes, v_ano) THEN
        RETURN jsonb_build_object('status','competencia_encerrada','campos',0,
            'motivo','Competencia encerrada: reabra em Configuracoes.');
    END IF;

    SELECT count(*) INTO v_fechadas
      FROM public.escala_mensal em
     WHERE em.servidor_id = p_servidor_id AND em.mes = v_mes AND em.ano = v_ano
       AND em.status = 'Fechada';

    IF COALESCE(v_fechadas,0) > 0 THEN
        RETURN jsonb_build_object('status','escala_fechada','campos',0,
            'motivo','A escala esta Fechada: reabra antes de aplicar.');
    END IF;

    -- 3.2 Elegibilidade RECALCULADA. A previa da tela e leitura; entre ela e o
    --     clique pode ter chegado batida nova pelo coletor.
    WITH proj AS (
        SELECT * FROM public.fn_projecao_marcacoes_dia(p_servidor_id, p_data) WHERE confirmada
    ), cmp AS (
        SELECT v.atual, v.projetado
          FROM proj p
          JOIN public.escala_diaria ed ON ed.id = p.escala_diaria_id
          CROSS JOIN LATERAL (VALUES
              (ed.presenca_entrada_em,           p.entrada_em),
              (ed.presenca_intervalo_saida_em,   p.int_saida_em),
              (ed.presenca_intervalo_retorno_em, p.int_ret_em),
              (ed.presenca_saida_em,             p.saida_em)
          ) AS v(atual, projetado)
         WHERE v.projetado IS DISTINCT FROM v.atual
    )
    SELECT count(*) FILTER (WHERE atual IS NULL),
           count(*) FILTER (WHERE atual IS NOT NULL)
      INTO v_ganhos, v_conflitos
      FROM cmp;

    IF COALESCE(v_conflitos,0) > 0 THEN
        RETURN jsonb_build_object('status','conflito','campos',0,'conflitos',v_conflitos,
            'motivo','Este dia deixou de ser so acrescimo: ha horario ja gravado que a '
                  || 'reconciliacao mudaria. Resolva pela validacao manual.');
    END IF;

    IF COALESCE(v_ganhos,0) = 0 THEN
        RETURN jsonb_build_object('status','sem_mudanca','campos',0,
            'motivo','Nada a preencher neste dia.');
    END IF;

    -- 3.3 Aplica. p_limpar_sem_marcacao fica FALSE: a limpeza so pode ser ligada
    --     depois do corte por unidades.fonte_ponto_oficial (Fase 5).
    PERFORM public.fn_reconciliar_marcacoes_dia(p_servidor_id, p_data, false);

    -- 3.4 Conta o que de fato ficou gravado.
    WITH proj AS (
        SELECT * FROM public.fn_projecao_marcacoes_dia(p_servidor_id, p_data) WHERE confirmada
    )
    SELECT count(*) INTO v_mudados
      FROM proj p
      JOIN public.escala_diaria ed ON ed.id = p.escala_diaria_id
      CROSS JOIN LATERAL (VALUES
          (ed.presenca_entrada_em,           p.entrada_em),
          (ed.presenca_intervalo_saida_em,   p.int_saida_em),
          (ed.presenca_intervalo_retorno_em, p.int_ret_em),
          (ed.presenca_saida_em,             p.saida_em)
      ) AS v(atual, projetado)
     WHERE v.projetado IS NOT NULL AND v.atual IS NOT DISTINCT FROM v.projetado;

    RETURN jsonb_build_object(
        'status','ok',
        'campos', LEAST(COALESCE(v_ganhos,0), COALESCE(v_mudados,0)),
        'esperados', COALESCE(v_ganhos,0));
END;
$fn$;

COMMENT ON FUNCTION public.fn_reconciliar_dia_pendente(uuid, date) IS
    'Envelope de coordenador para fn_reconciliar_marcacoes_dia: confere papel, escopo, '
    'competencia encerrada e escala Fechada, e SO aplica no dia em que a reconciliacao '
    'exclusivamente acrescenta. Relata o que mudou, nao o que foi calculado. Ver 20260908110000.';

REVOKE ALL ON FUNCTION public.fn_reconciliar_dia_pendente(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reconciliar_dia_pendente(uuid, date) TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA (rodar DEPOIS de aplicar; nenhuma delas escreve)
-- ============================================================================
--
-- 1) A previa nao escreve e classifica:
--
--    SELECT tipo, dia_elegivel, count(*)
--      FROM public.fn_reconciliacao_pendente_escala(
--             ARRAY(SELECT id FROM public.escala_mensal WHERE mes=9 AND ano=2026 LIMIT 50))
--     GROUP BY 1,2 ORDER BY 1,2;
--
-- 2) Invariante central -- NUNCA pode existir linha elegivel que nao seja ganho:
--
--    SELECT count(*) AS deve_ser_zero
--      FROM public.fn_reconciliacao_pendente_escala(
--             ARRAY(SELECT id FROM public.escala_mensal WHERE mes=9 AND ano=2026))
--     WHERE dia_elegivel AND (tipo <> 'ganho' OR impedimento IS NOT NULL);
--
-- 3) anon continua barrado nas tres funcoes (armadilha 24):
--
--    SELECT has_function_privilege('anon',
--             'public.fn_reconciliar_dia_pendente(uuid,date)', 'EXECUTE') AS deve_ser_false;
