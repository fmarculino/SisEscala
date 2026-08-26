// Gera a migration da cobertura de ponto numa unidade com VARIOS relogios.
//
// Copia MECANICA das duas funcoes vigentes (armadilha 1 do CLAUDE.md: nunca redigitar corpo de
// funcao) com substituicoes pontuais e contagem. Aborta em qualquer divergencia.
//
//   fn_cobertura_ponto_dispositivo -> vigente em 20260817170000 (resolver_identidade_rep_cpf_ou_pis)
//   fn_cobertura_ponto_resumo      -> vigente em 20260813140000 (multi_setor_dispositivos_rep)
const fs = require('fs')

const FONTE_DISP = 'supabase/migrations/20260817170000_resolver_identidade_rep_cpf_ou_pis.sql'
const FONTE_RESUMO = 'supabase/migrations/20260813140000_multi_setor_dispositivos_rep.sql'
const DESTINO = 'supabase/migrations/20260825110000_cobertura_multi_relogio_por_unidade.sql'

// Migrations do projeto sao CRLF; normaliza na leitura e devolve CRLF no fim.
function ler(caminho) {
  return fs.readFileSync(caminho, 'utf8').split('\r\n').join('\n')
}

function extrair(texto, inicio, fim, rotulo) {
  const i = texto.indexOf(inicio)
  if (i < 0) {
    console.error('ABORTADO: nao achei o inicio de ' + rotulo)
    process.exit(1)
  }
  const j = texto.indexOf(fim, i)
  if (j < 0) {
    console.error('ABORTADO: nao achei o fim de ' + rotulo)
    process.exit(1)
  }
  return texto.slice(i, j + fim.length)
}

function trocar(corpo, de, para, esperado, rotulo) {
  const partes = corpo.split(de)
  const achou = partes.length - 1
  if (achou !== esperado) {
    console.error('ABORTADO (' + rotulo + '): ' + esperado + ' esperada(s), ' + achou + ' encontrada(s) para:\n' + de)
    process.exit(1)
  }
  return partes.join(para)
}

// ----------------------------------------------------------------------------
// 1. fn_cobertura_ponto_dispositivo — ganha a coluna coberto_em
// ----------------------------------------------------------------------------
let disp = extrair(
  ler(FONTE_DISP),
  'CREATE OR REPLACE FUNCTION public.fn_cobertura_ponto_dispositivo(',
  '$fn$;',
  'fn_cobertura_ponto_dispositivo'
)

// Invariantes do que foi copiado: se algum sumir, a copia pegou a funcao errada ou incompleta.
for (const marca of [
  "RAISE EXCEPTION 'Sem permissao para ver a cobertura de ponto.'",
  "RAISE EXCEPTION 'Dispositivo inexistente ou fora do seu escopo.'",
  'fn_unidade_alcancavel_por_setor',
  "WHEN r.ident_snapshot IS NULL AND r.vinculo_id IS NULL              THEN 'fora_do_relogio'",
  'ORDER BY 10, 2;',
]) {
  if (!disp.includes(marca)) {
    console.error('ABORTADO: invariante ausente na copia de fn_cobertura_ponto_dispositivo: ' + marca)
    process.exit(1)
  }
}

disp = trocar(disp, 'CREATE OR REPLACE FUNCTION public.fn_cobertura_ponto_dispositivo(',
  'CREATE FUNCTION public.fn_cobertura_ponto_dispositivo(', 1, 'disp')

disp = trocar(disp, [
  '    fila_status        text,',
  '    fila_erro          text,',
  '    lotacao_compativel boolean',
  ')',
].join('\n'), [
  '    fila_status        text,',
  '    fila_erro          text,',
  '    lotacao_compativel boolean,',
  '    -- Outros relogios ATIVOS da mesma unidade em que esta pessoa consegue bater ponto hoje',
  '    -- (esta cadastrada la COM biometria). NULL = nao consegue bater em mais nenhum.',
  '    --',
  '    -- Existe porque uma unidade pode ter varios equipamentos, e ai a mesma pessoa aparece numa',
  '    -- linha por relogio: quem esta no relogio do setor dela e nao no relogio geral e listada',
  '    -- como problema no geral. E verdade (ali ela nao bate), mas nao e a mesma urgencia de quem',
  '    -- nao bate em lugar nenhum - e sem esta coluna as duas sao indistinguiveis na tela.',
  '    coberto_em         text',
  ')',
].join('\n'), 1, 'disp: RETURNS TABLE')

