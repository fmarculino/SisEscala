-- Migration: fn_blocos_previstos_mes passa a expor o previsto de CADA turno fundido
-- Data: 2026-08-26
--
-- O PROBLEMA QUE ISTO FECHA
--   Num dia com Regular M (08H AS 14H) + Plantao T4 com hora informada 14:00, a fusao de blocos
--   (armadilha 6) junta os dois num bloco unico 08:00-18:00. A grade le a previsao por
--   escala_diaria_id e recebe o BLOCO, entao a linha do Plantao mostra "entrada prevista 08:00 /
--   saida 18:00" - o horario do expediente, nao o do plantao que o coordenador definiu.
--
--   Caso real medido em producao em 26/08/2026 (IRIZAN SILVA, mat. 268, PATE/PPAE, dia 26):
--     escala_diaria Plantao 23baedcf-46b5-4c53-9973-6f8dc2d50a91, hora_inicio_prevista 14:00
--     fn_blocos_previstos_dia devolve 1 bloco:
--       inicio_previsto 08:00  fim_previsto 18:00
--       turnos_inicio  [08:00, 14:00]   turnos_fim [14:00, 18:00]
--   Ou seja: o previsto por turno JA EXISTE e JA esta certo. Ele so nao chega a grade, porque
--   fn_blocos_previstos_mes (20260808120000) e anterior a 20260819200000, que criou
--   turnos_inicio/turnos_fim, e nunca passou a listar as duas colunas.
--
-- O QUE ESTA MIGRATION FAZ
--   Acrescenta turnos_inicio e turnos_fim ao RETURNS TABLE do envelope. ZERO logica nova:
--   continua sendo um LATERAL puro sobre fn_blocos_previstos_dia, agora repassando duas colunas
--   que a funcao de dentro ja devolvia e o envelope descartava.
--
--   Os dois arrays vem na MESMA ordem de escala_diaria_ids - e essa correspondencia por indice
--   que permite a grade dizer "esta linha e o 2o turno do bloco, previsto 14:00-18:00".
--
--   NENHUMA outra funcao e alterada. fn_blocos_previstos_dia nao e tocada.
--
-- POR QUE DROP ANTES DO CREATE
--   CREATE OR REPLACE nao altera a lista de colunas de um RETURNS TABLE (42P13, ver a nota de
--   13/08/2026 no CLAUDE.md). Sem CASCADE de proposito: se algum dependente real existir, e
--   melhor o erro do que a remocao silenciosa. Conferido em 26/08/2026: o unico consumidor e
--   ScaleGrid.tsx, via RPC (PostgREST), que nao cria dependencia no catalogo.
--
-- COMPATIBILIDADE
--   Colunas novas no fim: quem ja consome (a grade, hoje) continua lendo as mesmas chaves.
--   Um bundle antigo em aba aberta nao quebra - so ignora as duas colunas.
--
-- CONFERENCIA APOS APLICAR
--   -- 1. o envelope tem que devolver exatamente o que a funcao de dentro devolve, coluna a coluna:
--   WITH lote AS (
--       SELECT b.servidor_id, b.dia, b.bloco_ordem, b.turnos_inicio, b.turnos_fim
--         FROM public.fn_blocos_previstos_mes(
--                (SELECT array_agg(id) FROM public.escala_mensal WHERE ano = 2026 AND mes = 8)) b
--   ),
--   individual AS (
--       SELECT em.servidor_id, ed.dia, b.bloco_ordem, b.turnos_inicio, b.turnos_fim
--         FROM public.escala_mensal em
--         JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
--         CROSS JOIN LATERAL public.fn_blocos_previstos_dia(
--                  em.servidor_id, make_date(em.ano, em.mes, ed.dia)) b
--        WHERE em.ano = 2026 AND em.mes = 8
--   )
--   SELECT (SELECT count(*) FROM (SELECT * FROM lote EXCEPT SELECT * FROM individual) x)
--        + (SELECT count(*) FROM (SELECT * FROM individual EXCEPT SELECT * FROM lote) y)
--          AS divergencias;
--   -- esperado: 0
--
--   -- 2. o caso que motivou a migration: o 2o turno do bloco do dia 26 tem que ser 14:00-18:00.
--   SELECT b.dia, b.escala_diaria_ids, b.inicio_previsto, b.fim_previsto,
--          b.turnos_inicio, b.turnos_fim
--     FROM public.fn_blocos_previstos_mes(ARRAY['a1006193-90fd-43f8-9dc7-6ab40c2be345'::uuid]) b
--    WHERE b.dia = 26;
--
--   -- 3. todo bloco tem que ter um previsto por escala_diaria_id (a grade indexa por posicao):
--   SELECT count(*) AS blocos_com_array_desalinhado
--     FROM public.fn_blocos_previstos_mes(
--            (SELECT array_agg(id) FROM public.escala_mensal WHERE ano = 2026 AND mes = 8)) b
--    WHERE array_length(b.turnos_inicio, 1) IS DISTINCT FROM array_length(b.escala_diaria_ids, 1)
--       OR array_length(b.turnos_fim, 1)    IS DISTINCT FROM array_length(b.escala_diaria_ids, 1);
--   -- esperado: 0

