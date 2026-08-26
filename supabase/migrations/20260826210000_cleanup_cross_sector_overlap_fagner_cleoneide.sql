-- Migration: Limpeza da sobreposicao de escala entre setores (FAGNER e CLEONEIDE, 08/2026)
--
-- CONTEXTO MEDIDO EM 26/08/2026 (producao, 5 competencias, 21.031 linhas de escala_diaria):
--   24 pares (servidor, dia) tinham o MESMO servidor escalado em DOIS setores no mesmo dia com
--   slots sobrepostos. Sao 2 servidoras, todas as linhas em 08/2026, todas as escalas em
--   Rascunho. Nenhuma competencia Fechada foi tocada.
--
--   FAGNER SOARES CARDOSO (15234)  5 dias  TRANSPORTE/MT  x  PATRIMONIO/M
--   CLEONEIDE MENEZ FRANK (61399) 19 dias  PSE/MT         x  E-SUS/MT
--
-- COMO ACONTECEU
--   "Aplicar Template" preenche a grade sem consultar as outras escalas do servidor: ele so
--   olha presenca confirmada e afastamento, ambos DENTRO da propria grade. fn_check_shift_conflicts
--   existe e detectaria o caso, mas tem um unico chamador em todo o repositorio -
--   handleCellChange, ou seja, so a digitacao celula a celula. Template, Gerador Inteligente e
--   "Salvar Previsao" nunca a consultaram, e nao existia trigger nenhum no banco. A trava entra
--   na migration seguinte (20260826220000); esta aqui so limpa o que ja foi gravado, porque
--   enquanto as 24 linhas existirem a trava impede os 4 setores de salvar qualquer coisa em
--   08/2026.
--
--   No FAGNER a causa raiz foi uma TRANSFERENCIA de setor: ele esteve no PATRIMONIO ate o dia 7
--   e passou ao TRANSPORTE a partir do dia 10. O template aplicado na grade do TRANSPORTE em
--   14 e 18/08 varreu o mes inteiro a partir do dia 3 e alcancou dias que ainda eram do
--   PATRIMONIO. Por isso quem fica com os dias 3-7 e o PATRIMONIO, e nao o setor da lotacao
--   atual. Confirmado pelos dados: o PATRIMONIO tem exatamente os dias 3 a 7 e nada mais, e as
--   batidas reais de terminal existem so nesses dias.
--
-- POR QUE NAO BASTA APAGAR A LINHA DE escala_diaria
--   O "validar dias passados" do template gravou presenca na grade, e o trigger de
--   20260808070000_sync_marcacoes_from_escala_diaria converte isso em marcacoes_ponto sinteticas
--   de origem ajuste_coordenador - uma serie POR SETOR. Em 08/2026: 128 da CLEONEIDE e 27 do
--   FAGNER, contra 5 e 7 batidas reais. marcacoes_ponto e INSERT-only (o trigger de
--   20260808010000 bloqueia UPDATE/DELETE), entao apagar a linha de escala_diaria deixaria as
--   sinteticas vivas e a reconciliacao as reprojetaria na linha que sobrou. A porta correta e
--   marcacoes_tratamentos com tipo = 'desconsiderar', que fn_alocar_marcacoes_dia ja honra
--   (o efetivo e o ULTIMO tratamento por created_at).
--
-- O QUE NAO E DESCONSIDERADO, DE PROPOSITO
--   As batidas REAIS de terminal do FAGNER nos dias 6 e 7 (16:00 e 17:38) ficam. Removida a
--   linha do TRANSPORTE, elas passam a disputar o passo de saida e ganham do ajuste_coordenador
--   das 14:00 por precedencia (terminal 2 < ajuste_coordenador 3). Isso pode gerar hora extra
--   contra a jornada que acaba as 14:00, e e o resultado CORRETO: batida real ganha de
--   declaracao. Quem decide o que fazer com esse extra e o coordenador, caso a caso.
--
-- DEPOIS DE APLICAR, NO APP: clicar em "Sincronizar" nas 4 folhas de 08/2026 (FAGNER
--   PATRIMONIO e TRANSPORTE; CLEONEIDE E-SUS e PSE). folha_ponto.registros e snapshot jsonb,
--   nao view - corrigir escala_diaria nao alcanca a folha sozinho.
--
-- IDEMPOTENTE
--   DELETE por id explicito (no-op se ja removido), INSERT de tratamento com NOT EXISTS sobre
--   uma justificativa marcada, e a reconciliacao e por natureza reexecutavel.

-- ============================================================================
-- 1. APAGAR AS LINHAS DO SETOR QUE NAO FICA COM O DIA
-- ============================================================================

