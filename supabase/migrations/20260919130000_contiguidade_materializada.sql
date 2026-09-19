-- ============================================================================
-- A contiguidade do AFD vira COLUNA: calcular 35 vezes por tela nao escala (19/09/2026)
-- ============================================================================
--
-- 🚨 Medido em producao logo depois de aplicar a 20260919110000:
-- `fn_vigilancia_coleta_parque` estourava o statement_timeout em 8,0s, DETERMINISTICAMENTE
-- (3 de 3 tentativas). A causa nao e' a funcao nova: e' `fn_cursor_afd_dispositivo`, que faz uma
-- window function sobre TODOS os NSRs de um dispositivo -- 185ms a 470ms por relogio, com cache
-- quente, e o HMM-03 sozinho tem 426.593 linhas. Trinta e cinco relogios dao ~9,8s.
--
-- ⚠️ Isto nao e regressao da 110000: `fn_lacunas_afd_parque` (v2.74.0) ja fazia o mesmo e passava
-- POR POUCO. O parque cresceu de 6 para 35 relogios em um mes -- a conta ia estourar de qualquer
-- forma, e a 110000 so' adiantou o encontro. Pela mesma razao, baixar o custo em 20% nao resolve:
-- o problema e a estrutura O(relogios x linhas) por carregamento de tela.
--
-- A correcao e materializar: o trecho contiguo so muda quando chega NSR novo, e isso acontece a
-- cada ~5 min por dispositivo -- nao a cada vez que alguem abre a tela.
--
-- 🚨 ONDE atualizar importa mais que o calculo. NAO entra em `fn_ingerir_afd` nem na rota de
-- ingestao: foi exatamente somar trabalho ao caminho da ingestao que travou o REP-iDClass-HMI-01
-- por 38 horas (19/09/2026). Entra no HEARTBEAT, que e' frequente (5 min), barato, ja escreve em
-- `dispositivos_rep` e nao tem lote de AFD em voo.

-- ----------------------------------------------------------------------------
-- 1. As colunas
-- ----------------------------------------------------------------------------
ALTER TABLE public.dispositivos_rep
    ADD COLUMN IF NOT EXISTS nsr_contiguo_ate bigint,
    ADD COLUMN IF NOT EXISTS nsr_contiguo_em  timestamptz;

COMMENT ON COLUMN public.dispositivos_rep.nsr_contiguo_ate IS
    'Cache do proximo NSR a pedir (fn_cursor_afd_dispositivo), atualizado pelo heartbeat. NULL = '
    'nunca calculado; NAO significa "sem lacuna". A COLETA continua usando a funcao, sempre: este '
    'campo serve so para a tela e o alerta nao recalcularem 35 window functions por carregamento.';
COMMENT ON COLUMN public.dispositivos_rep.nsr_contiguo_em IS
    'Quando nsr_contiguo_ate foi calculado. Separa "cache fresco" de "numero velho de um relogio '
    'que parou de falar" -- sem isto, um dispositivo sem coletor pareceria em dia para sempre.';

-- ----------------------------------------------------------------------------
-- 2. fn_atualizar_contiguidade_dispositivo
-- ----------------------------------------------------------------------------
-- ⚠️ Nao reimplementa a regra do cursor: CHAMA `fn_cursor_afd_dispositivo`. Uma segunda
-- implementacao da contiguidade divergiria da que decide a COLETA, e aí a tela diria uma coisa e
-- o coletor pediria outra.

