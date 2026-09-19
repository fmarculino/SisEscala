-- ============================================================================
-- Vigilancia da coleta de ponto: o que o relogio registrou e ainda nao chegou (19/09/2026)
-- ============================================================================
--
-- A 20260919100000 fechou METADE do ponto cego. `fn_lacunas_afd_parque` pega "o equipamento
-- entregou e a ingestao nao guardou" -- um buraco no meio da sequencia de NSR. Ela e CEGA para o
-- outro caso, que e o mais comum: **a maquina da unidade nao esta coletando**. Ali nao se forma
-- buraco nenhum, so' ausencia: o coletor nem pede o AFD, `ultimo_nsr` para de subir e o cursor
-- continua em `ultimo_nsr + 1`. Estado perfeitamente consistente, com o ponto do dia inteiro
-- parado dentro do equipamento.
--
-- ✅ Medido em 19/09/2026, a mao, indo aos equipamentos um a um: dos 35 relogios ativos, **19
-- estavam com a maquina sem contato ha mais de 2h e 15 ha mais de 14h**, com **113 batidas
-- presas** nos 15 que responderam. NENHUMA delas aparecia como lacuna.
--
-- 🚨 A peca que faltava ja existia e estava orfa: `rep.InformacoesSistema()` (rep/client.go) le
-- `get_system_information.fcgi`, cuja resposta traz **`last_nsr`** -- o maior NSR que o
-- EQUIPAMENTO tem. Nenhum caminho do coletor a chamava. Com esse numero no heartbeat, o servidor
-- passa a calcular, sem nenhuma rota ate a rede da unidade:
--
--     batidas_presas = nsr_device (equipamento) - ultimo_nsr (ingerido)
--
-- Isso teria detectado o caso do REP-iDClass-HMI-01 no PRIMEIRO ciclo, e nao em 38 horas.
--
-- ⚠️ Campo AUSENTE nao e zero. Coletor anterior a v0.19.0 nao manda nada, e "nao sei" precisa ser
-- distinguivel de "esta em dia" -- senao o parque inteiro nasce aparentando perfeicao. Por isso
-- `nsr_device_em` anda junto, mesma convencao de `usuarios_lidos_em` (20260906130000).

-- ----------------------------------------------------------------------------
-- 1. As colunas
-- ----------------------------------------------------------------------------
ALTER TABLE public.dispositivos_rep
    ADD COLUMN IF NOT EXISTS nsr_device    bigint,
    ADD COLUMN IF NOT EXISTS nsr_device_em timestamptz;

COMMENT ON COLUMN public.dispositivos_rep.nsr_device IS
    'Maior NSR que o EQUIPAMENTO declara ter (get_system_information.last_nsr), reportado pelo '
    'coletor no heartbeat desde a v0.19.0. NULL = nenhum coletor reportou ainda; NAO significa '
    'zero. Comparado com ultimo_nsr, diz quanto ponto esta registrado no relogio e nao chegou.';
COMMENT ON COLUMN public.dispositivos_rep.nsr_device_em IS
    'Quando nsr_device foi reportado. E o que separa "leitura velha" de "leitura recente": com a '
    'maquina desligada o numero congela, e sem esta coluna pareceria atual para sempre.';

