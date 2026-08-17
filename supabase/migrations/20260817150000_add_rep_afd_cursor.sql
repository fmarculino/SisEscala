-- ============================================================================
-- Cursor de NSR para coleta INCREMENTAL do AFD (17/08/2026)
-- ============================================================================
-- Motivacao medida em producao, nao hipotetica. ciclo.Sync do coletor-rep sempre
-- pedia o AFD a partir do NSR 1 (TODO registrado em tools/coletor-rep/ciclo/ciclo.go
-- e em CLAUDE.md). Num relogio reaproveitado o arquivo inteiro tem dezenas de
-- milhares de linhas e o equipamento leva mais de 30s para monta-lo - exatamente o
-- Timeout do cliente HTTP do coletor.
--
-- No REP iDClass - SMS (10.110.0.20, instalado em 14/08/2026) isso deixou de ser
-- lentidao e passou a ser falha total: em 17/08/2026 o dispositivo tinha
-- rep_sincronizacoes = 0 e rep_afd_registros = 0, ou seja o sync NUNCA completou
-- uma unica vez desde a instalacao - todo ciclo morria em "context deadline
-- exceeded ... while reading body" e recomecava do zero 5 minutos depois. Com
-- cursor, o equipamento passa a montar so o incremento.
--
-- POR QUE NAO E' SIMPLESMENTE dispositivos_rep.ultimo_nsr + 1:
--
--   ultimo_nsr e' o MAIOR NSR novo de cada lote (GREATEST, em fn_ingerir_afd), nao
--   o fim de um trecho contiguo. Se um NSR do meio nunca chegar (linha ilegivel,
--   lote perdido da fila offline, falha no meio de um arquivo), ultimo_nsr segue
--   avancando e aquele NSR ficaria para tras PARA SEMPRE - uma batida
--   silenciosamente descartada, o oposto da regra "nunca descartar batida". Hoje
--   isso se autocorrige porque cada ciclo repede o arquivo inteiro; ao ligar o
--   cursor, deixaria de se autocorrigir. E' a troca que esta funcao evita.
--
--   Esta funcao devolve o fim do trecho CONTIGUO 1..N mais 1. Qualquer lacuna puxa
--   o cursor de volta para antes dela e o relogio reenvia dali - reingerir e' de
--   graca, fn_ingerir_afd e' idempotente por (dispositivo_id, nsr).
--
--   De brinde resolve o envenenamento por registro de trailer: um AFD que traga
--   registro tipo 9 com NSR 999999999 faria ultimo_nsr saltar para o fim, e um
--   cursor ingenuo nunca mais pediria nada (falha silenciosa permanente). Como
--   999999999 fica depois de uma lacuna enorme, o trecho contiguo o ignora.
--
-- CONFERIDO EM PRODUCAO (17/08/2026) antes de escolher este desenho: os 3
-- dispositivos com dado real (17.594, 36.074 e 42.165 registros) estao contiguos
-- 1..N, sem NSR 0, sem NSR >= 900000000 e sem registro tipo 1 ou 9 ingerido - ou
-- seja, hoje o cursor coincide com ultimo_nsr + 1 nos tres. A diferenca so aparece
-- no dia em que aparecer uma lacuna, que e' justamente o dia em que importa.
--
-- O algoritmo foi validado em homologacao contra 6 cenarios (vazio, contiguo,
-- lacuna no meio, duas lacunas, sem o NSR 1, trailer 999999999) antes de virar
-- funcao - todos OK.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cursor_afd_dispositivo(p_dispositivo_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT CASE
        -- Sem o NSR 1 ingerido nao existe trecho contiguo nenhum: pede o arquivo todo.
        WHEN NOT EXISTS (
            SELECT 1 FROM public.rep_afd_registros
             WHERE dispositivo_id = p_dispositivo_id AND nsr = 1)
        THEN 1::bigint
        ELSE COALESCE((
            -- Menor NSR cujo sucessor NAO existe = fim do trecho contiguo.
            SELECT MIN(t.nsr) + 1
              FROM (SELECT r.nsr, LEAD(r.nsr) OVER (ORDER BY r.nsr) AS prox
                      FROM public.rep_afd_registros r
                     WHERE r.dispositivo_id = p_dispositivo_id) t
             WHERE t.prox IS NULL OR t.prox <> t.nsr + 1), 1::bigint)
    END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_cursor_afd_dispositivo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cursor_afd_dispositivo(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_cursor_afd_dispositivo(uuid) IS
    'NSR a partir do qual o coletor deve pedir o AFD deste dispositivo (initial_nsr de '
    'get_afd.fcgi). E o fim do trecho CONTIGUO 1..N mais 1, deliberadamente NAO '
    'dispositivos_rep.ultimo_nsr + 1: lacuna no meio puxa o cursor de volta para antes dela, '
    'para que nenhum NSR fique para tras para sempre. Reingerir e de graca (fn_ingerir_afd e '
    'idempotente por dispositivo+nsr). Servida por GET /api/rep/v1/estado.';


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar; nao altera nada)
-- ============================================================================
-- 1. O cursor de cada dispositivo, ao lado do ultimo_nsr denormalizado e da
--    contagem real. Onde nao houver lacuna, cursor = ultimo_nsr + 1 = total + 1.
--    Divergencia entre cursor e ultimo_nsr + 1 nao e' bug: e' lacuna encontrada,
--    e o cursor menor e' a resposta certa.
--
-- SELECT d.nome,
--        d.ultimo_nsr,
--        public.fn_cursor_afd_dispositivo(d.id)      AS cursor_nsr,
--        d.ultimo_nsr + 1                            AS cursor_ingenuo,
--        (SELECT count(*) FROM public.rep_afd_registros r WHERE r.dispositivo_id = d.id) AS registros,
--        CASE WHEN public.fn_cursor_afd_dispositivo(d.id) = d.ultimo_nsr + 1
--             THEN 'contiguo' ELSE 'TEM LACUNA - cursor volta para tras' END AS situacao
--   FROM public.dispositivos_rep d
--  ORDER BY d.nome;
--
-- 2. Onde estao as lacunas de um dispositivo especifico, se a consulta 1 apontar
--    alguma (troque o uuid):
--
-- SELECT nsr AS ultimo_antes_da_lacuna, prox AS proximo_existente
--   FROM (SELECT r.nsr, LEAD(r.nsr) OVER (ORDER BY r.nsr) AS prox
--           FROM public.rep_afd_registros r
--          WHERE r.dispositivo_id = '00000000-0000-0000-0000-000000000000') t
--  WHERE prox IS NOT NULL AND prox <> nsr + 1
--  ORDER BY nsr;
