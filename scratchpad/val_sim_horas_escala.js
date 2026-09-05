// Valida o portao sim_horas_escala.js injetando regressoes de proposito (CLAUDE.md, armadilha 36).
// Cada regressao e um erro que ja aconteceu de verdade neste projeto; o portao TEM de reprovar.
//
// ⚠️ CONFIRMA QUE A SUBSTITUICAO FOI APLICADA antes de rodar (armadilha 48): um replace no-op
//   faria o portao "passar" e o teste do teste mentiria — que e pior que nao ter teste.
const fs = require('fs')
const { execFileSync } = require('child_process')

const ALVOS = {
  horas: 'scratchpad/_sim/escala/horasLinha.js',
  pag: 'scratchpad/_sim/paginacao.js'
}
const original = {}
for (const [k, p] of Object.entries(ALVOS)) original[k] = fs.readFileSync(p, 'utf8')

function restaurar() {
  for (const [k, p] of Object.entries(ALVOS)) fs.writeFileSync(p, original[k])
}

function rodarPortao() {
  try {
    execFileSync(process.execPath, ['scratchpad/sim_horas_escala.js'], { stdio: 'pipe' })
    return true   // passou
  } catch {
    return false  // reprovou
  }
}

const REGRESSOES = [
  {
    nome: 'Regular volta a somar o VAO BRUTO (o defeito medido: 163.392h contra 126.169h)',
    alvo: 'horas',
    de: 'return teto === null ? horas : Math.min(horas, teto);',
    para: 'return horas;'
  },
  {
    nome: 'Sobreaviso volta a entrar na carga como se fosse trabalho',
    alvo: 'horas',
    de: "if (categoria === 'Sobreaviso')\n        return 0;",
    para: "if (categoria === 'Sobreaviso')\n        return horas;"
  },
  {
    nome: 'teto passa a SUBSTITUIR em vez de LEAST (turno reduzido de 4h viraria 8h)',
    alvo: 'horas',
    de: 'return teto === null ? horas : Math.min(horas, teto);',
    para: 'return teto === null ? horas : teto;'
  },
  {
    nome: 'paginacao para na primeira pagina (o corte de 1000 de volta)',
    alvo: 'pag',
    de: 'for (let from = 0;; from += tamanhoPagina) {',
    para: 'for (let from = 0; from < 1; from += tamanhoPagina) {'
  },
  {
    nome: 'falha de pagina passa a ser reportada como completa (armadilha 22)',
    alvo: 'pag',
    de: 'return { linhas, completo: false, erro: error };',
    para: 'return { linhas, completo: true, erro: error };'
  }
]

// Sanidade: sem regressao nenhuma, o portao tem de PASSAR.
restaurar()
if (!rodarPortao()) {
  console.error('ABORTA: o portao reprova ja no codigo limpo — corrija o portao antes de validar.')
  process.exit(1)
}
console.log('base limpa: portao PASSA (como esperado)')

let falhasDaValidacao = 0
for (const r of REGRESSOES) {
  restaurar()
  const p = ALVOS[r.alvo]
  const antes = fs.readFileSync(p, 'utf8')
  const ocorrencias = antes.split(r.de).length - 1
  if (ocorrencias < 1) {
    console.error(`  ✗ "${r.nome}": padrao NAO ENCONTRADO no transpilado — injecao seria no-op`)
    falhasDaValidacao++
    continue
  }
  const depois = antes.split(r.de).join(r.para)
  if (depois === antes) {
    console.error(`  ✗ "${r.nome}": substituicao nao alterou nada`)
    falhasDaValidacao++
    continue
  }
  fs.writeFileSync(p, depois)
  const passou = rodarPortao()
  if (passou) {
    console.error(`  ✗ "${r.nome}": o portao PASSOU com a regressao aplicada — nao protege isso`)
    falhasDaValidacao++
  } else {
    console.log(`  ✓ "${r.nome}": portao reprovou, como devia`)
  }
}

restaurar()
if (!rodarPortao()) {
  console.error('ABORTA: portao reprova depois de restaurar — o transpilado ficou sujo.')
  process.exit(1)
}

console.log(`\n${REGRESSOES.length - falhasDaValidacao}/${REGRESSOES.length} regressoes detectadas`)
if (falhasDaValidacao) process.exit(1)
console.log('VALIDACAO OK — o portao reprova todas as regressoes injetadas')
