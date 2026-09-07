// Valida o portao sim_autorizacao_extra.js injetando regressoes de proposito
// (CLAUDE.md, armadilha 36). O portao TEM de reprovar em todas.
//
// ⚠️ ARMADILHA 48: cada substituicao e conferida como APLICADA. E o casamento acontece sobre uma
// copia em LF, com a escrita devolvendo o final de linha original — este repositorio oscila entre
// LF e CRLF e ja produziu tres no-ops silenciosos por causa disso.
//
// Rodar:  node scratchpad/val_sim_autorizacao_extra.js
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const RAIZ = path.resolve(__dirname, '..')
const ALVOS = {
  // Comportamento: o portao carrega o TRANSPILADO.
  build: path.join(__dirname, '_sim', 'calculoDia.js'),
  // Cobertura: lidos direto do fonte.
  act: path.join(RAIZ, 'src', 'app', '(dashboard)', 'folha-ponto', 'actions.ts'),
  portal: path.join(RAIZ, 'src', 'app', 'consultar-escala', 'actions.ts'),
}

const ORIGINAL = {}, NORMAL = {}, CRLF = {}
for (const [k, p] of Object.entries(ALVOS)) {
  if (!fs.existsSync(p)) {
    console.error(`ABORTADO: ${p} nao existe. Transpile antes (ver cabecalho do portao).`)
    process.exit(1)
  }
  const bruto = fs.readFileSync(p, 'utf8')
  ORIGINAL[k] = bruto; CRLF[k] = bruto.includes('\r\n'); NORMAL[k] = bruto.replace(/\r\n/g, '\n')
}
const gravar = (k, t) => fs.writeFileSync(ALVOS[k], CRLF[k] ? t.replace(/\n/g, '\r\n') : t)
const restaurar = () => { for (const [k, p] of Object.entries(ALVOS)) fs.writeFileSync(p, ORIGINAL[k]) }

function portaoPassa() {
  try { execFileSync(process.execPath, [path.join(__dirname, 'sim_autorizacao_extra.js')], { stdio: 'pipe' }); return true }
  catch { return false }
}

const REGRESSOES = [
  {
    // 🚨 A REGRESSAO MAIS CARA QUE ESTA ENTREGA PODE SOFRER: pendente passando a cortar verba.
    // Seria um corte automatico de hora extra de gente que trabalhou, numa folha assinada.
    nome: 'pendente passa a cortar a verba (o default deixa de ser neutro)',
    alvo: 'build',
    de: "if (statusAutorizacaoExtraDoDia(registro, extraLiquidaMinutos) === 'nao_autorizada')\n        return 0;",
    para: "if (statusAutorizacaoExtraDoDia(registro, extraLiquidaMinutos) !== 'autorizada')\n        return 0;",
  },
  {
    // O inverso: a recusa deixando de valer. O gate viraria enfeite.
    nome: 'a recusa da chefia deixa de tirar a hora extra da verba',
    alvo: 'build',
    de: "if (statusAutorizacaoExtraDoDia(registro, extraLiquidaMinutos) === 'nao_autorizada')",
    para: "if (false)",
  },
  {
    nome: 'a vigencia abre para tras e alcanca 08/2026',
    alvo: 'build',
    de: "exports.COMPETENCIA_AUTORIZACAO_EXTRA_PADRAO = '2026-09'",
    para: "exports.COMPETENCIA_AUTORIZACAO_EXTRA_PADRAO = '2026-01'",
  },
  {
    // Perguntar sobre o minuto que ja e reposicao de atraso: a ordem invertida.
    nome: 'a autorizacao passa a olhar a extra BRUTA, ignorando a compensacao',
    alvo: 'build',
    de: "const st = statusAutorizacaoExtraDoDia(r, extraLiquida);",
    para: "const st = statusAutorizacaoExtraDoDia(r, Math.max(0, Number(r.hora_extra_minutos) || 0));",
  },
  {
    nome: 'o fechamento deixa de cobrar a decisao',
    alvo: 'act',
    de: 'return { requerDecisaoAutorizacaoExtra: true, diasAutorizacaoExtraPendente: diasExtra }',
    para: '/* gate removido */',
  },
  {
    nome: 'a action para de reconferir a elegibilidade (aceita do cliente)',
    alvo: 'act',
    de: "if (decisao !== 'pendente' && extraLiquida <= 0) {",
    para: 'if (false) {',
  },
  {
    // Uma das quatro copias esquecida: "Sincronizar" apaga a decisao por aquele caminho.
    nome: 'o Portal deixa de preservar a decisao numa das copias',
    alvo: 'portal',
    de: '      carregarDecisaoAutorizacaoExtra(registro, registroExistente)\n',
    para: '',
  },
]

let todas = true
console.log('Injetando regressoes de proposito. O portao TEM de reprovar em cada uma.\n')
try {
  if (!portaoPassa()) { console.log('  ABORTADO: o portao ja reprova antes de qualquer injecao.'); process.exit(1) }
  console.log('  (estado limpo: o portao passa)\n')

  for (const r of REGRESSOES) {
    const antes = NORMAL[r.alvo]
    const depois = antes.split(r.de).join(r.para)
    if (depois === antes) {
      console.log(`  x  ${r.nome}\n     SUBSTITUICAO NAO APLICADA - o alvo mudou de forma. Corrija o validador.`)
      todas = false
      continue
    }
    gravar(r.alvo, depois)
    const passou = portaoPassa()
    restaurar()
    if (passou) { console.log(`  FALHA  ${r.nome}\n         o portao PASSOU com a regressao aplicada.`); todas = false }
    else console.log(`  ok     ${r.nome} -> reprovado`)
  }
} finally { restaurar() }

if (!portaoPassa()) { console.log('\n  FALHA: o portao nao voltou a passar depois de restaurar.'); process.exit(1) }
console.log('\n' + (todas
  ? `Todas as ${REGRESSOES.length} regressoes foram reprovadas pelo portao, e o estado foi restaurado.`
  : 'ALGUMA REGRESSAO PASSOU - o portao nao protege o que diz proteger.'))
process.exit(todas ? 0 : 1)
