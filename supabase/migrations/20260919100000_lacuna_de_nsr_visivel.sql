-- ============================================================================
-- Lacuna de NSR do AFD: detectar por ESTADO, nunca por evento (19/09/2026)
-- ============================================================================
--
-- 🚨 O caso: em 18/09/2026 o REP-iDClass-HMI-01 (HMI) ficou 38 horas sem ingerir uma batida.
-- 509 marcacoes -- 267 delas do dia 18 inteiro -- ficaram so na memoria do equipamento, e
-- NENHUMA tela do SisEscala disse nada. Ao contrario: a tela de Marcacoes mostrava
-- `ultimo_nsr = 131199` (o maior ja recebido, numero alto e tranquilizador) e
-- `ultimo_contato_em` de 2 minutos atras. Os dois indicadores que existiam apontavam para
-- "esta tudo bem" enquanto o relogio estava travado desde a vespera.
--
-- Por que nao havia rastro: `fn_ingerir_afd` reconcilia DENTRO da propria transacao, e um lote
-- de 500 linhas gera ~390 pares (servidor, dia). O custo passou dos 60s de timeout do coletor;
-- o cliente abortou, a conexao caiu e o Postgres REVERTEU a transacao inteira -- inclusive a
-- linha de `rep_sincronizacoes` que registraria a tentativa. Falha que se apaga a si mesma.
-- Como o cursor continua correto (fim do trecho CONTIGUO + 1), o ciclo seguinte remontou
-- exatamente o mesmo lote de 500 e bateu no mesmo timeout. Laco eterno, silencioso.
--
-- 🚨 A LICAO, que vale alem deste defeito: deteccao por EVENTO nao funciona quando a falha e'
-- capaz de reverter o proprio registro dela. Ninguem conseguiu escrever "falhei" porque a
-- transacao que escreveria isso foi desfeita. Entao a deteccao aqui e' por ESTADO: comparar o
-- que o equipamento ja entregou (`ultimo_nsr`) com o que foi de fato ingerido de forma continua
-- (`fn_cursor_afd_dispositivo`). Os dois numeros ja existiam; ninguem os comparava. Um estado
-- inconsistente nao depende de nada ter conseguido ser gravado no momento da falha -- e' por
-- isso que ele pega a proxima causa tambem, qualquer que seja ela.
--
-- ⚠️ A lacuna NAO significa batida perdida. O AFD e' memoria inviolavel do REP-C: enquanto o
-- equipamento estiver la, o dado esta la. Significa batida que ainda nao chegou -- e que, se
-- ninguem olhar, nao chega nunca. Por isso o alerta e' informativo, nao um erro.