// A expressao entra como ULTIMA coluna do SELECT final, na mesma ordem do RETURNS TABLE. O
// `ORDER BY 10, 2` e por POSICAO e continua valendo (as posicoes 10 e 2 nao se movem).
disp = trocar(disp, [
  "           (r.unidade_id = v_unidade_id AND (NOT v_restrito OR EXISTS (",
  "                 SELECT 1 FROM public.dispositivos_rep_setores ds",
  "                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = r.setor_id)))",
  '      FROM resolvido r',
].join('\n'), [
  "           (r.unidade_id = v_unidade_id AND (NOT v_restrito OR EXISTS (",
  "                 SELECT 1 FROM public.dispositivos_rep_setores ds",
  "                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = r.setor_id))),",
  '           -- Onde mais esta pessoa consegue bater, na MESMA unidade. Exige biometria de',
  '           -- proposito: cadastro sem digital nao registra ponto, entao contar como cobertura',
  '           -- seria repetir o caso dominante que a aba de Cobertura existe para denunciar.',
  '           (SELECT string_agg(d2.nome, \', \' ORDER BY d2.nome)',
  '              FROM public.dispositivos_rep d2',
  '             WHERE d2.id <> p_dispositivo_id',
  '               AND d2.unidade_id = v_unidade_id',
  '               AND d2.ativo',
  '               AND (EXISTS (SELECT 1 FROM public.rep_usuarios_dispositivo u3',
  '                             WHERE u3.dispositivo_id = d2.id',
  '                               AND u3.servidor_id = r.id',
  '                               AND u3.tem_biometria)',
  '                    OR EXISTS (SELECT 1 FROM public.rep_vinculos_servidor v3',
  '                                WHERE v3.dispositivo_id = d2.id',
  '                                  AND v3.servidor_id = r.id',
  '                                  AND v3.vigente_ate IS NULL',
  '                                  AND v3.tem_biometria)))',
  '      FROM resolvido r',
].join('\n'), 1, 'disp: SELECT final')

// ----------------------------------------------------------------------------
// 2. fn_cobertura_ponto_resumo — ganha a contagem de quem ja bate em outro relogio
// ----------------------------------------------------------------------------
let resumo = extrair(
  ler(FONTE_RESUMO),
  'CREATE FUNCTION public.fn_cobertura_ponto_resumo(',
  '$fn$;',
  'fn_cobertura_ponto_resumo'
)

for (const marca of [
  'WITH dispositivos AS MATERIALIZED (',
  'fn_unidade_alcancavel_por_setor',
  'LEFT JOIN LATERAL public.fn_cobertura_ponto_dispositivo(d.id, p_mes, p_ano) c ON true',
]) {
  if (!resumo.includes(marca)) {
    console.error('ABORTADO: invariante ausente na copia de fn_cobertura_ponto_resumo: ' + marca)
    process.exit(1)
  }
}

resumo = trocar(resumo, [
  '    nao_conseguem_bater integer,',
  '    batidas_perdidas    integer',
  ')',
].join('\n'), [
  '    nao_conseguem_bater integer,',
  '    batidas_perdidas    integer,',
  '    -- Quantos dos nao_conseguem_bater JA BATEM em outro relogio ativo desta unidade. Nunca',
  '    -- descontado de nao_conseguem_bater: naquele equipamento a pessoa continua sem conseguir',
  '    -- bater, e mudar o significado de um numero que ja esta na tela seria pior que somar um',
  '    -- numero novo ao lado dele.',
  '    cobertos_em_outro   integer',
  ')',
].join('\n'), 1, 'resumo: RETURNS TABLE')

resumo = trocar(resumo, [
  "           count(*) FILTER (WHERE c.situacao <> 'ok')::integer,",
  '           COALESCE(sum(c.batidas_perdidas), 0)::integer',
].join('\n'), [
  "           count(*) FILTER (WHERE c.situacao <> 'ok')::integer,",
  '           COALESCE(sum(c.batidas_perdidas), 0)::integer,',
  "           count(*) FILTER (WHERE c.situacao <> 'ok' AND c.coberto_em IS NOT NULL)::integer",
].join('\n'), 1, 'resumo: SELECT')

// ----------------------------------------------------------------------------
// 3. Monta a migration
// ----------------------------------------------------------------------------
const cabecalho = `-- ============================================================================
-- Cobertura de ponto numa unidade com MAIS DE UM RELOGIO (25/08/2026)
-- ============================================================================
--
-- MOTIVACAO. Ha unidades com 4 equipamentos (e pode haver mais). A cobertura sempre foi
-- calculada POR DISPOSITIVO, e isso continua certo: para bater num relogio, a pessoa precisa
-- estar cadastrada NAQUELE relogio, com biometria. Mas a leitura da tela fica ambigua quando a
-- unidade tem varios: quem esta no relogio do proprio setor e nao no relogio geral aparece como
-- problema no geral, exatamente como quem nao esta em relogio nenhum.
--
-- As duas situacoes exigem acao diferente:
--   * nao esta em NENHUM relogio  -> essa pessoa nao registra ponto. Urgente.
--   * esta em outro relogio da unidade -> ela registra ponto hoje. Cadastra-la aqui e' opcional,
--     e so' faz sentido se ela de fato usa esta entrada.
--
-- O QUE MUDA. Uma coluna em cada funcao, nada mais:
--   fn_cobertura_ponto_dispositivo -> coberto_em (nomes dos outros relogios onde ela bate)
--   fn_cobertura_ponto_resumo      -> cobertos_em_outro (quantos dos "nao conseguem bater" batem
--                                     em outro relogio da mesma unidade)
--
-- NENHUM numero existente muda de significado. nao_conseguem_bater continua sendo "quantos nao
-- conseguem bater NESTE relogio" - descontar dali faria a tela dizer que esta tudo certo num
-- equipamento onde ninguem consegue bater.
--
-- ⚠️ Exige biometria para contar como cobertura. Cadastro sem digital nao registra ponto: contar
-- isso como coberto reintroduziria, por outro caminho, o "bate e nao registra" que a aba de
-- Cobertura existe para denunciar (CLAUDE.md, "Cobertura de ponto").
--
-- ⚠️ DROP antes do CREATE nas duas: CREATE OR REPLACE nao altera a lista de colunas de um
-- RETURNS TABLE (42P13, ja mordeu este mesmo par de funcoes em 13/08/2026). Sem CASCADE, de
-- proposito - dependente de verdade deve dar erro, nao sumir em silencio. A ordem importa: o
-- resumo e' envelope LATERAL do detalhe, entao sai primeiro e volta por ultimo.
--
-- Idempotente: DROP IF EXISTS + CREATE.

`

