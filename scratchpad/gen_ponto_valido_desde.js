// Gera 20260822210000_ponto_valido_desde_por_dispositivo.sql por COPIA MECANICA das quatro
// funcoes vigentes, com substituicoes pontuais e contagem de ocorrencias (CLAUDE.md armadilha 1).
// Aborta em qualquer divergencia. Nao editar a migration a mao - regerar por aqui.
//
// O segundo argumento de String.replace e SEMPRE uma funcao (aqui: split/join, que nem
// interpreta padrao). Com string, o JS interpreta os padroes de cifrao: $$ vira $ e quebra o
// dollar-quoting do plpgsql, e $' vira o resto do arquivo (incidente de 20260809000000).
const fs = require('fs')
const path = require('path')

const MIG = path.join(__dirname, '..', 'supabase', 'migrations')
const SAIDA = path.join(MIG, '20260822210000_ponto_valido_desde_por_dispositivo.sql')

const FONTES = {
  resolucao: ['20260820030000_add_rep_excecoes_ponto.sql', 'fn_servidor_por_identificador_afd'],
  ingerir:   ['20260818200000_fix_rep_identity_and_auto_reconcile_all_punches.sql', 'fn_ingerir_afd'],
  reparse:   ['20260820010000_reparse_and_reconcile_on_vinculo_creation.sql', 'fn_reparse_afd_dispositivo'],
  snapshot:  ['20260822200000_reconciliar_vinculos_com_snapshot_rep.sql', 'fn_registrar_snapshot_usuarios_dispositivo'],
}

function extrair(chave) {
  const [arquivo, nome] = FONTES[chave]
  const texto = fs.readFileSync(path.join(MIG, arquivo), 'utf8').replace(/\r\n/g, '\n')
  const ini = texto.indexOf('CREATE OR REPLACE FUNCTION public.' + nome + '(')
  if (ini < 0) throw new Error(nome + ' nao encontrada em ' + arquivo)
  const fim = texto.indexOf('\n$fn$;\n', ini)
  if (fim < 0) throw new Error('fim do corpo de ' + nome + ' nao encontrado em ' + arquivo)
  return texto.slice(ini, fim + '\n$fn$;'.length)
}

function exigir(corpo, alvo, n, rotulo) {
  const achadas = corpo.split(alvo).length - 1
  if (achadas !== n) throw new Error('[' + rotulo + '] esperava ' + n + ' ocorrencia(s), achei ' + achadas)
}

function troca(corpo, alvo, novo, n, rotulo) {
  exigir(corpo, alvo, n, rotulo)
  return corpo.split(alvo).join(novo)
}

// ============================================================================
// 1. fn_servidor_por_identificador_afd - ganha a data da batida e o corte
// ============================================================================
let resolucao = extrair('resolucao')

// Invariantes: as tres portas de resolucao e as duas checagens de excecao continuam de pe.
exigir(resolucao, "'vinculo'::text", 1, 'resolucao/porta-vinculo')
exigir(resolucao, "'cpf'::text", 1, 'resolucao/porta-cpf')
exigir(resolucao, "'pis'::text", 1, 'resolucao/porta-pis')
exigir(resolucao, 'public.fn_ponto_excecao(', 3, 'resolucao/excecoes')

resolucao = troca(
  resolucao,
  '    p_identificador  text\n)',
  [
    '    p_identificador  text,',
    '    -- Quando da batida. NAO tem DEFAULT de proposito: a assinatura de 2 argumentos e',
    '    -- DERRUBADA nesta migration, entao todo caller e obrigado a dizer de que instante esta',
    '    -- falando - ou passar NULL explicitamente, o que significa "isto nao e uma batida"',
    '    -- (o snapshot de cadastro e o unico caso). DEFAULT deixaria as duas assinaturas',
    '    -- convivendo e qualquer chamada de 2 args passaria a pular o corte em silencio.',
    '    p_ocorrido_em    timestamptz',
    ')',
  ].join('\n'),
  1,
  'resolucao/assinatura',
)

resolucao = troca(
  resolucao,
  '    v_unidade_dev uuid;',
  [
    '    v_unidade_dev uuid;',
    '    v_corte       date;',
    '    v_tz          text;',
  ].join('\n'),
  1,
  'resolucao/declare',
)