-- ----------------------------------------------------------------------------
-- fn_lacunas_afd_parque: uma linha por relogio ativo no escopo de gestao
-- ----------------------------------------------------------------------------
-- Escopo pela fonte unica da armadilha 62 (`fn_escopo_gestao_alcanca`): super_admin, admin e rh
-- irrestritos; rh_unidade nas unidades dele. Nao reimplementa a regra.

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
    -- Instante da ultima batida que ENTROU antes da lacuna. E' o que responde "desde quando",
    -- que e' o que diz a gravidade: 2 horas e' um ciclo ruim, 38 horas e um dia inteiro de ponto.
    lacuna_desde       timestamptz,
    horas_travado      numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH cfg AS (
        SELECT COALESCE(
            (SELECT (valor #>> '{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'),
            'America/Sao_Paulo') AS tz
    ),
    base AS (
        SELECT d.id, d.nome, d.unidade_id, u.nome AS unidade_nome, d.coletor_host,
               d.ultimo_contato_em, COALESCE(d.ultimo_nsr, 0)::bigint AS ultimo_nsr,
               public.fn_cursor_afd_dispositivo(d.id) AS proximo_nsr,
               d.geracao_atual
          FROM public.dispositivos_rep d
          JOIN public.unidades u ON u.id = d.unidade_id
         WHERE d.ativo
           AND public.fn_escopo_gestao_alcanca(d.unidade_id)
    )
    SELECT b.id, b.nome, b.unidade_id, b.unidade_nome, b.coletor_host,
           b.ultimo_contato_em, b.ultimo_nsr, b.proximo_nsr,
           (b.ultimo_nsr - b.proximo_nsr + 1)::bigint AS nsr_faltando,
           anterior.ocorrido_em AS lacuna_desde,
           ROUND(EXTRACT(EPOCH FROM (now() - anterior.ocorrido_em)) / 3600.0, 1) AS horas_travado
      FROM base b
      LEFT JOIN LATERAL (
          -- A linha imediatamente ANTES da lacuna: ela e' o ultimo instante que o SisEscala
          -- conhece daquele relogio. `proximo_nsr - 1` e' exatamente ela, por construcao do
          -- cursor (fim do trecho contiguo + 1).
          SELECT r.ocorrido_em
            FROM public.rep_afd_registros r
           WHERE r.dispositivo_id = b.id
             AND r.geracao = b.geracao_atual
             AND r.nsr = b.proximo_nsr - 1
           LIMIT 1
      ) anterior ON TRUE
     -- So relogio que JA entregou NSR acima do cursor. Equipamento novo (ultimo_nsr = 0) e
     -- equipamento em dia (cursor = ultimo_nsr + 1) nao sao lacuna e nao entram: alarme que
     -- aparece em toda linha e' alarme que ninguem le.
     WHERE b.ultimo_nsr > 0
       AND b.proximo_nsr <= b.ultimo_nsr
     ORDER BY anterior.ocorrido_em NULLS FIRST, b.nome;
$fn$;

COMMENT ON FUNCTION public.fn_lacunas_afd_parque() IS
    'Relogios cujo AFD tem NSR ja entregue pelo equipamento mas NAO ingerido de forma continua. '
    'Deteccao por ESTADO (ultimo_nsr x cursor), nao por evento: a falha que motivou reverte a '
    'propria linha de rep_sincronizacoes, entao nao ha log para consultar. Ver 20260919100000.';

REVOKE ALL ON FUNCTION public.fn_lacunas_afd_parque() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_lacunas_afd_parque() TO authenticated, service_role;

-- ============================================================================
-- CONFERENCIA -- EXECUTA a funcao (armadilha 42). Conferir que ela "existe" nao serve: o defeito
-- classico aqui e' nome de coluna que so falha em tempo de execucao do statement.
-- ============================================================================
DO $conf$
DECLARE
    v_linhas    integer;
    v_erro      text;
    v_anon      boolean;
BEGIN
    -- 1) executa de fato. Como service_role (auth.uid() IS NULL), fn_escopo_gestao_alcanca
    -- decide sozinha o que aparece; o que importa aqui e' o statement rodar inteiro.
    BEGIN
        SELECT count(*) INTO v_linhas FROM public.fn_lacunas_afd_parque();
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_erro = MESSAGE_TEXT;
        RAISE EXCEPTION 'fn_lacunas_afd_parque nao executou: %', v_erro;
    END;
    RAISE NOTICE 'fn_lacunas_afd_parque executou: % relogio(s) com lacuna neste momento', v_linhas;

    -- 2) anon NAO pode executar. A funcao expoe nome de unidade e host de maquina.
    SELECT has_function_privilege('anon', 'public.fn_lacunas_afd_parque()', 'EXECUTE') INTO v_anon;
    IF v_anon THEN
        RAISE EXCEPTION 'fn_lacunas_afd_parque continua executavel por anon';
    END IF;

    -- 3) authenticated PRECISA executar, senao a tela nasce vazia (o outro sentido: revogar
    -- demais quebra com a mesma discricao que nao revogar de menos).
    IF NOT has_function_privilege('authenticated', 'public.fn_lacunas_afd_parque()', 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated perdeu EXECUTE em fn_lacunas_afd_parque';
    END IF;

    -- 4) invariante do criterio: nenhum relogio EM DIA pode aparecer. Se um aparecesse, a tela
    -- passaria a acusar lacuna em todo lugar e ninguem leria mais o aviso.
    IF EXISTS (
        SELECT 1
          FROM public.fn_lacunas_afd_parque() l
          JOIN public.dispositivos_rep d ON d.id = l.dispositivo_id
         WHERE public.fn_cursor_afd_dispositivo(d.id) > COALESCE(d.ultimo_nsr, 0)
    ) THEN
        RAISE EXCEPTION 'fn_lacunas_afd_parque listou relogio sem lacuna';
    END IF;

    RAISE NOTICE 'Conferencia de 20260919100000 OK.';
END
$conf$;
