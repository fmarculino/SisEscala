-- Migration: Diagnostico de tentativas negadas - classificacao e agrupamento
-- Data: 2026-08-09
--
-- Estudo: docs/planos/2026-08-09-auditoria-logs-retencao.md (Fase C)
--
-- POR QUE ESTA E A PRIMEIRA FASE A SAIR
--   A aba "Tentativas Negadas" e a que a coordenacao mais usa, e para um fim OPERACIONAL:
--   descobrir por que a batida foi recusada e corrigir a escala. Nao e conformidade, e
--   diagnostico. Melhorar o que ja se usa vale mais que completar o que ninguem abriu.
--
-- O PROBLEMA DA TELA ATUAL
--   Ela lista linha crua de logs_tentativas_presenca, ordenada por data. Medido sobre as 981
--   tentativas de producao em 09/08/2026:
--
--     395  Matricula ou PIN invalidos          <- erro de digitacao, NAO e escala
--     171  Fora da janela de presenca
--     128  Fora da janela de ENTRADA
--     124  Fora da janela de SAIDA             (os tres somam 423 = horario divergente)
--      73  Nenhum plantao agendado
--      26  Sem escala agendada                 (os dois somam  99 = falta escala)
--      58  Voce ja registrou entrada e saida   <- comportamento normal, nao e problema
--       6  Erro interno / sem permissao        <- bug
--
--   Ou seja: 40% do que a tela mostra e erro de digitacao e 6% e comportamento correto. Os 423
--   casos que de fato apontam escala errada ficam afogados. E como quem e recusado tenta tres,
--   quatro vezes seguidas, o mesmo problema aparece como quatro linhas.
--
-- O QUE MUDA
--   Classificacao explicita, agrupamento por (servidor, dia, causa) e - o que fecha o
--   diagnostico - o DESVIO EM MINUTOS entre o horario tentado e o previsto. E o desvio que
--   separa tolerancia mal calibrada (30 min) de escala com horario errado (6 h).
--
--   A elegibilidade continua vindo de fn_tentativa_recusada_elegivel (20260809100000), que ja e
--   a fonte unica de "esta tentativa prova presenca fisica". Nao se reimplementa aqui.
--
-- SOBRE escala_prevista_inicio / fim
--   Sao HISTORICOS: gravados no instante da recusa e nunca recalculados (CLAUDE.md). E
--   justamente isso que os torna uteis para diagnostico - mostram o que o sistema cobrava NAQUELE
--   momento, que pode nao ser mais o que ele cobra hoje. Denunciam recusa por bug.


-- ============================================================================
-- 1. CLASSIFICACAO DA CAUSA
-- ============================================================================
-- Fonte unica da taxonomia. A tela nao pode reimplementar isto com ILIKE proprio - seria a
-- terceira definicao da mesma regra no sistema (CLAUDE.md, armadilha 9).