resolucao = troca(
  resolucao,
  '    SELECT unidade_id INTO v_unidade_dev FROM public.dispositivos_rep WHERE id = p_dispositivo_id;',
  [
    '    SELECT unidade_id, ponto_valido_desde INTO v_unidade_dev, v_corte',
    '      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;',
    '',
    '    -- CORTE POR DISPOSITIVO: batida anterior ao dia em que o SisEscala assumiu o ponto',
    '    -- daquele relogio NAO ganha dono. Vem ANTES das tres portas de resolucao de proposito -',
    '    -- e o portao mais forte, e nem o vinculo explicito o vence.',
    '    --',
    '    -- POR QUE ISTO PRECISOU EXISTIR (medido em producao em 22/08/2026): relogio',
    '    -- reaproveitado chega com o AFD inteiro do sistema anterior, e a resolucao por CPF/PIS',
    '    -- (20260818200000) nao olhava data nenhuma - p_vigente_de so protege o caminho do',
    '    -- VINCULO. Resultado: 9.626 marcacoes de 2019 a 2025, de sete relogios, com dono no',
    '    -- SisEscala. Nao projetaram em folha por sorte de calendario (a escala mais antiga e de',
    '    -- 07/2026); o proximo relogio pode chegar com historico do mes passado.',
    '    --',
    '    -- A BATIDA NAO E DESCARTADA: continua em rep_afd_registros (o artefato legal, com a',
    '    -- cadeia de hash) e continua virando marcacoes_ponto, so que ORFA. Isso e deliberado e',
    '    -- e o que torna o corte REVERSIVEL: se a data for posta errada, basta corrigi-la e',
    '    -- rodar fn_reparse_afd_dispositivo, que so mexe em orfa. Se a ingestao deixasse de',
    '    -- criar a marcacao, nao haveria o que reprocessar depois.',
    '    --',
    '    -- p_ocorrido_em NULL = "isto nao e uma batida" (resolucao de CADASTRO, vinda do',
    '    -- snapshot do relogio). Nao ha instante para comparar e o corte nao se aplica.',
    "    IF p_ocorrido_em IS NOT NULL AND v_corte IS NOT NULL THEN",
    "        -- configuracoes_globais e CHAVE/VALOR (valor jsonb): 'SELECT timezone FROM ...' morre",
    "        -- com 'column \"timezone\" does not exist', e so em RUNTIME (armadilha 1). Esta e a",
    '        -- forma usada por fn_confirmar_presenca e companhia. Sem o fuso, uma batida das 21h',
    '        -- do dia do corte cairia no dia seguinte (o processo e o banco rodam em UTC).',
    "        SELECT (valor#>>'{}')::text INTO v_tz",
    "          FROM public.configuracoes_globais WHERE chave = 'timezone';",
    "        v_tz := COALESCE(v_tz, 'America/Sao_Paulo');",
    '',
    '        IF (p_ocorrido_em AT TIME ZONE v_tz)::date < v_corte THEN',
    '            RETURN QUERY SELECT NULL::uuid, NULL::text;',
    '            RETURN;',
    '        END IF;',
    '    END IF;',
  ].join('\n'),
  1,
  'resolucao/corte',
)

// ============================================================================
// 2. fn_ingerir_afd - passa o instante da batida
// ============================================================================
let ingerir = extrair('ingerir')
exigir(ingerir, 'v_p.ocorrido_em', 4, 'ingerir/ocorrido_em-disponivel')

ingerir = troca(
  ingerir,
  '              FROM public.fn_servidor_por_identificador_afd(p_dispositivo_id, v_p.identificador);',
  '              FROM public.fn_servidor_por_identificador_afd(p_dispositivo_id, v_p.identificador,\n                                                            v_p.ocorrido_em);',
  1,
  'ingerir/chamada',
)

// ============================================================================
// 3. fn_reparse_afd_dispositivo - idem, lendo o instante da propria marcacao
// ============================================================================
let reparse = extrair('reparse')
exigir(reparse, "set_config('sisescala.reparse_afd', 'on', true)", 1, 'reparse/sessao-autorizada')