BEGIN;

DROP FUNCTION IF EXISTS public.fn_blocos_previstos_mes(uuid[]);

CREATE OR REPLACE FUNCTION public.fn_blocos_previstos_mes(
    p_escala_mensal_ids uuid[]
)
RETURNS TABLE (
    escala_mensal_id          uuid,
    servidor_id               uuid,
    dia                       integer,
    bloco_ordem               integer,
    escala_diaria_ids         uuid[],
    categoria                 text,
    inicio_previsto           timestamptz,
    fim_previsto              timestamptz,
    intervalo_inicio_previsto timestamptz,
    intervalo_fim_previsto    timestamptz,
    permite_intervalo         boolean,
    -- O previsto de CADA turno fundido no bloco, na MESMA ordem de escala_diaria_ids.
    -- Repassados de fn_blocos_previstos_dia (20260819200000) sem nenhum tratamento: e por eles
    -- que a linha do Plantao mostra o horario DELE, e nao o do bloco inteiro.
    turnos_inicio             timestamptz[],
    turnos_fim                timestamptz[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT
           em.id                       AS escala_mensal_id,
           em.servidor_id              AS servidor_id,
           d.dia                       AS dia,
           b.bloco_ordem,
           b.escala_diaria_ids,
           b.categoria,
           b.inicio_previsto,
           b.fim_previsto,
           b.intervalo_inicio_previsto,
           b.intervalo_fim_previsto,
           b.permite_intervalo,
           b.turnos_inicio,
           b.turnos_fim
      FROM public.escala_mensal em
      -- So os dias que realmente tem escala. DISTINCT porque um dia pode ter Regular + Extra
      -- + Plantao, e fn_blocos_previstos_dia ja devolve o dia inteiro de uma vez.
      CROSS JOIN LATERAL (
          SELECT DISTINCT ed.dia
            FROM public.escala_diaria ed
           WHERE ed.escala_mensal_id = em.id
      ) d
      CROSS JOIN LATERAL public.fn_blocos_previstos_dia(
          em.servidor_id,
          make_date(em.ano, em.mes, d.dia)
      ) b
     WHERE em.id = ANY(p_escala_mensal_ids);
$$;

COMMENT ON FUNCTION public.fn_blocos_previstos_mes(uuid[]) IS
'Blocos de trabalho previstos para varias escalas mensais de uma vez - o que a grade precisa
para desenhar a previsao de presenca sem re-derivar horario por conta propria.

ZERO logica propria: e um LATERAL sobre fn_blocos_previstos_dia. Por construcao devolve
exatamente o que o terminal vai cobrar. Se algum dia divergir, o bug esta na funcao envelopada,
nunca nesta.

turnos_inicio/turnos_fim trazem o previsto de cada turno fundido, na ordem de escala_diaria_ids
(20260826000000). Sem eles a linha do Plantao em bloco fundido mostrava o horario do EXPEDIENTE.

Percorre apenas os dias com linha em escala_diaria, nao 1..31.

Ver docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md (Fase 3).';

GRANT EXECUTE ON FUNCTION public.fn_blocos_previstos_mes(uuid[]) TO authenticated, service_role;

COMMIT;
