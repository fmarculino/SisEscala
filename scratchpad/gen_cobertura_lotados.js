// Gera a migration que amplia a Cobertura de Ponto para lotados U escalados.
// Copia MECANICA do corpo vigente (20260825110000) - nunca redigitar corpo de funcao.
// Aborta se qualquer substituicao nao bater na contagem esperada.
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const FONTE = path.join(RAIZ, 'supabase/migrations/20260825110000_cobertura_multi_relogio_por_unidade.sql')
const DESTINO = path.join(RAIZ, 'supabase/migrations/20260905100000_cobertura_de_ponto_inclui_lotados.sql')

const src = fs.readFileSync(FONTE, 'utf8')

// A fonte usa CRLF. Toda string montada aqui passa por crlf() antes de entrar no arquivo.
const crlf = (s) => s.replace(/\r?\n/g, '\r\n')

// O segundo argumento de String.replace TEM que ser funcao: com string, o JS interpreta os
// padroes de cifrao ($$ vira $, $' vira o resto do arquivo) e destroi o dollar-quoting do
// plpgsql. Usar split/join evita o problema por construcao.
function trocar(texto, de, para, esperado, rotulo) {
  const achou = texto.split(de).length - 1
  if (achou !== esperado) {
    console.error('ABORTADO: "' + rotulo + '" esperava ' + esperado + ' ocorrencia(s), achou ' + achou)
    process.exit(1)
  }
  return texto.split(de).join(para)
}

// ---------------------------------------------------------------- extrair as duas funcoes
const iDisp = src.indexOf('CREATE FUNCTION public.fn_cobertura_ponto_dispositivo(')
const iRes = src.indexOf('CREATE FUNCTION public.fn_cobertura_ponto_resumo(')
if (iDisp < 0 || iRes < 0) {
  console.error('ABORTADO: nao achei as duas funcoes na fonte')
  process.exit(1)
}
const FIM = '$fn$;'
let fnDisp = src.slice(iDisp, src.indexOf(FIM, iDisp) + FIM.length)
let fnRes = src.slice(iRes, src.indexOf(FIM, iRes) + FIM.length)

// ---------------------------------------------------------------- 1) universo = escalados U lotados
const CTE_NOVAS = crlf([
  '    -- LOTADOS nesta unidade (e nos setores deste dispositivo, quando ele e restrito).',
  '    -- Existe porque a aba respondia so "dos ESCALADOS, quem consegue bater?" - quem esta',
  '    -- lotado e cadastrado no relogio, mas sem escala no mes, era invisivel. Medido em',
  '    -- 05/09/2026: 1.257 pessoas cadastradas SEM BIOMETRIA (nao conseguem bater) que a tela',
  '    -- nao mostrava, entre elas 348 no HMM-01 e 57 no CAPS III.',
  '    lotados AS (',
  '        SELECT s.id AS sid',
  '          FROM public.servidores s',
  "         WHERE s.status = 'Ativo'",
  '           AND s.unidade_id = v_unidade_id',
  '           AND (NOT v_restrito OR EXISTS (',
  '                 SELECT 1 FROM public.dispositivos_rep_setores ds',
  '                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = s.setor_id))',
  '    ),',
  '    -- UNIAO, nunca substituicao. Trocar escala por lotacao quebraria o "Servidor Externo"',
  '    -- (v1.2.4): quem e escalado AQUI e lotado em OUTRA unidade sumiria da tela, que e o caso',
  '    -- que fn_enfileirar_cadastros_por_escala existe para atender.',
  '    universo AS (',
  '        SELECT sid FROM escalados',
  '        UNION',
  '        SELECT sid FROM lotados',
  '    ),',
  '    base AS (',
  '',
].join('\n'))

fnDisp = trocar(fnDisp, '    base AS (\r\n', CTE_NOVAS, 1, 'inserir CTEs lotados/universo')

// dias vira 0 para quem nao esta escalado. A CTE escalados agrupa sobre escala_diaria, entao
// quem esta la tem sempre >= 1 dia: 0 identifica sem ambiguidade quem entrou por LOTACAO.
fnDisp = trocar(
  fnDisp,
  '        SELECT s.id, s.nome, s.matricula, e.dias, s.unidade_id, s.setor_id,',
  '        SELECT s.id, s.nome, s.matricula, COALESCE(e.dias, 0) AS dias, s.unidade_id, s.setor_id,',
  1,
  'dias com COALESCE'
)

