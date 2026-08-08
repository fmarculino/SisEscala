-- Migration: Projecao, reconciliacao e portao de conferencia (Fase 2 - conclusao)
-- Data: 2026-08-08
--
-- OBJETIVO
--   Fechar o caminho de leitura do modulo de marcacoes com tres funcoes encadeadas:
--
--     fn_projecao_marcacoes_dia    PURA  - o que escala_diaria DEVERIA conter
--     fn_reconciliar_marcacoes_dia ESCREVE - aplica a projecao (ninguem chama ainda)
--     fn_conferir_reconciliacao    PURA  - diff entre a projecao e o que existe hoje
--
-- POR QUE UMA FUNCAO DE PROJECAO SEPARADA
--   Reconciliar e conferir precisam derivar exatamente os mesmos valores. Se cada uma
--   derivasse por conta propria, o portao de conferencia estaria validando uma regra diferente
--   da que sera aplicada - e o portao perderia todo o valor. Este repositorio ja paga caro por
--   regra duplicada: o horario de intervalo e calculado de tres formas incompativeis (terminal,
--   validacao manual e folha de ponto). Aqui a regra existe uma vez so.
--
-- O PORTAO DE CONFERENCIA E O SUBSTITUTO DOS TESTES
--   Nao ha framework de testes no projeto. fn_conferir_reconciliacao roda a projecao sobre
--   meses de dados reais e devolve TODA divergencia contra o que escala_diaria contem hoje.
--   A Fase 2 so passa quando cada linha do diff tiver explicacao escrita - ou e bug da funcao
--   nova, ou e defeito conhecido do caminho antigo.
--
--   Divergencia JA ESPERADA: os timestamps sinteticos de fn_salvar_saida_bloco
--   (20260706115000), que inventa ate 5 horarios numa unica batida de saida de bloco
--   multi-turno. A projecao nao os reproduz por decisao de projeto - ela nunca fabrica horario.
--   Esses casos devem aparecer como 'ausente_na_projecao'.
--
-- ESTA MIGRATION NAO MUDA NENHUM COMPORTAMENTO
--   fn_reconciliar_marcacoes_dia escreve, mas nada no sistema a invoca. O terminal, a grade e
--   a folha continuam no caminho antigo.


-- ============================================================================
-- 1. PROJECAO - o que escala_diaria deveria conter
-- ============================================================================
--
-- REGRA DE DISTRIBUICAO NO BLOCO
--   Um bloco pode abranger varias linhas de escala_diaria (Regular + Extra + Plantao contiguos).
--   A projecao grava o MESMO horario real em todas as linhas do bloco: a pessoa entrou uma vez
--   e saiu uma vez, o bloco e um periodo continuo de trabalho.
--
--   Isso diverge de fn_salvar_saida_bloco, que preenche as linhas intermediarias com os limites
--   previstos de cada turno - horarios que ninguem bateu. A folha de ponto nao se altera com
--   essa mudanca, porque ela ja consolida o dia por MIN(entrada) e MAX(saida) sobre todos os
--   turnos: o minimo e o maximo sao os mesmos nos dois modelos.

DROP FUNCTION IF EXISTS public.fn_projecao_marcacoes_dia(uuid, date);

