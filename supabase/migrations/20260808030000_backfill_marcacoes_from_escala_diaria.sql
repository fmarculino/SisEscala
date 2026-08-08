-- Migration: Backfill de marcacoes_ponto a partir do historico de escala_diaria
-- Data: 2026-08-08
--
-- OBJETIVO
--   Materializar como marcacoes todo horario de presenca ja registrado em escala_diaria, para
--   que marcacoes_ponto seja a serie historica completa desde o inicio - e nao comece a existir
--   so a partir da Fase 3. Sem isso, a reconciliacao da Fase 2 nao teria com o que comparar e
--   o modulo de marcacoes mostraria o passado vazio.
--
-- IDEMPOTENCIA E POR QUE ELA E OBRIGATORIA AQUI
--   marcacoes_ponto e INSERT-only: o trigger de 20260808010000 bloqueia UPDATE e DELETE.
--   Ou seja, NAO existe "rodar de novo e corrigir" - uma linha errada fica.
--
--   A solucao e o id DETERMINISTICO: cada marcacao de backfill recebe
--       md5('sisescala:backfill:' || escala_diaria.id || ':' || passo)::uuid
--   Rodar esta migration duas vezes produz exatamente os mesmos ids, e o
--   ON CONFLICT (id) DO NOTHING torna a segunda execucao um no-op.
--
--   md5(text)::uuid e usado em vez de uuid_generate_v5 para nao depender da extensao
--   uuid-ossp estar presente nos dois bancos (CLAUDE.md armadilha 3).
--
-- COMO A ORIGEM E DEDUZIDA
--   presenca_X_manual = true  -> ajuste_coordenador  (validacao manual pela grade)
--   presenca_X_manual = false -> terminal            (batida no terminal web)
--
--   Limite conhecido e aceito: as flags nasceram em 20260804000000 e 20260804030000. Linhas
--   anteriores tem false por DEFAULT mesmo quando a validacao foi manual, e por isso entram
--   como 'terminal'. Nao ha heuristica segura para recuperar isso - inferir por timestamp
--   redondo classificaria batidas reais de terminal como manuais, que e o erro mais grave dos
--   dois. O campo 'sintetica' registra o indicio sem afirmar a origem.
--
-- SINTETICA
--   Timestamps com segundos exatamente zero sao horarios DERIVADOS da jornada, nao batidos:
--   e assim que a validacao manual grava, e e assim que fn_salvar_saida_bloco (20260706115000)
--   fabrica ate 5 timestamps numa unica batida de saida de bloco multi-turno. Batida real de
--   terminal carrega segundos e microssegundos.
--
--   'sintetica' e um INDICIO factual, independente de 'origem': existe marcacao de origem
--   'terminal' que e sintetica (as fabricadas pelo bloco) e marcacao manual que nao e.
--
-- ESTA MIGRATION NAO MUDA NENHUM COMPORTAMENTO
--   Apenas popula uma tabela nova. escala_diaria nao e tocada; o terminal, a grade e a folha
--   de ponto seguem lendo exatamente o que liam antes.


-- ============================================================================
-- BACKFILL
-- ============================================================================

INSERT INTO public.marcacoes_ponto (
    id,
    servidor_id,
    origem,
    ocorrido_em,
    registrado_em,
    coordenador_id,
    registrado_por_id,
    unidade_id,
    setor_id,
    sintetica,
    retroativa,
    observacao
)
SELECT
    md5('sisescala:backfill:' || ed.id::text || ':' || p.passo)::uuid,
    em.servidor_id,
    CASE WHEN p.manual
         THEN 'ajuste_coordenador'::public.marcacao_origem
         ELSE 'terminal'::public.marcacao_origem
    END,
    p.ts,
    -- Quando a marcacao entrou no sistema: o melhor proxy disponivel e o updated_at da linha.
    COALESCE(ed.updated_at, ed.created_at, p.ts),
    -- confirmado_por_id guarda o coordenador do terminal OU o validador manual, conforme o
    -- caminho que gravou. Separar os dois papeis aqui e o que permite auditar depois.
    CASE WHEN p.manual THEN NULL ELSE ed.confirmado_por_id END,
    CASE WHEN p.manual THEN ed.confirmado_por_id ELSE NULL END,
    em.unidade_id,
    em.setor_id,
    (date_part('second', p.ts) = 0),
    true,
    'Backfill 20260808030000 - escala_diaria ' || ed.id::text || ' passo ' || p.passo