fnDisp = trocar(
  fnDisp,
  crlf(['          FROM escalados e', '          JOIN public.servidores s ON s.id = e.sid', "         WHERE s.status = 'Ativo'"].join('\n')),
  crlf([
    '          FROM universo u',
    '          JOIN public.servidores s ON s.id = u.sid',
    '          LEFT JOIN escalados e ON e.sid = u.sid',
    "         WHERE s.status = 'Ativo'",
  ].join('\n')),
  1,
  'base passa a ler o universo'
)

// ---------------------------------------------------------------- 2) resumo ganha total_pessoas
fnRes = trocar(
  fnRes,
  '    escalados           integer,',
  crlf([
    '    -- Quantas pessoas a aba lista neste relogio: lotados U escalados. E o denominador novo.',
    '    total_pessoas       integer,',
    '    -- CONTINUA sendo so quem tem escala no mes. Preservado de proposito: mudar o significado',
    '    -- de um numero que ja esta na tela e pior que somar um numero novo ao lado dele (mesma',
    '    -- regra de cobertos_em_outro, 25/08/2026).',
    '    escalados           integer,',
  ].join('\n')),
  1,
  'RETURNS TABLE ganha total_pessoas'
)

// count(*) contava tambem a linha sintetica do LEFT JOIN LATERAL num dispositivo sem ninguem
// (dava 1 onde o certo e 0). count(c.servidor_id) ignora NULL e corrige isso de passagem.
fnRes = trocar(
  fnRes,
  '           count(*)::integer,\r\n',
  crlf([
    '           count(c.servidor_id)::integer,',
    '           count(c.servidor_id) FILTER (WHERE c.dias_com_escala > 0)::integer,',
    '',
  ].join('\n')),
  1,
  'resumo: total_pessoas + escalados reais'
)

// ---------------------------------------------------------------- montar a migration
const CAB = crlf(`-- ============================================================================
-- Cobertura de Ponto: a aba passa a listar LOTADOS U ESCALADOS (05/09/2026)
-- ============================================================================
--
-- MOTIVACAO (medida em producao em 05/09/2026, com autorizacao do usuario).
-- fn_cobertura_ponto_dispositivo montava a lista a partir de escala_mensal JOIN escala_diaria,
-- ou seja respondia "dos ESCALADOS, quem consegue bater ponto?". Quem esta lotado na unidade e
-- ja cadastrado no relogio, mas sem escala lancada no mes, nao aparecia em lugar nenhum.
--
-- Caso que motivou: USF Jose Manoel da Anunciacao, 4 servidores lotados, os 4 cadastrados no
-- relogio COM biometria - a aba mostrava 1 (so a que tinha escala). Os dois numeros estavam
-- certos; a tela e que respondia outra pergunta.
--
-- O QUE ISSO ESCONDIA, medido no parque inteiro:
--   lotados com biometria (conseguem bater) ...... 2.100
--   lotados SEM biometria (NAO conseguem bater) .. 1.257   <- invisiveis ate aqui
--   lotados fora do relogio ......................    52
-- Piores casos: HMM-01 e HMM-02 com 348 sem biometria cada (1 pessoa com digital em 350),
-- CAPS III 57 (nenhuma digital), CCE-01 35 (nenhuma), HMI ~82 em cada um dos 3 relogios.
--
-- UNIAO, NUNCA SUBSTITUICAO. Trocar escala por lotacao quebraria o "Servidor Externo" (v1.2.4):
-- escalado aqui, lotado em outra unidade. Os dois criterios convivem, exatamente como
-- fn_enfileirar_cadastros_rep (lotacao) e fn_enfileirar_cadastros_por_escala (escala) convivem.
--
-- O universo cresce muito e isso e o objetivo, nao efeito colateral: medido, 1.785 -> 3.430 em
-- 09/2026 e 640 -> 3.417 em 08/2026. O numero de escalados varia de 640 a 1.785 conforme o mes
-- (a implantacao da escala esta em andamento); a uniao fica ESTAVEL em ~3.4k. E o que faz a aba
-- parar de depender de a escala ter sido lancada.
--
-- 'escalados' no resumo NAO muda de significado - continua contando so quem tem escala. O
-- denominador novo e 'total_pessoas', somado ao lado. Mudar um numero que ja esta na tela e pior
-- que acrescentar um numero novo (mesma regra de cobertos_em_outro, 25/08/2026).
--
-- dias_com_escala = 0 identifica quem entrou por LOTACAO: a CTE escalados agrupa sobre
-- escala_diaria, entao quem esta la tem sempre >= 1 dia. Nenhuma coluna nova foi precisa para
-- isso, e lotacao_compativel (que ja existia) diz se a pessoa e lotada aqui.
--
-- DROP antes do CREATE: CREATE OR REPLACE nao altera a lista de colunas de um RETURNS TABLE
-- (42P13) e o resumo ganha coluna. Sem CASCADE, de proposito. O resumo e envelope LATERAL do
-- detalhe, entao sai primeiro e volta por ultimo.
--
-- RECRIAR FUNCAO CRIA OBJETO NOVO, E OBJETO NOVO NASCE COM EXECUTE PARA PUBLIC (armadilha 24).
-- A 20260830120000 revogou anon destas duas exatas funcoes; sem os REVOKE abaixo esta migration
-- as reabriria em silencio. A verificacao no fim ABORTA se isso acontecer.
--
-- Gerado por scratchpad/gen_cobertura_lotados.js (copia mecanica de 20260825110000).
-- Idempotente: DROP IF EXISTS + CREATE.


-- ============================================================================
-- 1. Fora as duas (dependente primeiro)
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_cobertura_ponto_resumo(integer, integer);
DROP FUNCTION IF EXISTS public.fn_cobertura_ponto_dispositivo(uuid, integer, integer);


-- ============================================================================
-- 2. fn_cobertura_ponto_dispositivo (copia mecanica de 20260825110000 + universo ampliado)
-- ============================================================================

`)

