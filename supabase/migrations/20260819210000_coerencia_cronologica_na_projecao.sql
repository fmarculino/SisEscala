-- ============================================================================
-- Migration: a linha que tem batida de transicao para de herdar passo do bloco fora da sua janela
-- Data: 2026-08-19
--
-- PROBLEMA (pego pelo portao ANTES de gravar, 19/08/2026)
--   A 20260819200000 deu a cada turno fundido a sua propria batida de fronteira, mas os passos
--   do BLOCO continuam valendo para todas as linhas dele. Numa jornada 07:00-17:00 seguida de
--   1h extra ate 19:00, com intervalo de bloco 11:00/13:00, a linha do Extra ficava assim:
--
--     entrada 17:00 (fronteira)   int_saida 09:00   int_retorno 11:00   saida -
--
--   ou seja, saida para o intervalo ANTES da entrada. Cinco linhas de agosto/2026 ficariam
--   invertidas desse jeito (FLAVIA BARROS CAVALCANTE em 4 dias, ICARO HENRIQUE em 1).
--   Folha com passo invertido e erro grosseiro e visivel; a checagem
--   (scratchpad/checa_inversao_projecao.js) rodou sobre a projecao antes de qualquer escrita.
--
-- CORRECAO
--   Quando uma linha TEM batida de transicao, ela deixa de herdar os passos do bloco que caem
--   fora da janela daquele turno:
--
--     - ha entrada de fronteira em T  -> descarta passo do bloco anterior a T
--     - ha saida de fronteira em T    -> descarta passo do bloco posterior a T
--
--   A batida de transicao e a prova de onde aquele turno comecou ou terminou; passo do bloco
--   fora disso pertence ao turno vizinho, nao a este.
--
--   Linha SEM batida de transicao nao muda em nada: continua herdando os passos do bloco, que e
--   o comportamento de sempre e o que cobre a esmagadora maioria dos dias. Este filtro nunca
--   descarta a propria batida de fronteira.
--
-- EFEITO MEDIDO (mesma checagem, depois): 0 linhas invertidas, 0 duracoes impossiveis.
--
-- Substitui a fn_projecao_marcacoes_dia criada em 20260819200000.
-- ============================================================================


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
        -- Uma alocacao vale para todas as linhas de escala_diaria que ela nomeia. As do bloco
        -- nomeiam todas as linhas; as de FRONTEIRA nomeiam uma linha so (ver 20260819200000).
        SELECT NULLIF(btrim(e.valor), '')::uuid              AS ed_id,
               a.x->>'passo'                                 AS passo,
               (a.x->>'marcacao_id')::uuid                   AS marcacao_id,
               COALESCE((a.x->>'fronteira')::boolean, false)  AS fronteira
          FROM alocacoes a
          CROSS JOIN LATERAL jsonb_array_elements_text(a.x->'escala_diaria_ids') AS e(valor)
         WHERE NULLIF(btrim(e.valor), '') IS NOT NULL
    ),
    com_dados AS (
        SELECT ex.ed_id, ex.passo, ex.marcacao_id, ex.fronteira, m.ocorrido_em, m.origem
          FROM expandido ex
          JOIN public.marcacoes_ponto m ON m.id = ex.marcacao_id
    ),
    -- Janela real do turno naquela linha, quando existe batida de transicao.
    janela AS (
        SELECT ed_id,
               max(ocorrido_em) FILTER (WHERE fronteira AND passo = 'entrada') AS abre_em,
               min(ocorrido_em) FILTER (WHERE fronteira AND passo = 'saida')   AS fecha_em
          FROM com_dados
         GROUP BY ed_id
    ),
    -- Sem batida de transicao (abre_em e fecha_em nulos) nada e descartado: o comportamento de
    -- sempre. Com ela, o passo herdado do bloco que cai fora da janela pertence ao turno vizinho.
    filtrado AS (
        SELECT cd.*
          FROM com_dados cd
          JOIN janela j ON j.ed_id = cd.ed_id
         WHERE cd.fronteira
            OR (    (j.abre_em  IS NULL OR cd.ocorrido_em >= j.abre_em)
                AND (j.fecha_em IS NULL OR cd.ocorrido_em <= j.fecha_em))
    )
    -- Pode haver DUAS alocacoes para o mesmo (linha, passo): a do bloco, que vale para todas as
    -- linhas, e a da fronteira, que e daquela linha so. A especifica vence — e o que faz a linha
    -- do plantao mostrar a batida das 13:10 em vez da entrada do expediente das 07:04. Fora esse
    -- desempate os agregados apenas pivotam de linhas para colunas.
    --
    -- array_agg(...)[1] em vez de max() nao e preciosismo: NAO EXISTE max(uuid) no Postgres -
    -- usar max em marcacao_id falha com 42883 no CREATE FUNCTION. E, para a coluna de origem,
    -- max() de enum funciona mas escolheria pelo ordinal do tipo, o que sugeriria uma regra de
    -- desempate que nao existe aqui. Nao trocar de volta.
    SELECT
        cd.ed_id,
        (array_agg(cd.ocorrido_em ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'entrada'))[1],
        (array_agg(cd.origem      ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'entrada'))[1],
        (array_agg(cd.marcacao_id ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'entrada'))[1],
        (array_agg(cd.ocorrido_em ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_saida'))[1],
        (array_agg(cd.origem      ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_saida'))[1],
        (array_agg(cd.marcacao_id ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_saida'))[1],
        (array_agg(cd.ocorrido_em ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_retorno'))[1],
        (array_agg(cd.origem      ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_retorno'))[1],
        (array_agg(cd.marcacao_id ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'intervalo_retorno'))[1],
        (array_agg(cd.ocorrido_em ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'saida'))[1],
        (array_agg(cd.origem      ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'saida'))[1],
        (array_agg(cd.marcacao_id ORDER BY cd.fronteira DESC) FILTER (WHERE cd.passo = 'saida'))[1],
        -- Confirmada quando ha qualquer marcacao no dia.
        count(*) > 0
      FROM filtrado cd
     GROUP BY cd.ed_id
$fnproj$;

COMMENT ON FUNCTION public.fn_projecao_marcacoes_dia(uuid, date) IS
    'O que escala_diaria deveria conter para um servidor num dia, derivado das marcacoes. '
    'Fonte unica compartilhada por fn_reconciliar_marcacoes_dia e fn_conferir_reconciliacao. '
    'Alocacao de fronteira (batida de transicao) vence a do bloco na mesma linha e passo, e a '
    'linha que tem batida de transicao nao herda passo do bloco fora da janela do seu turno.';

GRANT EXECUTE ON FUNCTION public.fn_projecao_marcacoes_dia(uuid, date) TO authenticated, service_role;
