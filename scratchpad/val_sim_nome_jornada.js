// Valida o portao sim_nome_jornada.js injetando regressoes de proposito
// (CLAUDE.md, armadilha 36: portao que nunca falha nao vale nada).
//
// ⚠️ ARMADILHA 48: cada substituicao e conferida como APLICADA antes de rodar. Um replace no-op
// faria o portao "passar" e o teste do teste mentiria.
//
// ⚠️ Os arquivos deste repositorio oscilam entre LF e CRLF (o git normaliza para CRLF ao
// restaurar). O casamento acontece sobre uma copia em LF e a escrita devolve o final de linha
// original - foi exatamente esse detalhe que produziu tres no-ops silenciosos noutro validador
// hoje.
//
// Rodar:  node scratchpad/val_sim_nome_jornada.js
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const RAIZ = path.resolve(__dirname, '..')

const ALVOS = {
  // Comportamento: o portao carrega o TRANSPILADO, entao a regressao de comportamento tem que
  // ser injetada nele - mexer no .ts nao mudaria o que o portao executa.
  build: path.join(__dirname, '_sim_jornada', 'nomeJornada.js'),
  // Cobertura: essas o portao le direto do fonte.
  compliance: path.join(RAIZ, 'src', 'utils', 'complianceEngine.ts'),
  calculo: path.join(RAIZ, 'src', 'utils', 'folha', 'calculoDia.ts'),
}

const ORIGINAL = {}, NORMAL = {}, CRLF = {}
for (const [k, p] of Object.entries(ALVOS)) {
  if (!fs.existsSync(p)) {
    console.error(`ABORTADO: ${p} nao existe. Transpile antes:`)
    console.error('  npx tsc src/utils/folha/nomeJornada.ts --outDir scratchpad/_sim_jornada --module commonjs --target es2020')
    process.exit(1)
  }
  const bruto = fs.readFileSync(p, 'utf8')
  ORIGINAL[k] = bruto
  CRLF[k] = bruto.includes('\r\n')
  NORMAL[k] = bruto.replace(/\r\n/g, '\n')
}
function gravar(k, txtLF) {
  fs.writeFileSync(ALVOS[k], CRLF[k] ? txtLF.replace(/\n/g, '\r\n') : txtLF)
}
function restaurar() { for (const [k, p] of Object.entries(ALVOS)) fs.writeFileSync(p, ORIGINAL[k]) }

function portaoPassa() {
  try { execFileSync(process.execPath, [path.join(__dirname, 'sim_nome_jornada.js')], { stdio: 'pipe' }); return true }
  catch { return false }
}

const REGRESSOES = [
  {
    // O defeito original: 12 dos 14 sitios nao aceitavam `Á`, e a folha caia no default de
    // 08:00-17:00 - 3h de extra fabricada por dia numa jornada que vai ate 20:00.
    nome: 'a normalizacao deixa de aceitar `Á` (o defeito original)',
    alvo: 'build',
    de: "replace(/[ÀÁÂÃ]/g, 'A')",
    para: "replace(/[À]/g, 'A')",
  },
  {
    // A armadilha da propria correcao: achatar a caixa conserta o `Á` e QUEBRA todos os regex
    // sem flag /i (ScaleGrid, complianceEngine), que so casam `AS` maiusculo.
    nome: 'a normalizacao achata a caixa e quebra os regex sem /i',
    alvo: 'build',
    de: "replace(/[ÀÁÂÃ]/g, 'A').replace(/[àáâã]/g, 'a')",
    para: "replace(/[ÀÁÂÃàáâã]/g, 'a')",
  },
  {
    nome: 'um sitio volta a ler o nome sem normalizar',
    alvo: 'compliance',
    de: '/(?:ÀS|AS|as|às)\\s*([0-9]+)/.exec(normalizarNomeJornada(jornadaNome))',
    para: '/(?:ÀS|AS|as|às)\\s*([0-9]+)/.exec(jornadaNome)',
  },
  {
    nome: 'a regra do acento volta a existir em dois lugares',
    alvo: 'calculo',
    de: '  const semAcento = normalizarNomeJornada(jornadaNome)',
    para: "  const semAcento = jornadaNome.replace(/[ÀÁàá]/g, 'a')",
  },
]

let todasReprovaram = true
console.log('Injetando regressoes de proposito. O portao TEM de reprovar em cada uma.\n')

try {
  if (!portaoPassa()) {
    console.log('  ABORTADO: o portao ja reprova ANTES de qualquer injecao.')
    process.exit(1)
  }
  console.log('  (estado limpo: o portao passa)\n')

  for (const r of REGRESSOES) {
    const antes = NORMAL[r.alvo]
    const depois = antes.split(r.de).join(r.para)
    if (depois === antes) {
      console.log(`  x  ${r.nome}\n     SUBSTITUICAO NAO APLICADA - o alvo mudou de forma. Corrija o validador.`)
      todasReprovaram = false
      continue
    }
    gravar(r.alvo, depois)
    const passou = portaoPassa()
    restaurar()
    if (passou) {
      console.log(`  FALHA  ${r.nome}\n         o portao PASSOU com a regressao aplicada.`)
      todasReprovaram = false
    } else {
      console.log(`  ok     ${r.nome} -> reprovado`)
    }
  }
} finally {
  restaurar()
}

if (!portaoPassa()) {
  console.log('\n  FALHA: o portao nao voltou a passar depois de restaurar os arquivos.')
  process.exit(1)
}

console.log('\n' + (todasReprovaram
  ? `Todas as ${REGRESSOES.length} regressoes foram reprovadas pelo portao, e o estado foi restaurado.`
  : 'ALGUMA REGRESSAO PASSOU - o portao nao protege o que diz proteger.'))
process.exit(todasReprovaram ? 0 : 1)