const MEIO = crlf(`


REVOKE EXECUTE ON FUNCTION public.fn_cobertura_ponto_dispositivo(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_cobertura_ponto_dispositivo(uuid, integer, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_cobertura_ponto_dispositivo(uuid, integer, integer) TO authenticated, service_role;


-- ============================================================================
-- 3. fn_cobertura_ponto_resumo (copia mecanica de 20260825110000 + total_pessoas)
-- ============================================================================

`)

const RODAPE = crlf(`


REVOKE EXECUTE ON FUNCTION public.fn_cobertura_ponto_resumo(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_cobertura_ponto_resumo(integer, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_cobertura_ponto_resumo(integer, integer) TO authenticated, service_role;


-- ============================================================================
-- 4. VERIFICACAO - a migration confere o proprio resultado e ABORTA se divergir
-- ============================================================================
--
-- REVOKE de quem nao e dono da funcao NAO falha: emite WARNING e segue (armadilha 24). Sem esta
-- checagem a migration "aplica com sucesso" sem ter mudado nada. Confere os DOIS sentidos:
-- revogar de menos deixa dado pessoal aberto a anon; revogar demais derruba a tela.

DO $verifica$
DECLARE
    v_abertas  text;
    v_fechadas text;
BEGIN
    SELECT string_agg(t.f, ', ') INTO v_abertas
      FROM (VALUES
              ('public.fn_cobertura_ponto_dispositivo(uuid, integer, integer)'),
              ('public.fn_cobertura_ponto_resumo(integer, integer)')
           ) t(f)
     WHERE has_function_privilege('anon', t.f, 'EXECUTE');

    IF v_abertas IS NOT NULL THEN
        RAISE EXCEPTION 'anon ainda executa: %. Banco=% usuario=%. REVOKE de quem nao e dono so emite WARNING - confira o dono da funcao.',
            v_abertas, current_database(), current_user;
    END IF;

    SELECT string_agg(t.f, ', ') INTO v_fechadas
      FROM (VALUES
              ('public.fn_cobertura_ponto_dispositivo(uuid, integer, integer)'),
              ('public.fn_cobertura_ponto_resumo(integer, integer)')
           ) t(f)
     WHERE NOT has_function_privilege('authenticated', t.f, 'EXECUTE');

    IF v_fechadas IS NOT NULL THEN
        RAISE EXCEPTION 'authenticated PERDEU execucao em: %. A aba de Cobertura ficaria vazia.', v_fechadas;
    END IF;

    RAISE NOTICE 'privilegios conferidos: anon fora, authenticated dentro.';
END;
$verifica$;


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar)
-- ============================================================================
--
-- 1. O universo cresceu e 'escalados' NAO mudou. Compare com o valor de antes:
--   SELECT dispositivo_nome, total_pessoas, escalados, ok, sem_biometria, nao_conseguem_bater
--     FROM public.fn_cobertura_ponto_resumo(9, 2026) ORDER BY nao_conseguem_bater DESC;
--
-- 2. Quem entrou por LOTACAO (dias_com_escala = 0) tem que aparecer, e o caso que motivou a
--    mudanca sao os 3 da USF Jose Manoel que faltavam:
--   SELECT servidor_nome, dias_com_escala, situacao, tem_biometria
--     FROM public.fn_cobertura_ponto_dispositivo(
--            (SELECT id FROM public.dispositivos_rep WHERE nome ILIKE '%JMA-BREJO%' LIMIT 1))
--    ORDER BY dias_com_escala DESC, servidor_nome;
--
-- 3. Servidor Externo preservado: alguem com dias_com_escala > 0 e lotacao_compativel = false
--    tem que continuar na lista (se some, a UNIAO virou substituicao):
--   SELECT count(*) AS externos_preservados
--     FROM public.dispositivos_rep d,
--          LATERAL public.fn_cobertura_ponto_dispositivo(d.id, 9, 2026) c
--    WHERE c.dias_com_escala > 0 AND NOT c.lotacao_compativel;
--
-- 4. Ninguem duplicado (a UNION e por sid, mas o LATERAL do snapshot poderia multiplicar):
--   SELECT count(*) AS deve_ser_zero FROM (
--     SELECT d.id AS did, c.servidor_id AS sid
--       FROM public.dispositivos_rep d, LATERAL public.fn_cobertura_ponto_dispositivo(d.id) c
--      GROUP BY 1, 2 HAVING count(*) > 1) x;
`)