const corpo = [
  cabecalho,
  '-- ============================================================================',
  '-- 1. Fora as duas (dependente primeiro)',
  '-- ============================================================================',
  '',
  'DROP FUNCTION IF EXISTS public.fn_cobertura_ponto_resumo(integer, integer);',
  'DROP FUNCTION IF EXISTS public.fn_cobertura_ponto_dispositivo(uuid, integer, integer);',
  '',
  '',
  '-- ============================================================================',
  '-- 2. fn_cobertura_ponto_dispositivo (copia mecanica de 20260817170000 + coberto_em)',
  '-- ============================================================================',
  '',
  disp,
  '',
  'GRANT EXECUTE ON FUNCTION public.fn_cobertura_ponto_dispositivo(uuid, integer, integer) TO authenticated, service_role;',
  '',
  '',
  '-- ============================================================================',
  '-- 3. fn_cobertura_ponto_resumo (copia mecanica de 20260813140000 + cobertos_em_outro)',
  '-- ============================================================================',
  '',
  resumo,
  '',
  'GRANT EXECUTE ON FUNCTION public.fn_cobertura_ponto_resumo(integer, integer) TO authenticated, service_role;',
  '',
  '',
  '-- ============================================================================',
  '-- CONFERENCIA (rodar depois de aplicar)',
  '-- ============================================================================',
  '--',
  '-- 1. Nenhuma contagem antiga pode ter mudado. Compare com o que a tela mostrava antes:',
  '--   SELECT dispositivo_nome, escalados, ok, nao_conseguem_bater, cobertos_em_outro',
  '--     FROM public.fn_cobertura_ponto_resumo(8, 2026) ORDER BY dispositivo_nome;',
  '--',
  '-- 2. Unidade com mais de um relogio - quem esta coberto em outro lugar:',
  '--   SELECT servidor_nome, situacao, coberto_em',
  '--     FROM public.fn_cobertura_ponto_dispositivo(',
  "--            (SELECT id FROM public.dispositivos_rep WHERE nome ILIKE '%hmi%' LIMIT 1), 8, 2026)",
  '--    WHERE coberto_em IS NOT NULL ORDER BY servidor_nome;',
  '--',
  '-- 3. Unidade com UM relogio so: coberto_em tem que ser NULL em toda linha (nao ha outro',
  '--    equipamento para cobrir ninguem). Se vier preenchido, a subconsulta esta ignorando o',
  '--    filtro de unidade:',
  '--   SELECT count(*) FILTER (WHERE coberto_em IS NOT NULL) AS deve_ser_zero',
  '--     FROM public.fn_cobertura_ponto_dispositivo(',
  "--            (SELECT id FROM public.dispositivos_rep WHERE nome ILIKE '%lacem%' LIMIT 1), 8, 2026);",
  '',
].join('\n')

// Conferencia estrutural do arquivo inteiro, no espirito de gen_dobra.js.
const delimitadores = (corpo.match(/\$fn\$/g) || []).length
if (delimitadores % 2 !== 0) {
  console.error('ABORTADO: delimitadores $fn$ impares (' + delimitadores + ') - dollar-quoting quebrado')
  process.exit(1)
}
const creates = (corpo.match(/^CREATE FUNCTION public\./gm) || []).length
if (creates !== 2) {
  console.error('ABORTADO: ' + creates + ' CREATE FUNCTION, esperados 2')
  process.exit(1)
}
const grants = (corpo.match(/^GRANT EXECUTE/gm) || []).length
if (grants !== 2) {
  console.error('ABORTADO: ' + grants + ' GRANT, esperados 2')
  process.exit(1)
}
if ((corpo.match(/^DROP FUNCTION IF EXISTS/gm) || []).length !== 2) {
  console.error('ABORTADO: os dois DROP tem que estar presentes')
  process.exit(1)
}

fs.writeFileSync(DESTINO, corpo.split('\n').join('\r\n'))
console.log('gerada ' + DESTINO + ' (' + corpo.split('\n').length + ' linhas, CRLF)')