reparse = troca(
  reparse,
  [
    '        SELECT m.id AS marcacao_id,',
    '               m.dispositivo_id,',
    '               COALESCE(m.identificador_bruto, a.identificador_afd) AS identificador',
  ].join('\n'),
  [
    '        SELECT m.id AS marcacao_id,',
    '               m.dispositivo_id,',
    '               m.ocorrido_em,',
    '               COALESCE(m.identificador_bruto, a.identificador_afd) AS identificador',
  ].join('\n'),
  1,
  'reparse/select',
)

reparse = troca(
  reparse,
  '          FROM public.fn_servidor_por_identificador_afd(r.dispositivo_id, r.identificador);',
  '          FROM public.fn_servidor_por_identificador_afd(r.dispositivo_id, r.identificador,\n                                                        r.ocorrido_em);',
  1,
  'reparse/chamada',
)

// ============================================================================
// 4. fn_registrar_snapshot_usuarios_dispositivo - cadastro nao e batida: NULL explicito
// ============================================================================
let snapshot = extrair('snapshot')
exigir(snapshot, 'vinculos_encerrados', 1, 'snapshot/reconciliacao-preservada')
exigir(snapshot, 'UPDATE public.rep_vinculos_servidor', 1, 'snapshot/encerramento-preservado')

snapshot = troca(
  snapshot,
  [
    '          LEFT JOIN LATERAL public.fn_servidor_por_identificador_afd(',
    '                       p_dispositivo_id, e.identificador_afd) r ON true',
  ].join('\n'),
  [
    '          -- NULL no instante = "isto e cadastro, nao batida": nao ha o que comparar com',
    '          -- dispositivos_rep.ponto_valido_desde, e quem esta cadastrado no relogio HOJE',
    '          -- continua sendo reconhecido independente de quando o equipamento foi assumido.',
    '          LEFT JOIN LATERAL public.fn_servidor_por_identificador_afd(',
    '                       p_dispositivo_id, e.identificador_afd, NULL::timestamptz) r ON true',
  ].join('\n'),
  1,
  'snapshot/chamada',
)

// Nenhum corpo extraido pode trazer GRANT/REVOKE junto - eles sao reescritos aqui.
for (const [rot, corpo] of [['resolucao', resolucao], ['ingerir', ingerir], ['reparse', reparse], ['snapshot', snapshot]]) {
  exigir(corpo, 'GRANT EXECUTE', 0, rot + '/sem-grant-no-corpo')
}