-- FAGNER - TRANSPORTE (escala_mensal 7114182d-be8d-491f-a7d6-609fd99e4ec4), dias 3 a 7.
-- Ele ainda estava no PATRIMONIO nesses dias. Os dias 10 em diante ficam intactos.
DELETE FROM public.escala_diaria WHERE id IN (
    '09c0c911-eada-409d-99c5-9c396ad859b8',  -- dia 3  MT
    'aef43119-14dd-4172-b419-06865416a42f',  -- dia 4  MT
    'b3b70b6a-e79c-4ee1-a40a-3e4fec641730',  -- dia 5  MT
    '8501e6a0-d663-4c06-bf21-4525c3dc1166',  -- dia 6  MT
    'dc0485d7-3fb2-439e-8677-34cb85666476'   -- dia 7  MT
);

-- CLEONEIDE - PSE (escala_mensal 8c3cc05f-b5c2-4ed6-9b8c-0ba5b58acfb2), os 19 dias.
-- Ela foi adicionada ao PSE e ao E-SUS em 25/08/2026 com 15 minutos de diferenca, e o mesmo
-- template 5x2 foi aplicado nos dois. Fica o E-SUS, que e a lotacao.
DELETE FROM public.escala_diaria WHERE id IN (
    'f396b3b9-92b3-4582-9e35-d4710a70260d',  -- dia 3
    '1884414c-c44f-43e1-aee3-e237d433c5e2',  -- dia 4
    '2c96d340-6441-4897-951a-64390e3b601f',  -- dia 5
    '88e7cb30-fe5b-48c9-9bf8-896ffb8ac411',  -- dia 6
    'f93a8b52-19d6-4db3-aba0-218c42ae60ad',  -- dia 7
    '9b5a0439-33ed-40a2-a635-b023a18317fb',  -- dia 10
    'a0f79b4b-3c99-45b7-bc55-459cfa4c5a16',  -- dia 11
    '4c311372-1db8-4d62-96c2-421d7e37a54d',  -- dia 12
    '1a426ae6-8982-46f4-b62f-9669336a1713',  -- dia 13
    '7b366c47-e0f6-45ca-be2a-12c6bde17b7e',  -- dia 14
    '1d3ebef2-ce98-4fd5-bc4a-3e962f37858b',  -- dia 17
    '589cc489-8736-4866-8d75-88c466487b72',  -- dia 18
    'e27c24b9-059c-4d4d-abb2-3a7ff99ce160',  -- dia 19
    '54c697fd-ccd1-47f4-8bf1-c78714dec4ba',  -- dia 20
    '0913fd21-a28a-4d89-a2c7-c847e5e841ad',  -- dia 21
    '3bb317cd-f9bb-4f96-94a9-16fdefa0ccd3',  -- dia 24
    '6de9ddc3-1aeb-485e-992a-5ed52878c757',  -- dia 25
    '9f535f39-142f-4813-af51-1b974214b58f',  -- dia 26
    'a22ed3e6-4eb9-4dc3-87b4-61551d2a5f90'   -- dia 27
);


-- ============================================================================
-- 2. DESCONSIDERAR AS MARCACOES SINTETICAS GERADAS PELO SETOR REMOVIDO
-- ============================================================================
-- Escopo estreito de proposito: so marcacao SINTETICA, so origem ajuste_coordenador, so do
-- setor que saiu, so nos dias afetados. Batida real (terminal/rep) NUNCA entra aqui.

DO $lim$
DECLARE
    v_autor uuid;
    v_tz    text;
    v_n     integer;