const saida = CAB + fnDisp + MEIO + fnRes + RODAPE

// ---------------------------------------------------------------- invariantes estruturais
const conferencias = [
  ['dollar-quoting $fn$ em pares', (saida.match(/\$fn\$/g) || []).length, 4],
  ['DROP das duas funcoes', (saida.match(/DROP FUNCTION IF EXISTS/g) || []).length, 2],
  ['CREATE das duas funcoes', (saida.match(/^CREATE FUNCTION public\./gm) || []).length, 2],
  ['REVOKE de PUBLIC nas duas', (saida.match(/FROM PUBLIC;/g) || []).length, 2],
  ['REVOKE de anon nas duas', (saida.match(/FROM anon;/g) || []).length, 2],
  ['GRANT a authenticated', (saida.match(/TO authenticated, service_role;/g) || []).length, 2],
  ['guard de papel preservado', (saida.match(/insufficient_privilege/g) || []).length, 2],
  ['CTE lotados presente', (saida.match(/ {4}lotados AS \(/g) || []).length, 1],
  ['CTE universo presente', (saida.match(/ {4}universo AS \(/g) || []).length, 1],
  // A CTE original abre com "WITH escalados AS (" - nao indentada como as demais.
  ['CTE escalados preservada', (saida.match(/WITH escalados AS \(/g) || []).length, 1],
  ['coberto_em preservado', (saida.includes('coberto_em') ? 1 : 0), 1],
  ['lotacao_compativel preservado', (saida.includes('lotacao_compativel') ? 1 : 0), 1],
  ['snapshot casa por servidor_id', (saida.match(/u2\.servidor_id = b\.id/g) || []).length, 1],
  // Nenhum DROP pode levar CASCADE: dependente de verdade deve dar erro, nao sumir em silencio.
  // A palavra aparece no comentario do cabecalho, entao o teste olha so os DROP.
  ['nenhum DROP com CASCADE', (saida.match(/DROP FUNCTION[^;]*CASCADE/g) || []).length, 0],
]
let falhou = false
for (const [rotulo, achou, esperado] of conferencias) {
  const ok = achou === esperado
  if (!ok) falhou = true
  console.log((ok ? 'ok    ' : 'FALHA ') + rotulo + ': ' + achou + ' (esperado ' + esperado + ')')
}
if (falhou) {
  console.error('\nABORTADO: invariante estrutural divergiu')
  process.exit(1)
}

fs.writeFileSync(DESTINO, saida, 'utf8')
console.log('\ngerado: ' + path.relative(RAIZ, DESTINO) + ' (' + saida.length + ' bytes)')