const CABECALHO = `-- ============================================================================
-- O relogio lembra de 2019; o ponto do SisEscala comeca quando ele assume (22/08/2026)
-- ============================================================================
-- ARQUIVO GERADO por scratchpad/gen_ponto_valido_desde.js. Nao editar a mao - regerar.
-- As quatro funcoes sao copia mecanica do corpo vigente (20260820030000, 20260818200000,
-- 20260820010000 e 20260822200000) com substituicoes pontuais; o script aborta se qualquer
-- invariante divergir (CLAUDE.md armadilha 1).
--
-- O PROBLEMA, medido no parque inteiro em 22/08/2026
--
--   A resolucao de identidade nao tem vigencia. fn_servidor_por_identificador_afd cai para CPF e
--   depois PIS (20260818200000, que resolveu a SMS) SEM olhar a data da batida - p_vigente_de so
--   protege o caminho do VINCULO, e a armadilha 10 do CLAUDE.md fala dele como se fosse a unica
--   porta. Entao um relogio reaproveitado tem o AFD inteiro do sistema anterior transformado em
--   ponto atribuido ja na ingestao:
--
--     HMM-01           3.714 marcacoes com dono, a mais antiga de 2021
--     USF-LARANJEIRAS  2.362                                      2019
--     HMI-01           1.366                                      2021
--     USF-HIROSHI      1.222                                      2023
--     USF-DAA            373                                      2024
--     USF-PC             306                                      2022
--     USF-JPA            285                                      2021
--     ------------------------------------------------------------------
--     total            9.626 anteriores a 07/2026 (legado de outro sistema)
--
--   Sao exatamente os sete relogios instalados nos ultimos tres dias - nao e residuo de uma
--   instalacao infeliz, e o comportamento padrao de toda instalacao nova, no meio de uma rampa.
--
--   Nada disso projetou em folha, e isso e SORTE DE CALENDARIO, nao desenho: a escala mais
--   antiga do SisEscala e de 07/2026 e nenhuma dessas marcacoes e de 2026. O proximo relogio
--   reaproveitado pode chegar com batida do mes passado - de um sistema que a unidade usava ate
--   semana passada - e ai projeta na competencia aberta, sem ninguem perceber.
--
--   (As 6 marcacoes de 2026 anteriores ao cadastro do proprio relogio sao testes de instalacao,
--   todas no dia do cadastro, em Reg/TI, SMS e USF-DAA. Esse caso ja e o da armadilha 13, com
--   rep_excecoes_ponto - nao e o que esta migration trata.)
--
-- A CORRECAO: um corte por dispositivo, aplicado num lugar so
--
--   dispositivos_rep.ponto_valido_desde (date) e o dia em que o SisEscala assumiu o ponto
--   daquele relogio. A resolucao de identidade passa a receber o instante da batida e devolve
--   NULL abaixo do corte - antes das tres portas (vinculo, CPF, PIS), porque nem vinculo
--   explicito deve fazer o SisEscala assumir ponto de outro sistema.
--
--   Relogio novo nasce protegido: DEFAULT = hoje no fuso configurado. Quem ja usava o SisEscala
--   pelo terminal antes de ganhar o REP pode recuar a data na tela do dispositivo.
--
-- O QUE **NAO** MUDA, e e deliberado
--
--   * A batida continua sendo gravada em rep_afd_registros (artefato legal, cadeia de hash) E
--     continua virando marcacoes_ponto - so que ORFA. "Nunca descartar batida" segue valendo.
--   * Isso e o que torna o corte REVERSIVEL: data errada se conserta mudando a data e rodando
--     fn_reparse_afd_dispositivo, que so mexe em orfa. Se a ingestao deixasse de criar a
--     marcacao, nao haveria o que reprocessar - por isso o corte age na ATRIBUICAO, nao na
--     ingestao. O preco e volume (o HMM-01 sozinho tem 69.619 marcacoes, quase todas orfas);
--     e o mesmo preco que a SMS ja paga desde 08/2026, com ~250 mil.
--   * As 9.626 ja atribuidas continuam atribuidas. marcacoes_ponto e INSERT-only e o unico
--     UPDATE que o trigger libera e orfa -> com dono (20260818001000) - nao existe, e nao deve
--     existir, caminho para tirar o dono. A porta para isso e marcacoes_tratamentos com
--     tipo = 'desconsiderar', que a alocacao ja honra. Nao e feito aqui: elas sao inertes (nao
--     ha escala antes de 07/2026) e 9.626 tratamentos comprariam aparencia de limpeza, nao
--     seguranca.
--
-- ⚠️ A ASSINATURA DE 2 ARGUMENTOS E DERRUBADA. p_ocorrido_em NAO tem DEFAULT: com DEFAULT, as
--    duas assinaturas conviveriam e qualquer chamada de 2 args pularia o corte em silencio - o
--    modo de falha que a propria 20260817180000 ja mandou conferir ("a assinatura antiga NAO
--    pode ter sobrado"). Os quatro callers estao todos nesta migration.
--
-- IDEMPOTENTE: CREATE OR REPLACE nas funcoes, ADD COLUMN IF NOT EXISTS, DROP FUNCTION IF EXISTS.
-- Reaplicar e seguro - o backfill da coluna so alcanca quem estiver NULL.
-- ============================================================================


-- ============================================================================
-- 1. QUE DIA E HOJE, no fuso configurado
-- ============================================================================
-- Existe porque DEFAULT de coluna nao aceita subconsulta, e o fuso mora em configuracoes_globais
-- (chave/valor). CURRENT_DATE nao serve: o processo e o banco rodam em UTC, entao nas ultimas 3
-- horas de todo dia ele ja e amanha (armadilha 12) - e um corte um dia adiantado orfanaria as
-- batidas do proprio dia da instalacao, em silencio.
--
-- As funcoes que ja resolvem o fuso inline (fn_confirmar_presenca e companhia) NAO foram
-- convertidas: trocar a forma em ~10 funcoes de presenca para ganhar estilo nao se paga.

CREATE OR REPLACE FUNCTION public.fn_data_local()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT (now() AT TIME ZONE COALESCE(
               (SELECT (valor#>>'{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'),
               'America/Sao_Paulo'))::date
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_data_local() TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_data_local() IS
    'Data de hoje no fuso de configuracoes_globais (fallback America/Sao_Paulo). Existe para uso '
    'em DEFAULT de coluna, onde subconsulta nao e permitida - CURRENT_DATE erraria por um dia nas '
    'ultimas 3 horas, porque o banco roda em UTC.';


-- ============================================================================
-- 2. A COLUNA DE CORTE
-- ============================================================================

ALTER TABLE public.dispositivos_rep
    ADD COLUMN IF NOT EXISTS ponto_valido_desde date;

-- Backfill: a data de cadastro do dispositivo, no fuso local. E a mesma referencia que o
-- CLAUDE.md ja manda usar para p_vigente_de ao criar vinculo ("nunca a primeira batida do AFD").
UPDATE public.dispositivos_rep d
   SET ponto_valido_desde = (d.created_at AT TIME ZONE COALESCE(
           (SELECT (valor#>>'{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'),
           'America/Sao_Paulo'))::date
 WHERE d.ponto_valido_desde IS NULL;

ALTER TABLE public.dispositivos_rep
    ALTER COLUMN ponto_valido_desde SET DEFAULT public.fn_data_local();

ALTER TABLE public.dispositivos_rep
    ALTER COLUMN ponto_valido_desde SET NOT NULL;

COMMENT ON COLUMN public.dispositivos_rep.ponto_valido_desde IS
    'Dia em que o SisEscala assumiu o ponto deste relogio. Batida anterior a isto continua '
    'gravada (AFD e marcacoes_ponto) mas NAO ganha dono - e assim que o historico de um '
    'equipamento reaproveitado deixa de virar ponto daqui. DEFAULT = hoje no fuso configurado, '
    'entao relogio novo nasce protegido; recue a data na tela quando a unidade ja registrava '
    'ponto no SisEscala por outro caminho antes de ganhar o REP.';


-- ============================================================================
-- 3. RESOLUCAO DE IDENTIDADE - agora com a data da batida
-- ============================================================================
-- A assinatura antiga cai: ver o aviso no cabecalho. Se este DROP falhar por dependencia, existe
-- um caller em funcao LANGUAGE sql (que cria dependencia real, ao contrario de plpgsql) - ache-o
-- antes de seguir, nao troque por CASCADE.

DROP FUNCTION IF EXISTS public.fn_servidor_por_identificador_afd(uuid, text);

`