CREATE OR REPLACE FUNCTION public.fn_classificar_tentativa_negada(
    p_servidor_id uuid,
    p_mensagem    text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $fn$
    SELECT CASE
        -- Identidade nao confirmada: pode ser outra pessoa digitando errado. Nunca serve como
        -- horario de ponto, e nao diz nada sobre a escala.
        WHEN p_servidor_id IS NULL OR p_mensagem ILIKE '%matr_cula ou pin%'
            THEN 'identidade'
        -- Comportamento correto do sistema, nao e problema.
        WHEN p_mensagem ILIKE '%j_ registrou%'
            THEN 'ja_registrado'
        -- A pessoa foi trabalhar e nao estava escalada. E problema de escala, de outro tipo.
        WHEN p_mensagem ILIKE '%nenhum plant_o%' OR p_mensagem ILIKE '%sem escala%'
            THEN 'sem_escala'
        -- O alvo do diagnostico: existe escala, mas o horario nao bate.
        WHEN p_mensagem ILIKE '%janela%'
            THEN 'horario_divergente'
        WHEN p_mensagem ILIKE '%erro interno%' OR p_mensagem ILIKE '%sem permiss_o%'
            THEN 'erro_sistema'
        ELSE 'outro'
    END
$fn$;

COMMENT ON FUNCTION public.fn_classificar_tentativa_negada(uuid, text) IS
    'Causa da recusa: identidade | ja_registrado | sem_escala | horario_divergente | erro_sistema | '
    'outro. Fonte unica - a tela nao deve reclassificar por conta propria.';

GRANT EXECUTE ON FUNCTION public.fn_classificar_tentativa_negada(uuid, text) TO authenticated, service_role;


-- ============================================================================
-- 2. DESVIO EM MINUTOS
-- ============================================================================
-- Distancia entre o horario tentado e a borda RELEVANTE da escala prevista. E o numero que
-- transforma "foi recusado" em "a escala esta 6 horas errada".
--
-- A BORDA CERTA VEM DA MENSAGEM, e isso nao e detalhe. Medido sobre as 423 tentativas de
-- horario divergente em producao:
--
--     128  "Fora da janela de ENTRADA"   -> a borda que importa e o INICIO
--     124  "Fora da janela de SAIDA"     -> a borda que importa e o FIM
--     171  "Fora da janela de presenca"  -> generica: nao se sabe qual passo era
--
--   Usar sempre a borda mais proxima produz numero falso. Caso real: FRANCISCA MACEDO AMORIM,
--   08/08, previsto "null - 19:00", tentativa por volta das 07:00. Medindo contra o fim da o
--   desvio de 706 minutos e sugere escala catastroficamente errada - quando o mais provavel e
--   que a jornada comecasse as 07:00 e apenas o fim tenha sido gravado. A pessoa estava certa.
--
--   Por isso: ENTRADA mede contra o inicio, SAIDA contra o fim, e a generica cai na borda mais
--   proxima disponivel - com previsao_incompleta marcando que ali o numero e indicativo.
--
-- O wrap de 1440 existe porque plantao noturno cruza a meia-noite: tentativa as 23:50 contra
-- previsto que comeca 00:10 esta a 20 minutos, nao a 1.420.

CREATE OR REPLACE FUNCTION public.fn_desvio_tentativa_minutos(
    p_hora_tentativa  time,
    p_previsto_inicio text,
    p_previsto_fim    text,
    p_mensagem        text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
    WITH m AS (
        SELECT extract(hour from p_hora_tentativa)::int * 60
             + extract(minute from p_hora_tentativa)::int AS tentou,
               CASE WHEN p_previsto_inicio ~ '^[0-9]{1,2}:[0-9]{2}'
                    THEN split_part(p_previsto_inicio, ':', 1)::int * 60
                       + split_part(p_previsto_inicio, ':', 2)::int END AS ini,
               CASE WHEN p_previsto_fim ~ '^[0-9]{1,2}:[0-9]{2}'
                    THEN split_part(p_previsto_fim, ':', 1)::int * 60
                       + split_part(p_previsto_fim, ':', 2)::int END AS fim
    ),
    d AS (
        SELECT LEAST(abs(tentou - ini), 1440 - abs(tentou - ini)) AS d_ini,
               LEAST(abs(tentou - fim), 1440 - abs(tentou - fim)) AS d_fim
          FROM m
    )
    SELECT CASE
             -- A mensagem diz qual passo era: mede contra a borda daquele passo, e so dela.
             WHEN p_mensagem ILIKE '%janela de entrada%' THEN d_ini
             WHEN p_mensagem ILIKE '%janela de sa_da%'   THEN d_fim
             -- Generica: nao se sabe o passo. Fica a borda mais proxima.
             WHEN d_ini IS NULL AND d_fim IS NULL THEN NULL
             WHEN d_ini IS NULL THEN d_fim
             WHEN d_fim IS NULL THEN d_ini
             ELSE LEAST(d_ini, d_fim)
           END
      FROM d
$fn$;

COMMENT ON FUNCTION public.fn_desvio_tentativa_minutos(time, text, text, text) IS
    'Minutos entre a tentativa e a borda RELEVANTE da escala prevista, com wrap de meia-noite. A '
    'mensagem escolhe a borda (ENTRADA->inicio, SAIDA->fim); a generica usa a mais proxima. NULL '
    'quando a borda necessaria nao foi gravada.';

GRANT EXECUTE ON FUNCTION public.fn_desvio_tentativa_minutos(time, text, text, text)
    TO authenticated, service_role;


-- ============================================================================
-- 3. DIAGNOSTICO AGRUPADO
-- ============================================================================
-- Agrupa por (servidor, dia, causa). Quem e recusado tenta varias vezes seguidas: sem agrupar,
-- um unico problema de escala vira quatro linhas e a tela mente sobre o tamanho do problema.

CREATE OR REPLACE FUNCTION public.fn_tentativas_negadas_diagnostico(
    p_desde      date    DEFAULT NULL,
    p_ate        date    DEFAULT NULL,
    p_unidade    text    DEFAULT NULL,
    p_setor      text    DEFAULT NULL,
    p_classificacao text DEFAULT NULL,
    p_busca      text    DEFAULT NULL
)
RETURNS TABLE (
    servidor_id        uuid,
    servidor_nome      text,
    matricula          text,
    dia                date,
    unidade_nome       text,
    setor_nome         text,
    classificacao      text,
    tentativas         integer,
    primeira_em        timestamptz,
    ultima_em          timestamptz,
    previsto_inicio    text,
    previsto_fim       text,
    desvio_minutos     integer,
    previsao_incompleta boolean,
    turno_codigo       text,
    mensagem           text,
    algum_elegivel     boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH tz AS (
        SELECT COALESCE((SELECT (valor#>>'{}')::text FROM public.configuracoes_globais
                          WHERE chave = 'timezone'), 'America/Sao_Paulo') AS zona
    ),
    base AS (
        SELECT l.servidor_id,
               COALESCE(s.nome, l.nome_servidor_detectado, '(não identificado)') AS nome,
               COALESCE(s.matricula, l.matricula_digitada)                        AS matricula,
               (l.data_hora_tentativa AT TIME ZONE tz.zona)::date                 AS dia,
               (l.data_hora_tentativa AT TIME ZONE tz.zona)::time                 AS hora,
               l.data_hora_tentativa,
               l.unidade_nome, l.setor_nome, l.turno_codigo, l.mensagem_erro,
               l.escala_prevista_inicio, l.escala_prevista_fim,
               public.fn_classificar_tentativa_negada(l.servidor_id, l.mensagem_erro) AS classe,
               public.fn_tentativa_recusada_elegivel(l.servidor_id, l.mensagem_erro)  AS elegivel
          FROM public.logs_tentativas_presenca l
          CROSS JOIN tz
          LEFT JOIN public.servidores s ON s.id = l.servidor_id
         WHERE (p_desde IS NULL OR (l.data_hora_tentativa AT TIME ZONE tz.zona)::date >= p_desde)
           AND (p_ate   IS NULL OR (l.data_hora_tentativa AT TIME ZONE tz.zona)::date <= p_ate)
           AND (p_unidade IS NULL OR l.unidade_nome = p_unidade)
           AND (p_setor   IS NULL OR l.setor_nome   = p_setor)
           AND (p_busca IS NULL OR btrim(p_busca) = '' OR
                COALESCE(s.nome, l.nome_servidor_detectado, '') ILIKE '%' || p_busca || '%' OR
                COALESCE(s.matricula, l.matricula_digitada, '') ILIKE '%' || p_busca || '%')
    )
    SELECT b.servidor_id,
           min(b.nome), min(b.matricula),
           b.dia,
           min(b.unidade_nome), min(b.setor_nome),
           b.classe,
           count(*)::integer,
           min(b.data_hora_tentativa), max(b.data_hora_tentativa),
           min(b.escala_prevista_inicio), min(b.escala_prevista_fim),
           -- O MENOR desvio do grupo: se a pessoa insistiu, o que interessa e o quanto ela chegou
           -- perto na melhor tentativa. Um desvio pequeno aponta tolerancia; um grande, escala errada.
           min(public.fn_desvio_tentativa_minutos(b.hora, b.escala_prevista_inicio,
                                                  b.escala_prevista_fim, b.mensagem_erro)),
           -- Mensagem generica com apenas uma borda gravada: nao se sabe se a pessoa tentava
           -- entrar ou sair, entao o desvio e indicativo e nao conclusivo. A tela deve dizer isso.
           bool_or(b.mensagem_erro NOT ILIKE '%janela de entrada%'
               AND b.mensagem_erro NOT ILIKE '%janela de sa_da%'
               AND (b.escala_prevista_inicio IS NULL OR b.escala_prevista_fim IS NULL)),
           min(b.turno_codigo),
           min(b.mensagem_erro),
           bool_or(b.elegivel)
      FROM base b
     WHERE p_classificacao IS NULL OR b.classe = p_classificacao
     GROUP BY b.servidor_id, b.dia, b.classe
     ORDER BY b.dia DESC, min(b.data_hora_tentativa) DESC
$fn$;

COMMENT ON FUNCTION public.fn_tentativas_negadas_diagnostico(date, date, text, text, text, text) IS
    'Tentativas negadas agrupadas por (servidor, dia, causa), com desvio em minutos. Substitui a '
    'listagem crua: 40% das linhas eram erro de digitacao e 6% comportamento normal, afogando os '
    'casos que apontam escala errada.';

GRANT EXECUTE ON FUNCTION public.fn_tentativas_negadas_diagnostico(date, date, text, text, text, text)
    TO authenticated, service_role;


-- ============================================================================
-- 4. RESUMO POR CAUSA (os cartoes do topo da aba)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_tentativas_negadas_resumo(
    p_desde date DEFAULT NULL,
    p_ate   date DEFAULT NULL
)
RETURNS TABLE (classificacao text, tentativas integer, servidores_dias integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH tz AS (
        SELECT COALESCE((SELECT (valor#>>'{}')::text FROM public.configuracoes_globais
                          WHERE chave = 'timezone'), 'America/Sao_Paulo') AS zona
    ),
    base AS (
        SELECT public.fn_classificar_tentativa_negada(l.servidor_id, l.mensagem_erro) AS classe,
               l.servidor_id,
               (l.data_hora_tentativa AT TIME ZONE tz.zona)::date AS dia
          FROM public.logs_tentativas_presenca l
          CROSS JOIN tz
         WHERE (p_desde IS NULL OR (l.data_hora_tentativa AT TIME ZONE tz.zona)::date >= p_desde)
           AND (p_ate   IS NULL OR (l.data_hora_tentativa AT TIME ZONE tz.zona)::date <= p_ate)
    )
    SELECT classe, count(*)::integer, count(DISTINCT (servidor_id, dia))::integer
      FROM base GROUP BY classe ORDER BY 2 DESC
$fn$;

COMMENT ON FUNCTION public.fn_tentativas_negadas_resumo(date, date) IS
    'Contagem por causa, em tentativas e em casos distintos (servidor x dia). A diferenca entre as '
    'duas mostra o quanto a insistencia infla a leitura.';

GRANT EXECUTE ON FUNCTION public.fn_tentativas_negadas_resumo(date, date) TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
-- Os numeros abaixo foram VALIDADOS por simulacao em JS sobre as 981 tentativas reais de
-- producao antes desta migration ser escrita. Divergencia aponta erro na traducao para SQL.
--
--   1. O resumo bate com a contagem crua (soma tem de dar exatamente 981):
--
--      SELECT * FROM public.fn_tentativas_negadas_resumo();
--      -- esperado, exato:
--      --   horario_divergente 423
--      --   identidade         395
--      --   sem_escala          99
--      --   ja_registrado       58
--      --   erro_sistema         6
--      --   (nada em 'outro' - se aparecer, surgiu mensagem nova no terminal)
--
--   2. O agrupamento corta o ruido pela metade (esperado: 495 casos, de 981 tentativas):
--
--      SELECT count(*) FROM public.fn_tentativas_negadas_diagnostico();
--
--   3. Os casos que interessam, do pior desvio para o melhor (esperado: 239 casos,
--      todos com desvio calculavel; min 6, p50 67, p90 502, max 714 minutos):
--
--      SELECT servidor_nome, dia, previsto_inicio, previsto_fim,
--             desvio_minutos, previsao_incompleta, tentativas
--        FROM public.fn_tentativas_negadas_diagnostico(NULL, NULL, NULL, NULL, 'horario_divergente')
--       ORDER BY desvio_minutos DESC NULLS LAST LIMIT 20;
--      -- o pior conhecido: VANESSA LEONCIO DA SILVA, 31/07, previsto 08:00-18:00, 714 min -
--      -- tentativa de SAIDA por volta das 06:00 num turno que encerra as 18:00. Turno noturno
--      -- cadastrado como diurno e a hipotese mais provavel.
--
--   4. Quantos ficam com desvio apenas indicativo (esperado: 56 de 239):
--
--      SELECT count(*) FROM public.fn_tentativas_negadas_diagnostico(NULL,NULL,NULL,NULL,'horario_divergente')
--       WHERE previsao_incompleta;
--
--   5. Coerencia com a fonte unica de elegibilidade: todo 'horario_divergente' tem servidor
--      identificado, entao todos devem ser elegiveis (esperado: 239 true, 0 false):
--
--      SELECT classificacao, algum_elegivel, count(*)
--        FROM public.fn_tentativas_negadas_diagnostico() GROUP BY 1, 2 ORDER BY 1;
