-- Migration: a previa de reconciliacao passa a enxergar batida retida por reversao
-- Data: 2026-09-17
-- Plano: docs/planos/2026-09-17-batida-que-nao-alcanca-a-escala-certa.md (defeito D2, fase a)
-- Gerada por scratchpad/gen_batida_retida.js a partir de
--   20260908110000_reconciliacao_pendente_na_grade.sql (copia mecanica, armadilha 1).
--   NAO EDITAR A MAO: regenere pelo script, que aborta se a fonte divergir.
--
-- O QUE ESTAVA ERRADO
--   fn_sincronizar_marcacoes_escala_diaria grava 'desconsiderar' sempre que um UPDATE zera um
--   passo de presenca -- e o trigger nao sabe POR QUE o passo esta sendo zerado. Quem reverte
--   para corrigir a escala e relancar o dia perde a batida REAL junto, e a partir dai
--   fn_alocar_marcacoes_dia a filtra. O "Preencher pelas Batidas" entao responde
--   "Nada a preencher neste dia" (quando a reversao levou TODAS as candidatas) ou recusa por
--   'conflito' sem dizer que a causa e reversivel.
--
--   Medido em producao em 17/09/2026: 1.166 tratamentos 'desconsiderar' vigentes, 1.092 deles
--   com a justificativa automatica da reversao; 173 sao batida FISICA (146 rep + terminal nao
--   sintetica); 20 dias tem escala hoje com passo vazio e 16 deles a tela fica MUDA.
--   So em 17/09 foram 47 batidas rep tiradas de circulacao, em 14 servidores.
--
--   Caso real (THAYNA, mat 69051, 03/09/2026): quatro batidas do turno Regular MT -- 07:08,
--   14:51, 15:51 e 19:00 -- foram desconsideradas em 17/09 entre 15:46 e 15:47. A linha do MT
--   ficou vazia e reconciliado_em NUNCA; com quatro das sete candidatas fora, a projecao passou
--   a propor TROCAR a entrada em 176 min e PERDER o intervalo, e o botao recusou.
--
-- O QUE ESTA MIGRATION FAZ, E O QUE ELA NAO FAZ
--   FAZ: as duas superficies do "Preencher pelas Batidas" passam a contar as batidas fisicas
--   desconsideradas do dia e a dize-lo -- a previa com uma linha de diagnostico propria
--   (tipo 'batida_retida', dia_elegivel = false) e a aplicacao com um status proprio.
--   NAO FAZ: nao restaura nada e nao reconcilia nada por conta propria. Repor batida em
--   circulacao e ato de quem tem autoridade -- fn_restaurar_batidas_dia (20260917160000).
--
-- 🚨 ASSINATURA NOVA E OBJETO NOVO (armadilhas 24 e 41)
--   fn_reconciliacao_pendente_escala ganha a coluna batidas_retidas no RETURNS TABLE, e
--   CREATE OR REPLACE NAO altera a lista de colunas (42P13). A assinatura antiga e derrubada
--   com DROP explicito -- sem CASCADE, para um dependente de verdade dar erro em vez de sumir
--   em silencio -- e os privilegios sao REESCRITOS aqui: objeto novo nasce com EXECUTE para
--   PUBLIC.
--
-- ORDEM DE DEPLOY
--   A coluna nova e ACRESCENTADA no fim do RETURNS TABLE e o frontend le por nome, entao o
--   bundle anterior continua funcionando. O status 'batida_retida' e novo: a tela antiga cai
--   no ramo generico e mostra o 'motivo', que ja e legivel.


-- ============================================================================
-- 1. FONTE UNICA: o que e "batida fisica" e quais estao retidas
-- ============================================================================
-- ⚠️ "Batida fisica" nao e "origem rep ou terminal". marcacoes_ponto de origem 'terminal' e
--    sintetica = true sao os timestamps FABRICADOS por fn_salvar_saida_bloco (ate 5 por
--    batida) -- 533 delas so em 08/2026. Restaurar ou contabilizar essas seria tratar
--    horario inventado como fato. ajuste_coordenador / ajuste_servidor sao declaracao de
--    alguem, e tambem ficam de fora: quem as reverteu esta desfazendo a propria declaracao.