const ENTRE_1_2 = `
REVOKE ALL ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text, timestamptz) IS
    'De quem e esta batida, neste dispositivo. Aplica primeiro o corte '
    'dispositivos_rep.ponto_valido_desde (historico anterior a assuncao do relogio nao ganha '
    'dono) e so entao tenta vinculo vigente, CPF e PIS, recusando ambiguidade em vez de chutar. '
    'p_ocorrido_em NULL significa "isto e cadastro, nao batida" - unico caller assim e o snapshot '
    'de usuarios do relogio. FONTE UNICA: nao replicar esta regra em outra funcao nem no frontend.';


-- ============================================================================
-- 4. INGESTAO DO AFD - passa o instante da batida
-- ============================================================================

`

const ENTRE_2_3 = `
-- Assinatura conferida contra pg_proc, nao chutada: duas migrations anteriores escreveram
-- fn_ingerir_afd(uuid, text, text, text, integer), que nunca existiu.
REVOKE ALL ON FUNCTION public.fn_ingerir_afd(uuid, uuid, jsonb, text, text, text, text, inet, uuid, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ingerir_afd(uuid, uuid, jsonb, text, text, text, text, inet, uuid, boolean)
    TO service_role;


-- ============================================================================
-- 5. REPARSE - idem, lendo o instante da propria marcacao orfa
-- ============================================================================
-- ⚠️ A SOBRECARGA DE 1 ARGUMENTO PRECISA MORRER JUNTO. fn_reparse_afd_dispositivo(uuid) nasceu em
-- 20260811190000 e nunca foi derrubada quando 20260818001000 criou a de 2 argumentos - as duas
-- estao vivas em producao HOJE. Duas consequencias, e a segunda e nova:
--
--   * PostgREST ja nao consegue escolher entre elas: chamar a RPC so com p_dispositivo_id devolve
--     PGRST203 ("could not choose the best candidate"). Conferido em producao em 22/08/2026.
--   * A partir desta migration ela seria uma MINA: o corpo dela chama
--     fn_servidor_por_identificador_afd com 2 argumentos, assinatura que esta sendo derrubada
--     aqui - qualquer execucao morreria com "function does not exist", e so em runtime.
--
-- Nenhum caller vivo usa 1 argumento: o unico que existiu estava no bloco DO da propria
-- 20260811190000, que ja rodou. Os de hoje passam sempre (dispositivo, desde).

DROP FUNCTION IF EXISTS public.fn_reparse_afd_dispositivo(uuid);

`