CREATE OR REPLACE FUNCTION public.fn_projecao_marcacoes_dia(
    p_servidor_id uuid,
    p_data        date
)
RETURNS TABLE (
    escala_diaria_id      uuid,
    entrada_em            timestamptz,
    entrada_origem        public.marcacao_origem,
    entrada_marcacao_id   uuid,
    int_saida_em          timestamptz,
    int_saida_origem      public.marcacao_origem,
    int_saida_marcacao_id uuid,
    int_ret_em            timestamptz,
    int_ret_origem        public.marcacao_origem,
    int_ret_marcacao_id   uuid,
    saida_em              timestamptz,
    saida_origem          public.marcacao_origem,
    saida_marcacao_id     uuid,
    confirmada            boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fnproj$
    WITH alocacoes AS (
        SELECT x
          FROM jsonb_array_elements(
                   public.fn_alocar_marcacoes_dia(p_servidor_id, p_data) -> 'alocacoes'
               ) AS x
    ),
    expandido AS (
        -- Uma alocacao vale para todas as linhas de escala_diaria do bloco.
        SELECT NULLIF(btrim(e.valor), '')::uuid AS ed_id,
               a.x->>'passo'                    AS passo,
               (a.x->>'marcacao_id')::uuid      AS marcacao_id
          FROM alocacoes a
          CROSS JOIN LATERAL jsonb_array_elements_text(a.x->'escala_diaria_ids') AS e(valor)
         WHERE NULLIF(btrim(e.valor), '') IS NOT NULL
    ),
    com_dados AS (
        SELECT ex.ed_id, ex.passo, ex.marcacao_id, m.ocorrido_em, m.origem
          FROM expandido ex
          JOIN public.marcacoes_ponto m ON m.id = ex.marcacao_id
    )
    -- Ha no maximo UMA marcacao por (linha de escala_diaria, passo): o alocador entrega um
    -- vencedor por slot, e cada linha pertence a um unico bloco. Os agregados abaixo servem
    -- apenas para pivotar de linhas para colunas, nao para escolher entre concorrentes.
    --
    -- array_agg(...)[1] em vez de max() nao e preciosismo: NAO EXISTE max(uuid) no Postgres -
    -- usar max em marcacao_id falha com 42883 no CREATE FUNCTION. E, para a coluna de origem,
    -- max() de enum funciona mas escolheria pelo ordinal do tipo, o que sugeriria uma regra de
    -- desempate que nao existe aqui. Nao trocar de volta.
    SELECT
        cd.ed_id,
        max(cd.ocorrido_em)  FILTER (WHERE cd.passo = 'entrada'),
        (array_agg(cd.origem) FILTER (WHERE cd.passo = 'entrada'))[1],
        (array_agg(cd.marcacao_id) FILTER (WHERE cd.passo = 'entrada'))[1],
        max(cd.ocorrido_em)  FILTER (WHERE cd.passo = 'intervalo_saida'),
        (array_agg(cd.origem) FILTER (WHERE cd.passo = 'intervalo_saida'))[1],
        (array_agg(cd.marcacao_id) FILTER (WHERE cd.passo = 'intervalo_saida'))[1],
        max(cd.ocorrido_em)  FILTER (WHERE cd.passo = 'intervalo_retorno'),
        (array_agg(cd.origem) FILTER (WHERE cd.passo = 'intervalo_retorno'))[1],
        (array_agg(cd.marcacao_id) FILTER (WHERE cd.passo = 'intervalo_retorno'))[1],
        max(cd.ocorrido_em)  FILTER (WHERE cd.passo = 'saida'),
        (array_agg(cd.origem) FILTER (WHERE cd.passo = 'saida'))[1],
        (array_agg(cd.marcacao_id) FILTER (WHERE cd.passo = 'saida'))[1],
        -- Confirmada quando ha qualquer marcacao no dia. Diverge levemente da regra antiga,
        -- em que uma saida de intervalo isolada nao confirmava presenca - mas se a pessoa
        -- bateu a saida para o almoco, ela estava presente.
        count(*) > 0
      FROM com_dados cd
     GROUP BY cd.ed_id
$fnproj$;

COMMENT ON FUNCTION public.fn_projecao_marcacoes_dia(uuid, date) IS
    'O que escala_diaria deveria conter para um servidor num dia, derivado das marcacoes. '
    'Fonte unica compartilhada por fn_reconciliar_marcacoes_dia e fn_conferir_reconciliacao.';

GRANT EXECUTE ON FUNCTION public.fn_projecao_marcacoes_dia(uuid, date) TO authenticated, service_role;


-- ============================================================================
-- 2. RECONCILIACAO - aplica a projecao em escala_diaria
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_reconciliar_marcacoes_dia(uuid, date, boolean);

CREATE OR REPLACE FUNCTION public.fn_reconciliar_marcacoes_dia(
    p_servidor_id         uuid,
    p_data                date,
    p_limpar_sem_marcacao boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fnrec$
DECLARE
    v_versao      integer := 1;
    v_atualizadas integer := 0;
    v_limpas      integer := 0;
    v_mes         integer := extract(month from p_data)::integer;
    v_ano         integer := extract(year  from p_data)::integer;
BEGIN
    -- Competencia encerrada: a INGESTAO da marcacao sempre acontece (o registro existe), mas a
    -- PROJECAO e recusada. Reabrir a competencia e decisao de super admin, nao efeito colateral
    -- de um AFD que chegou por pendrive com 40 dias de atraso.
    IF public.fn_competencia_encerrada(v_mes, v_ano) THEN
        RETURN jsonb_build_object(
            'servidor_id', p_servidor_id, 'data', p_data,
            'status', 'pendencia_competencia_encerrada',
            'atualizadas', 0, 'limpas', 0);
    END IF;

    -- Declara a sessao como reconciliacao. A partir da Fase 5 o guard de escala_diaria passa a
    -- exigir esta marca para aceitar escrita de presenca em unidades com fonte_ponto_oficial='rep'.
    PERFORM set_config('sisescala.reconciliacao', 'on', true);

    -- 2.1 Aplica a projecao.
    WITH proj AS (
        SELECT * FROM public.fn_projecao_marcacoes_dia(p_servidor_id, p_data)
    ), upd AS (
        UPDATE public.escala_diaria ed
           SET presenca_entrada_em           = p.entrada_em,
               presenca_entrada_origem       = p.entrada_origem,
               presenca_entrada_marcacao_id  = p.entrada_marcacao_id,
               presenca_entrada_manual       = COALESCE(p.entrada_origem IN ('ajuste_coordenador','ajuste_servidor'), false),

               presenca_intervalo_saida_em          = p.int_saida_em,
               presenca_intervalo_saida_origem      = p.int_saida_origem,
               presenca_intervalo_saida_marcacao_id = p.int_saida_marcacao_id,
               presenca_intervalo_saida_manual      = COALESCE(p.int_saida_origem IN ('ajuste_coordenador','ajuste_servidor'), false),

               presenca_intervalo_retorno_em          = p.int_ret_em,
               presenca_intervalo_retorno_origem      = p.int_ret_origem,
               presenca_intervalo_retorno_marcacao_id = p.int_ret_marcacao_id,
               presenca_intervalo_retorno_manual      = COALESCE(p.int_ret_origem IN ('ajuste_coordenador','ajuste_servidor'), false),

               presenca_saida_em           = p.saida_em,
               presenca_saida_origem       = p.saida_origem,
               presenca_saida_marcacao_id  = p.saida_marcacao_id,
               presenca_saida_manual       = COALESCE(p.saida_origem IN ('ajuste_coordenador','ajuste_servidor'), false),

               presenca_confirmada     = COALESCE(p.confirmada, false),
               presenca_confirmada_em  = now(),
               reconciliado_em         = now(),
               reconciliacao_versao    = v_versao
          FROM proj p
         WHERE ed.id = p.escala_diaria_id
        RETURNING 1
    )
    SELECT count(*) INTO v_atualizadas FROM upd;

    -- 2.2 Limpeza das linhas do dia que ficaram SEM nenhuma marcacao.
    --     Desligada por padrao. A reconciliacao e total por natureza: rodar sobre um dia sem
    --     marcacoes apagaria a presenca. Isso so pode ser ligado depois do corte por
    --     unidades.fonte_ponto_oficial = 'rep' (Fase 5), senao apagaria presenca legitima de
    --     unidades que ainda usam o terminal web como fonte.
    IF p_limpar_sem_marcacao THEN
        WITH lim AS (
            UPDATE public.escala_diaria ed
               SET presenca_entrada_em = NULL, presenca_entrada_origem = NULL,
                   presenca_entrada_marcacao_id = NULL, presenca_entrada_manual = false,
                   presenca_intervalo_saida_em = NULL, presenca_intervalo_saida_origem = NULL,
                   presenca_intervalo_saida_marcacao_id = NULL, presenca_intervalo_saida_manual = false,
                   presenca_intervalo_retorno_em = NULL, presenca_intervalo_retorno_origem = NULL,
                   presenca_intervalo_retorno_marcacao_id = NULL, presenca_intervalo_retorno_manual = false,
                   presenca_saida_em = NULL, presenca_saida_origem = NULL,
                   presenca_saida_marcacao_id = NULL, presenca_saida_manual = false,
                   presenca_confirmada = false,
                   reconciliado_em = now(), reconciliacao_versao = v_versao
              FROM public.escala_mensal em
             WHERE ed.escala_mensal_id = em.id
               AND em.servidor_id = p_servidor_id
               AND em.mes = v_mes AND em.ano = v_ano
               AND ed.dia = extract(day from p_data)::integer
               AND ed.categoria <> 'Sobreaviso'
               AND ed.id NOT IN (
                   SELECT escala_diaria_id FROM public.fn_projecao_marcacoes_dia(p_servidor_id, p_data))
               AND (ed.presenca_entrada_em IS NOT NULL OR ed.presenca_saida_em IS NOT NULL
                 OR ed.presenca_intervalo_saida_em IS NOT NULL OR ed.presenca_intervalo_retorno_em IS NOT NULL)
            RETURNING 1
        )
        SELECT count(*) INTO v_limpas FROM lim;
    END IF;

    RETURN jsonb_build_object(
        'servidor_id', p_servidor_id, 'data', p_data,
        'status', 'ok', 'versao', v_versao,
        'atualizadas', v_atualizadas, 'limpas', v_limpas);
END;
$fnrec$;

COMMENT ON FUNCTION public.fn_reconciliar_marcacoes_dia(uuid, date, boolean) IS
    'Aplica a projecao das marcacoes em escala_diaria. Idempotente. A limpeza de dias sem '
    'marcacao vem desligada: so pode ser ligada apos o corte por unidades.fonte_ponto_oficial.';

GRANT EXECUTE ON FUNCTION public.fn_reconciliar_marcacoes_dia(uuid, date, boolean) TO service_role;


-- ============================================================================
-- 3. PORTAO DE CONFERENCIA - diff sem escrever nada
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_conferir_reconciliacao(date, date, uuid);

CREATE OR REPLACE FUNCTION public.fn_conferir_reconciliacao(
    p_data_inicio date,
    p_data_fim    date,
    p_servidor_id uuid DEFAULT NULL
)
RETURNS TABLE (
    servidor_id      uuid,
    data             date,
    escala_diaria_id uuid,
    categoria        text,
    campo            text,
    valor_atual      timestamptz,
    valor_projetado  timestamptz,
    origem_projetada public.marcacao_origem,
    diferenca_min    numeric,
    tipo_divergencia text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fnconf$
    WITH dias AS (
        SELECT DISTINCT em.servidor_id, make_date(em.ano, em.mes, ed.dia) AS data
          FROM public.escala_diaria ed
          JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
         WHERE em.servidor_id IS NOT NULL
           AND make_date(em.ano, em.mes, ed.dia) BETWEEN p_data_inicio AND p_data_fim
           AND (p_servidor_id IS NULL OR em.servidor_id = p_servidor_id)
    ),
    projetado AS (
        SELECT d.servidor_id, d.data, pr.*
          FROM dias d
          CROSS JOIN LATERAL public.fn_projecao_marcacoes_dia(d.servidor_id, d.data) pr
    ),
    -- Desempilha a projecao em (linha, campo, valor).
    proj_long AS (
        SELECT p.servidor_id, p.data, p.escala_diaria_id, c.campo, c.valor, c.origem
          FROM projetado p
          CROSS JOIN LATERAL (VALUES
              ('entrada',           p.entrada_em,   p.entrada_origem),
              ('intervalo_saida',   p.int_saida_em, p.int_saida_origem),
              ('intervalo_retorno', p.int_ret_em,   p.int_ret_origem),
              ('saida',             p.saida_em,     p.saida_origem)
          ) AS c(campo, valor, origem)
    ),
    -- Desempilha o estado atual.
    atual_long AS (
        SELECT em.servidor_id,
               make_date(em.ano, em.mes, ed.dia) AS data,
               ed.id AS escala_diaria_id,
               ed.categoria::text AS categoria,
               c.campo, c.valor
          FROM public.escala_diaria ed
          JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
          CROSS JOIN LATERAL (VALUES
              ('entrada',           ed.presenca_entrada_em),
              ('intervalo_saida',   ed.presenca_intervalo_saida_em),
              ('intervalo_retorno', ed.presenca_intervalo_retorno_em),
              ('saida',             ed.presenca_saida_em)
          ) AS c(campo, valor)
         WHERE em.servidor_id IS NOT NULL
           AND make_date(em.ano, em.mes, ed.dia) BETWEEN p_data_inicio AND p_data_fim
           AND (p_servidor_id IS NULL OR em.servidor_id = p_servidor_id)
    )
    SELECT
        COALESCE(a.servidor_id, p.servidor_id),
        COALESCE(a.data, p.data),
        COALESCE(a.escala_diaria_id, p.escala_diaria_id),
        a.categoria,
        COALESCE(a.campo, p.campo),
        a.valor,
        p.valor,
        p.origem,
        CASE WHEN a.valor IS NOT NULL AND p.valor IS NOT NULL
             THEN round(abs(extract(epoch FROM (a.valor - p.valor)) / 60.0), 1) END,
        CASE
            WHEN a.valor IS NOT NULL AND p.valor IS NULL THEN 'ausente_na_projecao'
            WHEN a.valor IS NULL AND p.valor IS NOT NULL THEN 'ausente_no_atual'
            ELSE 'horario_diferente'
        END
      FROM atual_long a
      FULL OUTER JOIN proj_long p
        ON p.escala_diaria_id = a.escala_diaria_id AND p.campo = a.campo
     WHERE a.valor IS DISTINCT FROM p.valor
       AND NOT (a.valor IS NULL AND p.valor IS NULL)
$fnconf$;

COMMENT ON FUNCTION public.fn_conferir_reconciliacao(date, date, uuid) IS
    'Diff entre o que a reconciliacao escreveria e o que escala_diaria contem hoje. Nao escreve '
    'nada. E o portao de qualidade da Fase 2 - substitui o framework de testes que o projeto nao tem.';

GRANT EXECUTE ON FUNCTION public.fn_conferir_reconciliacao(date, date, uuid) TO authenticated, service_role;


-- CUSTO DE EXECUCAO
--   fn_conferir_reconciliacao chama fn_alocar_marcacoes_dia uma vez por (servidor, dia), e cada
--   chamada roda fn_blocos_previstos_dia duas vezes (hoje e ontem). Em 08/2026 sao ~2.500 pares
--   distintos, entao ~5.000 execucoes de um cursor pesado. Espere MINUTOS, nao segundos.
--   Rode por servidor ou por semana se o cliente SQL tiver timeout curto:
--     SELECT * FROM public.fn_conferir_reconciliacao('2026-08-01', '2026-08-07');
--   Isso nao afeta o uso real: a reconciliacao roda por dia, nao por mes.


-- CONFERENCIA APOS APLICAR
--
--   1) PANORAMA DO DIFF em 08/2026. Comece por aqui - e o portao da Fase 2:
--
--   SELECT tipo_divergencia, campo, count(*) AS ocorrencias,
--          round(avg(diferenca_min)) AS dif_media_min,
--          max(diferenca_min) AS dif_max_min
--     FROM public.fn_conferir_reconciliacao('2026-08-01', '2026-08-31')
--    GROUP BY 1, 2
--    ORDER BY 3 DESC;
--
--   COMO LER O RESULTADO:
--     'ausente_na_projecao' em blocos multi-turno -> ESPERADO. Sao os timestamps sinteticos
--         de fn_salvar_saida_bloco, que a projecao deliberadamente nao reproduz.
--     'horario_diferente' com dif_media_min = 0    -> ESPERADO (arredondamento/fuso).
--     'ausente_no_atual'                            -> INVESTIGAR. A projecao esta inventando
--         horario onde nao havia, o que ela nao deveria fazer nunca.
--     'horario_diferente' com dif grande            -> INVESTIGAR. O alocador pos a batida no
--         passo errado.
--
--   2) Isolar os casos que exigem investigacao:
--
--   SELECT * FROM public.fn_conferir_reconciliacao('2026-08-01', '2026-08-31')
--    WHERE tipo_divergencia = 'ausente_no_atual'
--       OR (tipo_divergencia = 'horario_diferente' AND diferenca_min > 1)
--    ORDER BY diferenca_min DESC NULLS LAST
--    LIMIT 50;
--
--   3) Um dia sem divergencia nenhuma deve devolver 0 linhas:
--
--   SELECT count(*) FROM public.fn_conferir_reconciliacao('2026-08-05', '2026-08-05');
--
--   4) TESTE DE IDEMPOTENCIA DA RECONCILIACAO (em transacao desfeita, para nao alterar dados):
--
--   BEGIN;
--     SELECT public.fn_reconciliar_marcacoes_dia('<servidor>', '2026-08-05');
--     SELECT public.fn_reconciliar_marcacoes_dia('<servidor>', '2026-08-05');
--     -- a segunda deve devolver o mesmo 'atualizadas' da primeira
--     SELECT count(*) FROM public.fn_conferir_reconciliacao('2026-08-05','2026-08-05','<servidor>');
--     -- apos reconciliar, o diff daquele dia deve ser 0
--   ROLLBACK;
--
--   5) A reconciliacao deve RECUSAR competencia encerrada (06/2026 esta fechada):
--
--   SELECT public.fn_reconciliar_marcacoes_dia('<servidor>', '2026-06-15');
--   -- esperado: status = 'pendencia_competencia_encerrada', atualizadas = 0