FROM public.escala_diaria ed
JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
CROSS JOIN LATERAL (
    VALUES
        ('entrada',           ed.presenca_entrada_em,           COALESCE(ed.presenca_entrada_manual, false)),
        ('intervalo_saida',   ed.presenca_intervalo_saida_em,   COALESCE(ed.presenca_intervalo_saida_manual, false)),
        ('intervalo_retorno', ed.presenca_intervalo_retorno_em, COALESCE(ed.presenca_intervalo_retorno_manual, false)),
        ('saida',             ed.presenca_saida_em,             COALESCE(ed.presenca_saida_manual, false))
) AS p(passo, ts, manual)
WHERE p.ts IS NOT NULL
  AND em.servidor_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;


-- CONFERENCIA APOS APLICAR
--
--   1) PORTAO PRINCIPAL - a contagem tem que bater exatamente.
--      O total de marcacoes retroativas deve ser igual a soma dos 4 campos de presenca
--      preenchidos em escala_diaria (de linhas com servidor vinculado):
--
--   WITH esperado AS (
--       SELECT count(*) FILTER (WHERE ed.presenca_entrada_em           IS NOT NULL)
--            + count(*) FILTER (WHERE ed.presenca_intervalo_saida_em   IS NOT NULL)
--            + count(*) FILTER (WHERE ed.presenca_intervalo_retorno_em IS NOT NULL)
--            + count(*) FILTER (WHERE ed.presenca_saida_em             IS NOT NULL) AS n
--         FROM public.escala_diaria ed
--         JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--        WHERE em.servidor_id IS NOT NULL
--   ), obtido AS (
--       SELECT count(*) AS n FROM public.marcacoes_ponto WHERE retroativa
--   )
--   SELECT esperado.n AS esperado, obtido.n AS obtido,
--          (esperado.n = obtido.n) AS bateu
--     FROM esperado, obtido;
--   -- 'bateu' PRECISA ser true. Se for false, NAO prossiga para a Fase 2.
--
--   2) Distribuicao por origem e sinteticas:
--
--   SELECT origem, count(*) AS total,
--          count(*) FILTER (WHERE sintetica) AS sinteticas
--     FROM public.marcacoes_ponto
--    WHERE retroativa
--    GROUP BY origem
--    ORDER BY public.fn_precedencia_origem(origem);
--
--   3) Nenhuma marcacao pode ter caido em linha de Sobreaviso (esperado: 0):
--      (a constraint chk_sobreaviso_sem_presenca ja garante isso, e esta consulta confirma)
--
--   SELECT count(*)
--     FROM public.marcacoes_ponto m
--     JOIN public.escala_mensal em ON em.servidor_id = m.servidor_id
--     JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
--    WHERE m.retroativa
--      AND ed.categoria = 'Sobreaviso'
--      AND (ed.presenca_entrada_em IS NOT NULL OR ed.presenca_saida_em IS NOT NULL);
--
--   4) IDEMPOTENCIA - rodar o INSERT desta migration uma segunda vez deve inserir 0 linhas.
--      Confira que a contagem de (1) nao muda apos a segunda execucao.
--
--   5) A imutabilidade continua valendo sobre os dados recem-inseridos (deve FALHAR):
--
--   -- UPDATE public.marcacoes_ponto SET ocorrido_em = now() WHERE retroativa LIMIT 1;