const ENTRE_3_4 = `
REVOKE ALL ON FUNCTION public.fn_reparse_afd_dispositivo(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reparse_afd_dispositivo(uuid, timestamptz) TO authenticated, service_role;


-- ============================================================================
-- 6. SNAPSHOT DE CADASTRO - passa NULL, porque cadastro nao e batida
-- ============================================================================

`

const RODAPE = `
REVOKE ALL ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) TO service_role;


-- ============================================================================
-- CONFERENCIA - OBRIGATORIA, E NESTA ORDEM
-- ============================================================================
-- HOMOLOGACAO PRIMEIRO. plpgsql resolve nome de coluna, existencia e ARIDADE de funcao so na
-- EXECUCAO (armadilha 1): trocar a assinatura e exatamente o tipo de mudanca que o CREATE aceita
-- feliz e que so estoura quando alguem bate o ponto.
--
-- 0. A assinatura antiga NAO pode ter sobrado - com as duas vivas, quem chamar com 2 args pula
--    o corte e ninguem descobre:
--
-- SELECT count(*) AS versoes, string_agg(pg_get_function_identity_arguments(oid), ' | ')
--   FROM pg_proc WHERE proname = 'fn_servidor_por_identificador_afd';
--   -- esperado: versoes = 1, argumentos "uuid, text, timestamptz"
--
-- 1. TESTE DE FUMACA - EXECUTAR as quatro, nao so criar:
--
-- SELECT * FROM public.fn_servidor_por_identificador_afd(gen_random_uuid(), '000000000191', now());
-- SELECT * FROM public.fn_servidor_por_identificador_afd(gen_random_uuid(), '000000000191', NULL);
-- SELECT public.fn_registrar_snapshot_usuarios_dispositivo(
--          (SELECT id FROM public.dispositivos_rep LIMIT 1), '[]'::jsonb);
--   -- ATENCAO: a linha acima APAGA o snapshot daquele dispositivo (a funcao sempre substituiu
--   -- por inteiro). Em homologacao, tudo bem; em producao, rode a higiene depois.
-- SELECT public.fn_reparse_afd_dispositivo(gen_random_uuid(), now());
--
-- 2. O PORTAO. Uma batida REAL anterior ao corte tem que deixar de resolver, e a MESMA batida
--    depois do corte tem que continuar resolvendo. Troque o uuid por um dispositivo de verdade:
--
-- WITH d AS (SELECT id, ponto_valido_desde FROM public.dispositivos_rep WHERE nome LIKE '%HMM%')
-- SELECT (SELECT servidor_id FROM public.fn_servidor_por_identificador_afd(
--            d.id, '053638930459', (d.ponto_valido_desde - 1)::timestamptz)) AS antes_do_corte,
--        (SELECT servidor_id FROM public.fn_servidor_por_identificador_afd(
--            d.id, '053638930459', (d.ponto_valido_desde + 1)::timestamptz)) AS depois_do_corte
--   FROM d;
--   -- esperado: antes_do_corte NULO, depois_do_corte com o uuid do servidor.
--
-- 3. Quanto historico alheio cada relogio traz, e quanto dele ja esta atribuido. E esta consulta
--    que se roda a cada instalacao nova para conferir se a data do corte esta certa:
--
-- SELECT d.nome, d.ponto_valido_desde,
--        count(*) FILTER (WHERE m.ocorrido_em < d.ponto_valido_desde) AS antes_do_corte,
--        count(*) FILTER (WHERE m.ocorrido_em < d.ponto_valido_desde
--                           AND m.servidor_id IS NOT NULL)            AS antes_e_com_dono,
--        min(m.ocorrido_em) AS mais_antiga
--   FROM public.dispositivos_rep d
--   JOIN public.marcacoes_ponto m ON m.dispositivo_id = d.id
--  GROUP BY d.nome, d.ponto_valido_desde
--  ORDER BY 4 DESC;
--   -- 'antes_e_com_dono' e o passivo herdado (9.626 hoje) e NAO cai com esta migration - ela
--   -- impede o proximo, nao desfaz o anterior. O que tem que ficar em ZERO daqui pra frente e
--   -- esse mesmo numero medido para relogios cadastrados DEPOIS de hoje.
--
-- 4. Ninguem pode ter PERDIDO dono por causa disto (o corte so alcanca o que e anterior a ele):
--
-- SELECT count(*) FILTER (WHERE servidor_id IS NOT NULL) AS com_dono, count(*) AS total
--   FROM public.marcacoes_ponto WHERE origem = 'rep';
--   -- esperado: identico ao de antes da migration.
--
-- 5. E o ponto do mes corrente tem que continuar entrando normalmente - confira uma batida de
--    hoje chegando na escala depois do proximo ciclo do coletor, em qualquer unidade ativa.
`