CREATE OR REPLACE FUNCTION public.fn_atualizar_contiguidade_dispositivo(p_dispositivo_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_cursor bigint;
BEGIN
    v_cursor := public.fn_cursor_afd_dispositivo(p_dispositivo_id);
    UPDATE public.dispositivos_rep
       SET nsr_contiguo_ate = v_cursor, nsr_contiguo_em = now()
     WHERE id = p_dispositivo_id;
    RETURN v_cursor;
END;
$fn$;

COMMENT ON FUNCTION public.fn_atualizar_contiguidade_dispositivo(uuid) IS
    'Recalcula e grava o cache de contiguidade de UM dispositivo. Chamada pelo heartbeat (a cada '
    '~5 min por relogio), nunca pela ingestao: somar trabalho ao caminho do lote de AFD e o que '
    'travou o HMI-01 por 38h. Ver 20260919130000.';

REVOKE ALL ON FUNCTION public.fn_atualizar_contiguidade_dispositivo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_atualizar_contiguidade_dispositivo(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. fn_vigilancia_coleta_parque passa a LER o cache
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_vigilancia_coleta_parque();

CREATE OR REPLACE FUNCTION public.fn_vigilancia_coleta_parque()
RETURNS TABLE (
    dispositivo_id     uuid,
    dispositivo_nome   text,
    unidade_id         uuid,
    unidade_nome       text,
    coletor_host       text,
    modo_operacao      text,
    ultimo_contato_em  timestamptz,
    horas_sem_contato  numeric,
    ultimo_nsr         bigint,
    proximo_nsr        bigint,
    nsr_faltando       bigint,
    lacuna_desde       timestamptz,
    horas_travado      numeric,
    nsr_device         bigint,
    nsr_device_em      timestamptz,
    batidas_presas     bigint,
    severidade         smallint,
    motivo             text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH base AS MATERIALIZED (
        -- MATERIALIZED nao e' enfeite: sem ele o planner reavalia as expressoes a cada referencia
        -- nas CTEs seguintes, e foi parte do que fez a versao anterior passar de 8s.
        SELECT d.id, d.nome, d.unidade_id, u.nome AS unidade_nome, d.coletor_host,
               d.modo_operacao, d.ultimo_contato_em, d.geracao_atual,
               COALESCE(d.ultimo_nsr, 0)::bigint AS ultimo_nsr,
               d.nsr_contiguo_ate AS proximo_nsr,
               d.nsr_contiguo_em,
               d.nsr_device, d.nsr_device_em
          FROM public.dispositivos_rep d
          JOIN public.unidades u ON u.id = d.unidade_id
         WHERE d.ativo
           AND public.fn_escopo_gestao_alcanca(d.unidade_id)
    ),
    calc AS MATERIALIZED (
        SELECT b.*,
               ROUND(EXTRACT(EPOCH FROM (now() - b.ultimo_contato_em)) / 3600.0, 1) AS horas_sem_contato,
               -- ⚠️ `proximo_nsr` NULL (cache nunca calculado) NAO vira lacuna. Mesma regra de
               -- nsr_device: "nao sei" e diferente de "esta em dia", e afirmar lacuna sem ter
               -- medido encheria a tela de alarme falso no dia em que a coluna nasceu.
               CASE WHEN b.proximo_nsr IS NOT NULL AND b.ultimo_nsr > 0 AND b.proximo_nsr <= b.ultimo_nsr
                    THEN (b.ultimo_nsr - b.proximo_nsr + 1)::bigint END AS nsr_faltando,
               CASE WHEN b.nsr_device IS NOT NULL AND b.nsr_device > b.ultimo_nsr
                    THEN (b.nsr_device - b.ultimo_nsr)::bigint END AS batidas_presas
          FROM base b
    ),
    ant AS (
        SELECT c.*, a.ocorrido_em AS lacuna_desde
          FROM calc c
          LEFT JOIN LATERAL (
              SELECT r.ocorrido_em
                FROM public.rep_afd_registros r
               WHERE c.nsr_faltando IS NOT NULL
                 AND r.dispositivo_id = c.id
                 AND r.geracao = c.geracao_atual
                 AND r.nsr = c.proximo_nsr - 1
               LIMIT 1
          ) a ON TRUE
    )
    SELECT a.id, a.nome, a.unidade_id, a.unidade_nome, a.coletor_host, a.modo_operacao,
           a.ultimo_contato_em, a.horas_sem_contato,
           a.ultimo_nsr, a.proximo_nsr, a.nsr_faltando,
           a.lacuna_desde,
           ROUND(EXTRACT(EPOCH FROM (now() - a.lacuna_desde)) / 3600.0, 1) AS horas_travado,
           a.nsr_device, a.nsr_device_em, a.batidas_presas,
           CASE
               WHEN a.nsr_faltando IS NOT NULL OR COALESCE(a.batidas_presas, 0) > 0 THEN 2::smallint
               WHEN a.modo_operacao <> 'usb' AND COALESCE(a.horas_sem_contato, 999) >= 6 THEN 1::smallint
               ELSE 0::smallint
           END AS severidade,
           CASE
               WHEN a.nsr_faltando IS NOT NULL AND COALESCE(a.batidas_presas, 0) > 0
                   THEN format('%s registro(s) coletados nao guardados e %s ainda no equipamento',
                               a.nsr_faltando, a.batidas_presas)
               WHEN a.nsr_faltando IS NOT NULL
                   THEN format('%s registro(s) entregues pelo equipamento e nao guardados', a.nsr_faltando)
               WHEN COALESCE(a.batidas_presas, 0) > 0
                   THEN format('%s batida(s) registradas no equipamento e ainda nao coletadas', a.batidas_presas)
               WHEN a.modo_operacao <> 'usb' AND COALESCE(a.horas_sem_contato, 999) >= 6
                   THEN format('a maquina %s nao coleta ha %s h',
                               COALESCE(a.coletor_host, 'da unidade'),
                               COALESCE(a.horas_sem_contato::text, 'muitas'))
               ELSE NULL
           END AS motivo
      FROM ant a
     ORDER BY 18 DESC, a.nsr_faltando DESC NULLS LAST, a.batidas_presas DESC NULLS LAST, a.nome;
$fn$;

COMMENT ON FUNCTION public.fn_vigilancia_coleta_parque() IS
    'Estado da coleta de cada relogio ativo no escopo de gestao: lacuna de NSR, batidas presas no '
    'equipamento e horas sem contato. LE o cache dispositivos_rep.nsr_contiguo_ate -- calcular o '
    'cursor dos 35 relogios por carregamento custava ~9,8s e estourava o timeout. Ver 20260919130000.';

REVOKE ALL ON FUNCTION public.fn_vigilancia_coleta_parque() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_vigilancia_coleta_parque() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Backfill: sem ele a tela nasce sem saber de nada
-- ----------------------------------------------------------------------------
-- Laco explicito, um dispositivo por vez, para nao montar uma unica consulta de ~10s. Roda uma
-- vez, na aplicacao da migration; depois o heartbeat mantem.
DO $backfill$
DECLARE
    r record;
    n integer := 0;
BEGIN
    FOR r IN SELECT id FROM public.dispositivos_rep WHERE ativo LOOP
        PERFORM public.fn_atualizar_contiguidade_dispositivo(r.id);
        n := n + 1;
    END LOOP;
    RAISE NOTICE 'contiguidade calculada para % dispositivo(s) ativo(s)', n;
END
$backfill$;

-- ============================================================================
-- CONFERENCIA -- EXECUTA a funcao e MEDE o tempo. Conferir que ela "existe" nao serve: o defeito
-- que esta migration corrige e' justamente de DESEMPENHO, e so aparece executando.
-- ============================================================================
DO $conf$
DECLARE
    v_ini    timestamptz;
    v_ms     numeric;
    v_n      integer;
    v_nulos  integer;
BEGIN
    v_ini := clock_timestamp();
    SELECT count(*) INTO v_n FROM public.fn_vigilancia_coleta_parque();
    v_ms := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;
    RAISE NOTICE 'fn_vigilancia_coleta_parque: % relogio(s) em % ms', v_n, round(v_ms);

    -- O teto e generoso de proposito (o statement_timeout de authenticated e 8s); o que nao pode
    -- e' continuar na casa dos segundos, que era o estado anterior.
    IF v_ms > 2000 THEN
        RAISE EXCEPTION 'fn_vigilancia_coleta_parque levou % ms -- o cache nao esta sendo usado', round(v_ms);
    END IF;

    -- O backfill precisa ter alcancado TODO dispositivo ativo: com a coluna NULL a funcao nao
    -- afirma lacuna nenhuma, e o silencio pareceria "esta tudo bem".
    SELECT count(*) INTO v_nulos
      FROM public.dispositivos_rep WHERE ativo AND nsr_contiguo_ate IS NULL;
    IF v_nulos > 0 THEN
        RAISE EXCEPTION '% dispositivo(s) ativo(s) ficaram sem contiguidade calculada', v_nulos;
    END IF;

    -- O cache precisa CONCORDAR com a funcao que decide a coleta. Divergencia aqui e' a tela
    -- dizendo uma coisa e o coletor pedindo outra. Conferido numa amostra para nao pagar os ~10s.
    IF EXISTS (
        SELECT 1 FROM (SELECT id, nsr_contiguo_ate FROM public.dispositivos_rep WHERE ativo LIMIT 5) d
         WHERE d.nsr_contiguo_ate IS DISTINCT FROM public.fn_cursor_afd_dispositivo(d.id)
    ) THEN
        RAISE EXCEPTION 'cache de contiguidade divergiu de fn_cursor_afd_dispositivo';
    END IF;

    -- Envelope continua concordando com a fonte.
    IF (SELECT count(*) FROM public.fn_lacunas_afd_parque())
       <> (SELECT count(*) FROM public.fn_vigilancia_coleta_parque() WHERE nsr_faltando IS NOT NULL) THEN
        RAISE EXCEPTION 'fn_lacunas_afd_parque divergiu de fn_vigilancia_coleta_parque';
    END IF;

    IF has_function_privilege('anon', 'public.fn_vigilancia_coleta_parque()', 'EXECUTE') THEN
        RAISE EXCEPTION 'fn_vigilancia_coleta_parque executavel por anon';
    END IF;
    IF has_function_privilege('authenticated', 'public.fn_atualizar_contiguidade_dispositivo(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'fn_atualizar_contiguidade_dispositivo nao pode ser executavel por authenticated';
    END IF;

    RAISE NOTICE 'Conferencia de 20260919130000 OK.';
END
$conf$;