-- ----------------------------------------------------------------------------
-- 2. fn_vigilancia_coleta_parque: fonte unica dos TRES sinais
-- ----------------------------------------------------------------------------
-- Os tres respondem perguntas diferentes e nenhum cobre o outro:
--
--   nsr_faltando    > 0  -> entregou e NAO guardamos ....... a INGESTAO esta falhando
--   batidas_presas  > 0  -> registrou e NAO entregou ....... a COLETA esta parada
--   horas_sem_contato    -> a maquina nao fala conosco ..... o COMPUTADOR esta fora
--
-- Uma funcao so' de proposito: a tela, o resumo e a rotina diaria precisam concordar. Duas
-- implementacoes da mesma pergunta divergem na primeira mudanca.

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
    -- `severidade` e ORDENAVEL de proposito (2 = pior). A tela nao recalcula regra nenhuma.
    severidade         smallint,
    motivo             text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH base AS (
        SELECT d.id, d.nome, d.unidade_id, u.nome AS unidade_nome, d.coletor_host,
               d.modo_operacao, d.ultimo_contato_em, d.geracao_atual,
               COALESCE(d.ultimo_nsr, 0)::bigint AS ultimo_nsr,
               public.fn_cursor_afd_dispositivo(d.id) AS proximo_nsr,
               d.nsr_device, d.nsr_device_em
          FROM public.dispositivos_rep d
          JOIN public.unidades u ON u.id = d.unidade_id
         WHERE d.ativo
           AND public.fn_escopo_gestao_alcanca(d.unidade_id)
    ),
    calc AS (
        SELECT b.*,
               ROUND(EXTRACT(EPOCH FROM (now() - b.ultimo_contato_em)) / 3600.0, 1) AS horas_sem_contato,
               CASE WHEN b.ultimo_nsr > 0 AND b.proximo_nsr <= b.ultimo_nsr
                    THEN (b.ultimo_nsr - b.proximo_nsr + 1)::bigint END AS nsr_faltando,
               -- So conta presa o que o equipamento declara ter A MAIS do que foi ingerido.
               -- nsr_device NULL (coletor antigo) devolve NULL, nunca 0: "nao sei" e diferente
               -- de "esta em dia", e tratar um pelo outro e o defeito que esta funcao existe
               -- para nao cometer.
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
               -- 2 = ponto REGISTRADO que nao chegou. E o unico caso em que existe, agora, dado
               -- de ponto fora do SisEscala -- os outros sao risco, este e fato.
               WHEN a.nsr_faltando IS NOT NULL OR COALESCE(a.batidas_presas, 0) > 0 THEN 2::smallint
               -- 1 = ninguem coleta ha tempo demais. Pode nao haver batida nenhuma esperando
               -- (unidade fechada), mas tambem nao ha como saber -- e nao saber ja e o problema.
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
    'Estado da coleta de cada relogio ativo no escopo de gestao, com os TRES sinais que nao se '
    'cobrem: lacuna de NSR (a ingestao falha), batidas presas no equipamento (a coleta parou) e '
    'horas sem contato (a maquina esta fora). Fonte unica da tela e da rotina diaria. '
    'Ver 20260919110000.';

REVOKE ALL ON FUNCTION public.fn_vigilancia_coleta_parque() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_vigilancia_coleta_parque() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. fn_lacunas_afd_parque vira ENVELOPE da nova
-- ----------------------------------------------------------------------------
-- Ela ja esta em producao e a tela a usa. Reescrita como envelope para nao existirem DUAS
-- implementacoes da mesma pergunta -- a assinatura de saida nao muda, entao nada quebra se o
-- deploy do frontend vier antes ou depois desta migration.

DROP FUNCTION IF EXISTS public.fn_lacunas_afd_parque();

CREATE OR REPLACE FUNCTION public.fn_lacunas_afd_parque()
RETURNS TABLE (
    dispositivo_id     uuid,
    dispositivo_nome   text,
    unidade_id         uuid,
    unidade_nome       text,
    coletor_host       text,
    ultimo_contato_em  timestamptz,
    ultimo_nsr         bigint,
    proximo_nsr        bigint,
    nsr_faltando       bigint,
    lacuna_desde       timestamptz,
    horas_travado      numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT v.dispositivo_id, v.dispositivo_nome, v.unidade_id, v.unidade_nome, v.coletor_host,
           v.ultimo_contato_em, v.ultimo_nsr, v.proximo_nsr, v.nsr_faltando,
           v.lacuna_desde, v.horas_travado
      FROM public.fn_vigilancia_coleta_parque() v
     WHERE v.nsr_faltando IS NOT NULL;
$fn$;

COMMENT ON FUNCTION public.fn_lacunas_afd_parque() IS
    'So os relogios com LACUNA de NSR. Envelope de fn_vigilancia_coleta_parque desde '
    '20260919110000 -- a regra vive la, para tela e rotina diaria nao divergirem.';

REVOKE ALL ON FUNCTION public.fn_lacunas_afd_parque() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_lacunas_afd_parque() TO authenticated, service_role;

-- ============================================================================
-- CONFERENCIA -- EXECUTA as duas funcoes (armadilha 42) e confere os DOIS sentidos.
-- ============================================================================
DO $conf$
DECLARE
    v_n       integer;
    v_lac     integer;
    v_erro    text;
BEGIN
    BEGIN
        SELECT count(*) INTO v_n FROM public.fn_vigilancia_coleta_parque();
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_erro = MESSAGE_TEXT;
        RAISE EXCEPTION 'fn_vigilancia_coleta_parque nao executou: %', v_erro;
    END;
    RAISE NOTICE 'fn_vigilancia_coleta_parque executou: % relogio(s)', v_n;

    BEGIN
        SELECT count(*) INTO v_lac FROM public.fn_lacunas_afd_parque();
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_erro = MESSAGE_TEXT;
        RAISE EXCEPTION 'fn_lacunas_afd_parque (envelope) nao executou: %', v_erro;
    END;
    RAISE NOTICE 'fn_lacunas_afd_parque executou: % com lacuna', v_lac;

    -- O envelope precisa concordar com a fonte, senao voltamos a ter duas verdades.
    IF v_lac <> (SELECT count(*) FROM public.fn_vigilancia_coleta_parque() WHERE nsr_faltando IS NOT NULL) THEN
        RAISE EXCEPTION 'fn_lacunas_afd_parque divergiu de fn_vigilancia_coleta_parque';
    END IF;

    -- Nenhum relogio EM DIA pode ter severidade > 0: alarme em toda linha e alarme que ninguem le.
    IF EXISTS (
        SELECT 1 FROM public.fn_vigilancia_coleta_parque() v
         WHERE v.severidade > 0
           AND v.nsr_faltando IS NULL
           AND COALESCE(v.batidas_presas, 0) = 0
           AND COALESCE(v.horas_sem_contato, 0) < 6
    ) THEN
        RAISE EXCEPTION 'fn_vigilancia_coleta_parque marcou severidade em relogio sem sinal nenhum';
    END IF;

    -- E o outro sentido: quem TEM sinal precisa ter severidade e motivo. Deixar de acusar e tao
    -- ruim quanto acusar demais -- foi exatamente o silencio que custou 38h no HMI.
    IF EXISTS (
        SELECT 1 FROM public.fn_vigilancia_coleta_parque() v
         WHERE (v.nsr_faltando IS NOT NULL OR COALESCE(v.batidas_presas, 0) > 0)
           AND (v.severidade <> 2 OR v.motivo IS NULL)
    ) THEN
        RAISE EXCEPTION 'fn_vigilancia_coleta_parque deixou de acusar relogio com ponto nao coletado';
    END IF;

    -- nsr_device NULL (coletor antigo) nao pode virar "0 presas".
    IF EXISTS (
        SELECT 1 FROM public.fn_vigilancia_coleta_parque() v
         WHERE v.nsr_device IS NULL AND v.batidas_presas IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'batidas_presas preenchida sem nsr_device: "nao sei" virou numero';
    END IF;

    IF NOT has_function_privilege('authenticated', 'public.fn_vigilancia_coleta_parque()', 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated perdeu EXECUTE em fn_vigilancia_coleta_parque';
    END IF;
    IF has_function_privilege('anon', 'public.fn_vigilancia_coleta_parque()', 'EXECUTE') THEN
        RAISE EXCEPTION 'fn_vigilancia_coleta_parque executavel por anon';
    END IF;
    IF has_function_privilege('anon', 'public.fn_lacunas_afd_parque()', 'EXECUTE') THEN
        RAISE EXCEPTION 'fn_lacunas_afd_parque executavel por anon';
    END IF;

    RAISE NOTICE 'Conferencia de 20260919110000 OK.';
END
$conf$;