let saida = CABECALHO + resolucao + ENTRE_1_2 + ingerir + ENTRE_2_3 + reparse + ENTRE_3_4 + snapshot + RODAPE

// Conferencia estrutural do arquivo inteiro.
const cifroes = (saida.match(/\$fn\$/g) || []).length
if (cifroes !== 10) throw new Error('esperava 10 delimitadores $fn$ (5 funcoes), achei ' + cifroes)
for (const nome of ['fn_data_local', 'fn_servidor_por_identificador_afd', 'fn_ingerir_afd',
                    'fn_reparse_afd_dispositivo', 'fn_registrar_snapshot_usuarios_dispositivo']) {
  const n = saida.split('CREATE OR REPLACE FUNCTION public.' + nome + '(').length - 1
  if (n !== 1) throw new Error(nome + ' criada ' + n + 'x, esperava 1')
}
if ((saida.match(/^GRANT EXECUTE/gm) || []).length !== 5) throw new Error('esperava 5 linhas GRANT EXECUTE')
// Dois DROP: a assinatura antiga da resolucao de identidade e a sobrecarga de 1 arg do reparse.
if ((saida.match(/^DROP FUNCTION/gm) || []).length !== 2) throw new Error('esperava exatamente 2 DROP FUNCTION')
// Nenhuma CHAMADA de 2 argumentos pode ter sobrado - seria um caller pulando o corte em silencio,
// que e exatamente o que esta migration existe para impedir. A unica mencao de 2 args permitida e
// o DROP da assinatura antiga. Chamada completa numa linha so, com uma virgula unica:
const doisArgs = /fn_servidor_por_identificador_afd\([^(),\n]*,[^(),\n]*\)/
for (const linha of saida.split('\n')) {
  if (linha.startsWith('DROP FUNCTION')) continue
  if (doisArgs.test(linha)) throw new Error('chamada de 2 argumentos sobrou: ' + linha.trim())
}

// E os tres callers tem que estar passando o terceiro argumento, cada um com o seu instante.
for (const [terceiro, rotulo] of [
  ['v_p.ocorrido_em);', 'ingerir'],
  ['r.ocorrido_em);', 'reparse'],
  ['NULL::timestamptz) r ON true', 'snapshot (cadastro, nao batida)'],
]) {
  if (saida.split(terceiro).length - 1 !== 1) {
    throw new Error('caller ' + rotulo + ' nao esta passando o instante exatamente 1x')
  }
}
if (saida.includes('\r')) throw new Error('CR solto no meio do texto gerado')

fs.writeFileSync(SAIDA, saida.replace(/\n/g, '\r\n'), 'utf8')
console.log('ok: ' + path.relative(process.cwd(), SAIDA) + ' (' + saida.split('\n').length + ' linhas)')
