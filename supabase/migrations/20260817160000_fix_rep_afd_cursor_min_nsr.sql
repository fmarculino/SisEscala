-- ============================================================================
-- Cursor de AFD: ancorar no MENOR NSR do dispositivo, nao no NSR 1 (17/08/2026)
-- ============================================================================
-- Corrige fn_cursor_afd_dispositivo, criada horas antes em 20260817150000.
--
-- O ERRO: a versao original abria com um guard
--
--     WHEN NOT EXISTS (SELECT 1 ... AND nsr = 1) THEN 1
--
-- cuja intencao era "primeira coleta deste dispositivo: peca o arquivo todo". A premissa por tras
-- dele era que o AFD de todo relogio comeca no NSR 1 - conferido em producao contra os 3
-- dispositivos que tinham dado real na hora (17.594, 36.074 e 42.165 registros, todos contiguos
-- 1..N). A premissa e' uma SUPOSICAO sobre o equipamento, e o cursor nao precisa dela.
--
-- O que expos isso: o REP iDClass - SMS (10.110.0.20), na recuperacao de ~268 mil registros de
-- 17/08/2026, apareceu com menor NSR 3001 e, minutos depois, 501 - o piso DESCENDO. O motivo e' que
-- a fila offline reenvia lote em ordem de NOME DE ARQUIVO (os.ReadDir sobre lote_id, que e' hash),
-- nao em ordem de NSR: durante uma recuperacao grande o dispositivo fica legitimamente com buracos
-- que se fecham sozinhos. Enquanto o NSR 1 nao chegasse, o guard dispararia em TODO ciclo e o cursor
-- devolveria 1 - o equipamento remontando o arquivo inteiro a cada 5 minutos, exatamente o que a
-- coleta incremental existe para eliminar. E se algum modelo de relogio de fato nao comecar em 1, o
-- guard travaria nisso para sempre.
--
-- Para o registro: o piso REAL deste equipamento acabou sendo 1 (conferido quando a recuperacao
-- terminou, 268.556 registros contiguos de 1 a 268.556). Os "3001" e "501" eram artefato da ordem de
-- reenvio, nao caracteristica do relogio - nao cite este dispositivo como exemplo de AFD que comeca
-- acima de 1. O guard estava errado de todo modo, porque travava durante a recuperacao inteira.
--
-- Nunca houve risco de PERDER marcacao: errar o cursor para baixo so rebaixa dado que ja existe, e
-- reingerir e' de graca. O prejuizo era o ganho da coleta incremental ser zero.
--
-- Consequencia benigna que essa mesma ordem-fora-de-NSR produz, e que o desenho ja trata: durante a
-- recuperacao o cursor aponta para o primeiro buraco e o relogio reenvia dali. Converge - cada ciclo
-- ingere mais - e no fim os buracos fecham e o cursor salta para maior_nsr + 1.
--
-- A CORRECAO E' UMA REMOCAO: o calculo por trecho contiguo (LEAD sobre os NSR do dispositivo) ja
-- resolvia os dois casos sozinho, e o guard era o unico estorvo. Sem ele:
--
--   * dispositivo sem registro nenhum  -> subconsulta devolve NULL -> COALESCE -> 1 (pede tudo)
--   * 3001..268556 contiguo            -> 268557 (incremental de verdade)
--   * 3001..4999 + 5001..268556        -> 5000 (a lacuna puxa o cursor de volta, como antes)
--   * trailer tipo 9 com NSR 999999999 -> continua ignorado, por vir depois de lacuna enorme
--
-- MUDANCA DE COMPORTAMENTO DELIBERADA: um dispositivo com, digamos, 5..40 ingeridos agora devolve
-- 41, onde a versao anterior devolvia 1. Isso e' a correcao, nao efeito colateral - a funcao passa a
-- tratar "o menor NSR que existe" como piso, em vez de exigir que ele seja 1.
--
-- ⚠️ Durante uma recuperacao grande isso significa que o cursor fica baixo por varios ciclos (aponta
-- para o primeiro buraco ainda nao preenchido). E' o comportamento correto e transitorio; nao
-- confunda com o cursor "travado".
--
-- ⚠️ LIMITE CONHECIDO desse desenho: o piso passa a ser "o menor NSR que ja entrou". Isso e' certo
-- porque a primeira coleta de um dispositivo pede a partir do NSR 1 e o relogio devolve tudo que
-- tem, entao o que voltou define o piso verdadeiro. Mas uma primeira carga PARCIAL (import de
-- pendrive com arquivo recortado) fixaria um piso alto demais, e os NSR abaixo dele nunca seriam
-- pedidos. Nao ha remedio automatico hoje: exigiria pedir ao equipamento a partir de um NSR
-- escolhido a mao (um `sync --desde-nsr N` na CLI, ainda nao existe). Ao importar por pendrive,
-- garanta que o primeiro arquivo de um dispositivo seja o AFD completo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cursor_afd_dispositivo(p_dispositivo_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    -- Menor NSR cujo sucessor NAO existe = fim do primeiro trecho contiguo a partir do MENOR NSR
    -- que este dispositivo tem. Sem registro nenhum, COALESCE cai para 1 e pede o arquivo todo.
    SELECT COALESCE((
        SELECT MIN(t.nsr) + 1
          FROM (SELECT r.nsr, LEAD(r.nsr) OVER (ORDER BY r.nsr) AS prox
                  FROM public.rep_afd_registros r
                 WHERE r.dispositivo_id = p_dispositivo_id) t
         WHERE t.prox IS NULL OR t.prox <> t.nsr + 1), 1::bigint);
$fn$;

REVOKE ALL ON FUNCTION public.fn_cursor_afd_dispositivo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cursor_afd_dispositivo(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_cursor_afd_dispositivo(uuid) IS
    'NSR a partir do qual o coletor deve pedir o AFD deste dispositivo (initial_nsr de '
    'get_afd.fcgi). E o fim do primeiro trecho CONTIGUO a partir do MENOR NSR do dispositivo, mais '
    '1 - deliberadamente NAO ancora no NSR 1: durante recuperacao grande o menor NSR ingerido ainda '
    'esta DESCENDO (a fila offline reenvia lote em ordem de hash de lote_id, nao de NSR), e nada '
    'garante que o AFD de todo modelo de relogio comece em 1. Tambem NAO e '
    'dispositivos_rep.ultimo_nsr + 1: lacuna no meio puxa o cursor de volta para antes dela, para '
    'que nenhum NSR fique para tras para sempre. Reingerir e de graca (fn_ingerir_afd e idempotente '
    'por dispositivo+nsr). Servida por GET /api/rep/v1/estado.';


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar; nao altera nada)
-- ============================================================================
-- Espera-se cursor = maior_nsr + 1 onde nao houver lacuna. Onde houver, o cursor e' MENOR que
-- maior_nsr - e isso e' a funcao trabalhando, nao defeito. Compare tambem menor_nsr com 1: onde
-- menor_nsr > 1, a versao anterior (20260817150000) estaria travada devolvendo 1 para sempre.
--
-- SELECT d.nome,
--        r.menor_nsr,
--        r.maior_nsr,
--        r.registros,
--        public.fn_cursor_afd_dispositivo(d.id) AS cursor_nsr,
--        CASE
--          WHEN r.registros IS NULL                             THEN 'sem coleta ainda'
--          WHEN r.registros = r.maior_nsr - r.menor_nsr + 1      THEN 'contiguo'
--          ELSE 'TEM LACUNA - cursor volta para tras'
--        END AS situacao
--   FROM public.dispositivos_rep d
--   LEFT JOIN LATERAL (
--        SELECT min(nsr) AS menor_nsr, max(nsr) AS maior_nsr, count(*) AS registros
--          FROM public.rep_afd_registros WHERE dispositivo_id = d.id
--   ) r ON true
--  ORDER BY d.nome;