BEGIN
    SELECT id INTO v_autor
      FROM public.profiles
     WHERE role = 'super_admin' AND ativo IS DISTINCT FROM false
     ORDER BY created_at
     LIMIT 1;

    IF v_autor IS NULL THEN
        RAISE EXCEPTION 'Nenhum profile super_admin encontrado para autorar os tratamentos';
    END IF;

    v_tz := COALESCE((SELECT (valor#>>'{}')::text FROM public.configuracoes_globais
                       WHERE chave = 'timezone'), 'America/Sao_Paulo');

    INSERT INTO public.marcacoes_tratamentos (marcacao_id, tipo, justificativa, registrado_por_id)
    SELECT m.id,
           'desconsiderar',
           'Sobreposicao de escala entre setores: marcacao sintetica gerada pelo Aplicar Template '
           || 'do setor removido da escala em 26/08/2026. Ver migration 20260826210000.',
           v_autor
      FROM public.marcacoes_ponto m
     WHERE m.sintetica IS TRUE
       AND m.origem = 'ajuste_coordenador'
       AND (
             -- FAGNER: sinteticas do TRANSPORTE nos dias 3 a 7
             (    m.servidor_id = '9c7b7695-6675-4c46-b0e5-1af6793c49e3'
              AND m.setor_id    = '860d9a23-1f86-4e73-bd53-8e721322c5f1'
              AND (m.ocorrido_em AT TIME ZONE v_tz)::date
                  = ANY (ARRAY['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07']::date[]))
          OR
             -- CLEONEIDE: sinteticas do PSE nos 19 dias
             (    m.servidor_id = 'f2c69c5f-f318-479d-b528-cc3b10ce00e7'
              AND m.setor_id    = '3192f4aa-530c-4bc2-806e-4e6104bacd21'
              AND (m.ocorrido_em AT TIME ZONE v_tz)::date
                  = ANY (ARRAY['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07',
                               '2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14',
                               '2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21',
                               '2026-08-24','2026-08-25','2026-08-26','2026-08-27']::date[]))
           )
       AND NOT EXISTS (
             SELECT 1 FROM public.marcacoes_tratamentos t
              WHERE t.marcacao_id = m.id
                AND t.tipo = 'desconsiderar'
                AND t.justificativa LIKE '%migration 20260826210000%');

    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'Tratamentos desconsiderar inseridos: %', v_n;
END
$lim$;


-- ============================================================================
-- 2b. RESTAURAR AS BATIDAS REAIS QUE A REVERSAO DA GRADE TINHA DESCONSIDERADO
-- ============================================================================
-- Descoberto ao conferir o passo 3: em 26/08/2026, as 21:49, alguem limpou na grade a presenca
-- do PATRIMONIO (que na epoca parecia ser o setor errado). Essa reversao registra
-- 'desconsiderar' automatico - e ela alcanca TAMBEM a batida real de terminal, nao so o horario
-- sintetico. Resultado: a alocacao do dia nao enxergava mais nada e fn_projecao_marcacoes_dia
-- devolvia vazio para os dias 4 a 7.
--
-- Como o PATRIMONIO e quem fica com esses dias, a batida real precisa voltar. O ultimo
-- tratamento por created_at e o efetivo, entao um 'restaurar' desfaz o 'desconsiderar'.
--
-- SO batida REAL volta (sintetica = false, origem terminal/rep). O horario SINTETICO declarado
-- pelo coordenador (a saida das 14:00) fica desconsiderado de proposito: batida e fato e nao
-- pode se perder, declaracao e juizo e o coordenador acabou de retirar o dele. Se ele quiser
-- declarar de novo, valida pela tela. Nunca fabricar horario.

DO $res$
DECLARE
    v_autor uuid;
    v_tz    text;
    v_n     integer;
BEGIN
    SELECT id INTO v_autor
      FROM public.profiles
     WHERE role = 'super_admin' AND ativo IS DISTINCT FROM false
     ORDER BY created_at
     LIMIT 1;

    v_tz := COALESCE((SELECT (valor#>>'{}')::text FROM public.configuracoes_globais
                       WHERE chave = 'timezone'), 'America/Sao_Paulo');

    INSERT INTO public.marcacoes_tratamentos (marcacao_id, tipo, justificativa, registrado_por_id)
    SELECT m.id,
           'restaurar',
           'Batida REAL restaurada: fora desconsiderada pela reversao automatica da grade em '
           || '26/08/2026, quando o dia pertencia ao setor errado. O setor correto ficou com o '
           || 'dia. Ver migration 20260826210000.',
           v_autor
      FROM public.marcacoes_ponto m
     WHERE m.sintetica IS FALSE
       AND m.origem IN ('terminal', 'rep')
       AND (
             (    m.servidor_id = '9c7b7695-6675-4c46-b0e5-1af6793c49e3'
              AND (m.ocorrido_em AT TIME ZONE v_tz)::date
                  = ANY (ARRAY['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07']::date[]))
          OR
             (    m.servidor_id = 'f2c69c5f-f318-479d-b528-cc3b10ce00e7'
              AND (m.ocorrido_em AT TIME ZONE v_tz)::date
                  = ANY (ARRAY['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07',
                               '2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14',
                               '2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21',
                               '2026-08-24','2026-08-25','2026-08-26','2026-08-27']::date[]))
           )
       -- so onde o tratamento EFETIVO (o mais recente) e um desconsiderar
       AND (SELECT t.tipo
              FROM public.marcacoes_tratamentos t
             WHERE t.marcacao_id = m.id
               AND t.tipo IN ('desconsiderar', 'restaurar')
             ORDER BY t.created_at DESC
             LIMIT 1) = 'desconsiderar';

    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'Batidas reais restauradas: %', v_n;
END
$res$;


-- ============================================================================
-- 3. RECONCILIAR OS DIAS AFETADOS
-- ============================================================================
-- Reconstroi presenca_* das linhas que sobraram a partir de marcacoes_ponto, ja aplicando os
-- tratamentos do passo 2. p_limpar_sem_marcacao fica FALSE (o default): a limpeza total so pode
-- ser ligada depois do corte da Fase 5 por unidades.fonte_ponto_oficial.

DO $rec$
DECLARE
    r     record;
    v_res jsonb;
BEGIN
    FOR r IN
        SELECT '9c7b7695-6675-4c46-b0e5-1af6793c49e3'::uuid AS servidor, d::date AS dia
          FROM generate_series(DATE '2026-08-03', DATE '2026-08-07', INTERVAL '1 day') d
        UNION ALL
        SELECT 'f2c69c5f-f318-479d-b528-cc3b10ce00e7'::uuid, d
          FROM unnest(ARRAY['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07',
                            '2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14',
                            '2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21',
                            '2026-08-24','2026-08-25','2026-08-26','2026-08-27']::date[]) d
    LOOP
        v_res := public.fn_reconciliar_marcacoes_dia(r.servidor, r.dia);
        RAISE NOTICE 'reconciliado % % -> %', r.servidor, r.dia, v_res;
    END LOOP;
END
$rec$;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
-- 1) Nao pode sobrar NENHUM par (servidor, dia) em dois setores com slots sobrepostos:
--
--    SELECT em.servidor_id, em.mes, em.ano, ed.dia, count(DISTINCT em.setor_id) AS setores
--      FROM public.escala_diaria ed
--      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--     GROUP BY em.servidor_id, em.mes, em.ano, ed.dia
--    HAVING count(DISTINCT em.setor_id) > 1;
--    -- para cada grupo devolvido, conferir se os slots realmente se cruzam.
--
-- 2) FAGNER deve ter 5 dias no PATRIMONIO (3-7) e comecar no dia 10 no TRANSPORTE:
--
--    SELECT ds.nome AS setor, ed.dia, dt.codigo,
--           ed.presenca_entrada_em, ed.presenca_saida_em,
--           ed.presenca_entrada_origem, ed.presenca_saida_origem
--      FROM public.escala_diaria ed
--      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--      JOIN public.setores se ON se.id = em.setor_id
--      JOIN public.dicionario_setores ds ON ds.id = se.dicionario_setor_id
--      JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
--     WHERE em.servidor_id = '9c7b7695-6675-4c46-b0e5-1af6793c49e3'
--       AND em.mes = 8 AND em.ano = 2026
--     ORDER BY ds.nome, ed.dia;
--
-- 3) CLEONEIDE nao pode ter mais nenhuma linha no PSE em 08/2026:
--
--    SELECT count(*) FROM public.escala_diaria
--     WHERE escala_mensal_id = '8c3cc05f-b5c2-4ed6-9b8c-0ba5b58acfb2';   -- esperado: 0
--
-- 4) Nenhuma batida REAL pode ter sido DESCONSIDERADA por esta migration (o passo 2b insere
--    'restaurar' sobre batida real de proposito, por isso o filtro por tipo):
--
--    SELECT count(*) FROM public.marcacoes_tratamentos t
--      JOIN public.marcacoes_ponto m ON m.id = t.marcacao_id
--     WHERE t.justificativa LIKE '%migration 20260826210000%'
--       AND t.tipo = 'desconsiderar'
--       AND (m.sintetica IS NOT TRUE OR m.origem <> 'ajuste_coordenador');  -- esperado: 0
--
-- 5) FAGNER, dias 3 a 7, tem que ficar com a batida REAL do terminal no PATRIMONIO -
--    resultado medido em 26/08/2026 depois de aplicar (horarios locais):
--      dia 3  entrada 08:02  sem saida
--      dia 4  entrada 07:49  sem saida
--      dia 5  entrada 07:47  sem saida
--      dia 6  entrada 07:54  saida 17:38
--      dia 7  entrada 07:54  saida 16:00
--    As saidas ausentes sao FATO (ele nao bateu), nao falha da migration. Os dias 6 e 7 passam
--    a ter saida bem depois das 14:00 da jornada - isso vira hora extra e precisa da revisao do
--    coordenador. Era exatamente o efeito previsto ao decidir nao desconsiderar batida real.
