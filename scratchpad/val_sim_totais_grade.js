// Valida o portao sim_totais_grade.js injetando regressoes de proposito (CLAUDE.md, armadilha 36).
// Cada regressao e um defeito que existiu de verdade nesta grade; o portao TEM de reprovar.
//
// ⚠️ CONFIRMA QUE A SUBSTITUICAO FOI APLICADA antes de rodar (armadilha 48): um replace no-op
//   faria o portao "passar" e o teste do teste mentiria — pior que nao ter teste. As ancoras da
//   grade sao o texto do TSX; as da regra de horas sao o texto do JS ja TRANSPILADO.
const fs = require('fs')
const { execFileSync } = require('child_process')

const DIR = 'src/app/(dashboard)/escalas/unidade/[unidadeId]'
const ALVOS = {
  grade: DIR + '/ScaleGrid.tsx',
  pagina: DIR + '/page.tsx',
  horas: 'scratchpad/_sim/escala/horasLinha.js',
}
const original = {}
for (const [k, p] of Object.entries(ALVOS)) original[k] = fs.readFileSync(p, 'utf8')

function restaurar() {
  for (const [k, p] of Object.entries(ALVOS)) fs.writeFileSync(p, original[k])
}

function rodarPortao() {
  try {
    execFileSync(process.execPath, ['scratchpad/sim_totais_grade.js'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const REGRESSOES = [
  {
    nome: 'as jornadas voltam a comecar VAZIAS no cliente (a causa do "pisca e volta ao antigo")',
    alvo: 'grade',
    de: 'const [jornadas, setJornadas] = useState<any[]>(jornadasIniciais)',
    para: 'const [jornadas, setJornadas] = useState<any[]>([])',
  },
  {
    nome: 'page.tsx para de mandar as jornadas para a grade',
    alvo: 'pagina',
    de: '        jornadasIniciais={jornadas || []}\r\n',
    para: '',
  },
  {
    nome: 'calculateTotals volta a reimplementar o teto a mao (4a copia da regra)',
    alvo: 'grade',
    de: "const liquidHours = horasDaLinhaEscala('Regular', shiftHours, jornada)",
    para: 'const liquidHours = Math.min(shiftHours, Number(jornada?.horas_totais) || shiftHours)',
  },
  {
    nome: 'calculateTotals volta a ler o dia pelo fuso do processo (armadilha 12)',
    alvo: 'grade',
    de: '    const hoje = hojeNoFusoDoSistema()\r\n    const currentDay = hoje.dia',
    para: '    const hoje = { dia: 0, mes: 0, ano: 0 }\r\n    const currentDay = new Date().getDate()',
  },
  {
    nome: 'o "hoje" volta a ser congelado no mount (a grade atravessa a meia-noite)',
    alvo: 'grade',
    de: 'function hojeNoFusoDoSistema() {',
    para: 'const hojeLocal = useMemo(() => null, [])\nfunction hojeNoFusoDoSistema() {',
  },
  {
    nome: 'o teto da jornada volta a ser silencioso (sem tooltip explicando a CH)',
    alvo: 'grade',
    de: 'const chTooltip = limitou',
    para: 'const chTooltipRemovido = limitou',
  },
  {
    nome: 'o total deixa de decompor as parcelas (a hora avulsa de plantao volta a sumir)',
    alvo: 'grade',
    de: 'const composicao = [',
    para: 'const composicaoRemovida = [',
  },
  {
    nome: 'o teto passa a SUBSTITUIR em vez de LEAST (M4 de 4h viraria 6h)',
    alvo: 'horas',
    de: 'return teto === null ? horas : Math.min(horas, teto);',
    para: 'return teto === null ? horas : teto;',
  },
]

console.log('Validando o portao sim_totais_grade.js\n')

if (!rodarPortao()) {
  console.log('ERRO: o portao ja reprova com a base limpa. Corrija antes de validar.')
  process.exit(1)
}
console.log('base limpa: portao PASSA (como esperado)')

let detectadas = 0
for (const r of REGRESSOES) {
  const caminho = ALVOS[r.alvo]
  const antes = original[r.alvo]
  const ocorrencias = antes.split(r.de).length - 1
  if (ocorrencias !== 1) {
    console.log(`  ✗ "${r.nome}": ancora encontrada ${ocorrencias}x (esperava 1). INJECAO NAO APLICADA.`)
    restaurar()
    process.exit(1)
  }
  const depois = antes.split(r.de).join(r.para)
  if (depois === antes) {
    console.log(`  ✗ "${r.nome}": substituicao no-op. INJECAO NAO APLICADA.`)
    restaurar()
    process.exit(1)
  }
  fs.writeFileSync(caminho, depois)

  const passou = rodarPortao()
  restaurar()

  if (passou) {
    console.log(`  ✗ "${r.nome}": o portao PASSOU com a regressao aplicada.`)
  } else {
    console.log(`  ✓ "${r.nome}": portao reprovou, como devia`)
    detectadas++
  }
}

restaurar()
console.log(`\n${detectadas}/${REGRESSOES.length} regressoes detectadas`)
if (detectadas !== REGRESSOES.length) {
  console.log('VALIDACAO REPROVOU')
  process.exit(1)
}
console.log('VALIDACAO OK — o portao reprova todas as regressoes injetadas')