CREATE OR REPLACE FUNCTION public.fn_batida_fisica(
    p_origem    public.marcacao_origem,
    p_sintetica boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
    SELECT p_origem = 'rep'
        OR (p_origem = 'terminal' AND COALESCE(p_sintetica, false) = false);
$fn$;

COMMENT ON FUNCTION public.fn_batida_fisica(public.marcacao_origem, boolean) IS
    'True quando a marcacao e uma batida que a pessoa deu num equipamento: rep sempre, e '
    'terminal apenas quando NAO for sintetica (as sinteticas sao fabricadas por '
    'fn_salvar_saida_bloco). FONTE UNICA -- nao replicar o predicado.';

REVOKE ALL ON FUNCTION public.fn_batida_fisica(public.marcacao_origem, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_batida_fisica(public.marcacao_origem, boolean) TO authenticated, service_role;


-- As batidas fisicas do dia que estao fora de circulacao AGORA.
-- A janela D-1 .. D+2 e a MESMA de fn_reconciliacao_pendente_escala: um turno que atravessa a
-- meia-noite tem batida nos dois dias civis, e uma janela mais estreita esconderia metade delas.
CREATE OR REPLACE FUNCTION public.fn_batidas_retidas_dia(
    p_servidor_id uuid,
    p_data        date
)
RETURNS TABLE (
    marcacao_id uuid,
    origem      public.marcacao_origem,
    ocorrido_em timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT m.id, m.origem, m.ocorrido_em
      FROM public.marcacoes_ponto m
     WHERE m.servidor_id = p_servidor_id
       AND public.fn_batida_fisica(m.origem, m.sintetica)
       AND m.ocorrido_em >= (p_data - 1)
       AND m.ocorrido_em <  (p_data + 2)
       AND public.fn_marcacao_desconsiderada(m.id)
     ORDER BY m.ocorrido_em;
$fn$;

COMMENT ON FUNCTION public.fn_batidas_retidas_dia(uuid, date) IS
    'Batidas fisicas do dia que estao fora de circulacao agora (ultimo tratamento = '
    'desconsiderar). Janela D-1..D+2, a mesma da previa de reconciliacao, porque turno que '
    'atravessa a meia-noite tem batida nos dois dias civis.';

REVOKE ALL ON FUNCTION public.fn_batidas_retidas_dia(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_batidas_retidas_dia(uuid, date) TO authenticated, service_role;


-- ============================================================================
-- 2. A PREVIA (copia mecanica; so o que esta marcado no gerador mudou)
-- ============================================================================
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
    impedimento      text,
    batidas_retidas  integer
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
-- Batidas FISICAS que uma reversao tirou de circulacao neste dia. Elas existem, estao
-- gravadas e corretas -- e fn_alocar_marcacoes_dia as filtra, entao a projecao nao as ve.
-- Sem esta contagem, o dia ou some da lista (a projecao iguala o atual) ou aparece como
-- troca/perda sem dizer que a causa e reversivel. Ver 20260917140000.
retidas AS (
    SELECT c.escala_mensal_id, c.servidor_id, c.status, c.mes, c.ano, c.data,
           count(*)::integer AS n
      FROM candidatos c
      JOIN public.marcacoes_ponto mp
        ON mp.servidor_id = c.servidor_id
       AND mp.ocorrido_em >= (c.data - 1)
       AND mp.ocorrido_em <  (c.data + 2)
       AND public.fn_batida_fisica(mp.origem, mp.sintetica)
       AND public.fn_marcacao_desconsiderada(mp.id)
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
       t.tipo, d.elegivel, t.impedimento, COALESCE(r.n, 0)
  FROM tipado t
  JOIN por_dia d ON d.servidor_id = t.servidor_id AND d.data = t.data
  JOIN public.servidores s ON s.id = t.servidor_id
  LEFT JOIN retidas r ON r.escala_mensal_id = t.escala_mensal_id AND r.data = t.data

UNION ALL

-- LINHA DE DIAGNOSTICO. O dia cuja projecao iguala o atual nao produz nenhuma linha em
-- cmp (ela filtra projetado IS DISTINCT FROM atual) -- e e exatamente o caso em que a
-- reversao levou TODAS as candidatas: a tela respondia "Nada a preencher neste dia" com
-- batida real retida no banco. Aqui o dia aparece, com campo e tipo proprios e
-- dia_elegivel = false: e diagnostico, nunca algo a aplicar.
SELECT r.escala_mensal_id, r.servidor_id, s.nome::text,
       extract(day from r.data)::integer, r.data, NULL::uuid,
       NULL::text, NULL::text, 'batida_retida'::text, NULL::timestamptz, NULL::timestamptz,
       NULL::public.marcacao_origem,
       'batida_retida'::text, false, 'batida_retida'::text, r.n
  FROM retidas r
  JOIN public.servidores s ON s.id = r.servidor_id
-- ⚠️ O casamento e por (escala_mensal_id, data), NUNCA por (servidor_id, data): o servidor
-- pode ter DUAS escalas no mes (outro setor), e retidas tem uma linha por escala. Por
-- servidor, o LEFT JOIN acima DUPLICARIA cada divergencia, e o diagnostico abaixo sumiria da
-- segunda escala sempre que a primeira tivesse qualquer linha.
 WHERE NOT EXISTS (
     SELECT 1 FROM tipado t2
      WHERE t2.escala_mensal_id = r.escala_mensal_id AND t2.data = r.data)

 ORDER BY 3, 5, 7, 9;
$$;

REVOKE ALL ON FUNCTION public.fn_reconciliacao_pendente_escala(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reconciliacao_pendente_escala(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_reconciliacao_pendente_escala(uuid[]) IS
    'Previa read-only do que a reconciliacao faria nas escalas dadas. dia_elegivel e a decisao '
    'do par (servidor, dia): false assim que qualquer campo do dia for troca ou perda. '
    'batidas_retidas conta as batidas FISICAS que uma reversao tirou de circulacao naquele dia, '
    'e o tipo batida_retida e a linha de diagnostico do dia que so tem isso. Nao escreve nada.';


-- ============================================================================
-- 3. A APLICACAO (copia mecanica; so o que esta marcado no gerador mudou)
-- ============================================================================

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
    v_retidas    integer;
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

    -- Batidas FISICAS que uma reversao tirou de circulacao. NAO sao restauradas aqui: isto
    -- e um caminho de preenchimento, e repor batida em circulacao e ato de quem tem
    -- autoridade (fn_restaurar_batidas_dia). O que muda e que o dia deixa de responder
    -- "nada a preencher" quando existe batida real retida no banco.
    SELECT count(*)::integer INTO v_retidas
      FROM public.fn_batidas_retidas_dia(p_servidor_id, p_data);

    IF COALESCE(v_conflitos,0) > 0 THEN
        RETURN jsonb_build_object('status','conflito','campos',0,'conflitos',v_conflitos,
            'motivo','Este dia deixou de ser so acrescimo: ha horario ja gravado que a '
                  || 'reconciliacao mudaria. Resolva pela validacao manual.'
                  || CASE WHEN COALESCE(v_retidas,0) > 0
                          THEN ' Atencao: ' || v_retidas::text || ' batida(s) real(is) deste '
                            || 'dia foram tiradas de circulacao por uma reversao -- restaure-as '
                            || 'antes, porque sem elas a projecao trabalha com menos batidas do '
                            || 'que houve.'
                          ELSE '' END,
            'batidas_retidas', COALESCE(v_retidas,0));
    END IF;

    IF COALESCE(v_ganhos,0) = 0 THEN
        IF COALESCE(v_retidas,0) > 0 THEN
            RETURN jsonb_build_object('status','batida_retida','campos',0,
                'batidas_retidas', v_retidas,
                'motivo', v_retidas::text || ' batida(s) real(is) deste dia foram tiradas de '
                       || 'circulacao por uma reversao de presenca. Elas continuam gravadas: '
                       || 'restaure-as para que possam ser aplicadas.');
        END IF;
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

-- fn_reconciliar_dia_pendente e CREATE OR REPLACE sobre a MESMA assinatura (nao ha coluna nova
-- a declarar), entao ela conserva os privilegios. Reafirmados assim mesmo: custa uma linha e
-- torna a migration reaplicavel sobre um banco onde alguem tenha mexido nisso.
REVOKE ALL ON FUNCTION public.fn_reconciliar_dia_pendente(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reconciliar_dia_pendente(uuid, date) TO authenticated, service_role;


-- ============================================================================
-- 4. CONFERENCIA -- EXECUTA as funcoes, nunca so checa se existem (armadilha 42)
-- ============================================================================
-- 🚨 Conferir que a funcao EXISTE nao serve: plpgsql e SQL so resolvem nome de coluna, de
--    funcao e operador na EXECUCAO. A 20260916100000 so nao foi a producao quebrada porque a
--    conferencia dela chamava a funcao.
DO $conf$
DECLARE
    v_cols     integer;
    v_res      text;
    v_srv      uuid;
    v_r        jsonb;
    v_n        integer;
BEGIN
    -- 4.1 A coluna nova existe, E ha exatamente UMA fn_reconciliacao_pendente_escala.
    -- ⚠️ A leitura e por pg_get_function_result, nao por information_schema.parameters: ali as
    --    colunas de um RETURNS TABLE nao aparecem com parameter_mode = 'TABLE' de forma
    --    confiavel, e a primeira versao desta conferencia abortou por isso em homologacao com
    --    a funcao JA correta -- conferencia que reprova o certo e pior que conferencia nenhuma.
    SELECT count(*) INTO v_cols
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_reconciliacao_pendente_escala';
    -- ⚠️ RAISE EXCEPTION exige string LITERAL: 'a ' || 'b' da 42601, e so na EXECUCAO do
    --    CREATE -- nenhum tsc/build alcanca. Foi o que derrubou a primeira aplicacao desta
    --    conferencia em homologacao.
    IF v_cols <> 1 THEN
        RAISE EXCEPTION 'ABORTADO: ha % versao(oes) de fn_reconciliacao_pendente_escala (esperado 1). Sobrecarga faz o PostgREST devolver PGRST203 (armadilha 41).', v_cols;
    END IF;

    SELECT pg_get_function_result(p.oid) INTO v_res
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_reconciliacao_pendente_escala';
    IF v_res IS NULL OR v_res NOT LIKE '%batidas_retidas integer%' THEN
        RAISE EXCEPTION 'ABORTADO: fn_reconciliacao_pendente_escala nao expoe batidas_retidas. Retorno: %', v_res;
    END IF;
    -- O OUTRO SENTIDO: as colunas antigas nao podem ter sumido -- a grade le por nome.
    IF v_res NOT LIKE '%dia_elegivel boolean%' OR v_res NOT LIKE '%impedimento text%'
       OR v_res NOT LIKE '%valor_projetado timestamp with time zone%' THEN
        RAISE EXCEPTION 'ABORTADO: fn_reconciliacao_pendente_escala PERDEU coluna que a grade le. Retorno: %', v_res;
    END IF;

    -- 4.2 fn_batida_fisica: os QUATRO sentidos. Fechar demais aqui faria a contagem ignorar
    --     batida de terminal legitima; abrir demais faria horario FABRICADO contar como fato.
    IF NOT public.fn_batida_fisica('rep', false)                 THEN RAISE EXCEPTION 'ABORTADO: rep nao-sintetica deveria ser fisica.'; END IF;
    IF NOT public.fn_batida_fisica('rep', true)                  THEN RAISE EXCEPTION 'ABORTADO: rep e SEMPRE fisica (o AFD grava com precisao de minuto, entao sintetica nao se aplica a ela).'; END IF;
    IF NOT public.fn_batida_fisica('terminal', false)            THEN RAISE EXCEPTION 'ABORTADO: terminal nao-sintetica deveria ser fisica.'; END IF;
    IF     public.fn_batida_fisica('terminal', true)             THEN RAISE EXCEPTION 'ABORTADO: terminal SINTETICA nao pode contar como batida (fn_salvar_saida_bloco fabrica ate 5 por batida).'; END IF;
    IF     public.fn_batida_fisica('ajuste_coordenador', false)  THEN RAISE EXCEPTION 'ABORTADO: ajuste_coordenador e declaracao, nao batida.'; END IF;
    IF     public.fn_batida_fisica('ajuste_servidor', false)     THEN RAISE EXCEPTION 'ABORTADO: ajuste_servidor e declaracao, nao batida.'; END IF;
    IF NOT public.fn_batida_fisica('terminal', NULL)             THEN RAISE EXCEPTION 'ABORTADO: sintetica NULA deve cair para nao-sintetica (COALESCE).'; END IF;

    -- 4.3 EXECUTA a previa e a aplicacao contra um servidor real, sem escrever nada.
    --     fn_reconciliar_dia_pendente so escreve quando ha ganho puro; uma data sem escala
    --     nenhuma devolve 'sem_escala' antes de qualquer UPDATE.
    SELECT id INTO v_srv FROM public.servidores WHERE status = 'Ativo' LIMIT 1;
    IF v_srv IS NULL THEN
        RAISE NOTICE 'sem servidor Ativo para a sonda -- pulando 4.3';
    ELSE
        PERFORM 1 FROM public.fn_batidas_retidas_dia(v_srv, '1900-01-01'::date);
        v_r := public.fn_reconciliar_dia_pendente(v_srv, '1900-01-01'::date);
        IF v_r IS NULL OR v_r->>'status' IS NULL THEN
            RAISE EXCEPTION 'ABORTADO: fn_reconciliar_dia_pendente nao devolveu status.';
        END IF;
        RAISE NOTICE 'sonda da aplicacao: status=%', v_r->>'status';
    END IF;

    -- 4.4 A previa executa com lista vazia (caminho que a grade usa quando nada e selecionado)
    SELECT count(*) INTO v_n FROM public.fn_reconciliacao_pendente_escala(ARRAY[]::uuid[]);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'ABORTADO: previa com lista vazia devolveu % linha(s).', v_n;
    END IF;

    -- 4.5 anon NAO executa nenhuma das duas funcoes novas (armadilha 24)
    IF has_function_privilege('anon', 'public.fn_batida_fisica(public.marcacao_origem, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon ainda executa fn_batida_fisica.';
    END IF;
    IF has_function_privilege('anon', 'public.fn_batidas_retidas_dia(uuid, date)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon ainda executa fn_batidas_retidas_dia.';
    END IF;
    IF has_function_privilege('anon', 'public.fn_reconciliacao_pendente_escala(uuid[])', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon ainda executa fn_reconciliacao_pendente_escala.';
    END IF;
    IF has_function_privilege('anon', 'public.fn_reconciliar_dia_pendente(uuid, date)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon ainda executa fn_reconciliar_dia_pendente -- ela ESCREVE presenca.';
    END IF;

    -- 4.6 O OUTRO SENTIDO: authenticated NAO pode ter perdido a previa -- a grade chama com
    --     a sessao do coordenador, e revogar ali derruba o botao inteiro.
    IF NOT has_function_privilege('authenticated', 'public.fn_reconciliacao_pendente_escala(uuid[])', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated PERDEU fn_reconciliacao_pendente_escala.';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.fn_batidas_retidas_dia(uuid, date)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated PERDEU fn_batidas_retidas_dia.';
    END IF;

    RAISE NOTICE 'batida retida na previa: ok.';
END;
$conf$;
