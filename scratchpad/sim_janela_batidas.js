/**
 * Portao de src/utils/janelaBatidas.ts — a janela de batidas do modal de validacao manual.
 *
 * Antes de rodar, transpile:
 *   npx tsc src/utils/janelaBatidas.ts src/utils/horario.ts --outDir scratchpad/_sim \
 *     --module commonjs --target es2020 --skipLibCheck
 *
 * Roda com:  node scratchpad/sim_janela_batidas.js
 *
 * ⚠️ O caso que este portao existe para travar e o da NEURIAN (01/09/2026): plantao `N`
 *   19:00 -> 07:00+1, o modal do dia 1 mostrando as batidas de 07:00/07:02 DO DIA 1 (que sao a
 *   saida do plantao da vespera) e escondendo a saida real, das 07:02 do dia 2.
 */

// O modulo transpilado faz require('@/utils/horario'), que o Node nao resolve sozinho — e o tsc
// invocado direto pela CLI emite tudo PLANO em _sim/, sem recriar a arvore de diretorios. Por isso
// o alias resolve pelo basename, nao pelo caminho.
const Module = require('module')
const path = require('path')
const resolverOriginal = Module._resolveFilename
Module._resolveFilename = function (pedido, ...resto) {
  if (pedido.startsWith('@/')) {
    return resolverOriginal.call(this, path.join(__dirname, '_sim', path.basename(pedido)), ...resto)
  }
  return resolverOriginal.call(this, pedido, ...resto)
}

const J = require('./_sim/janelaBatidas.js')

let falhas = 0
let total = 0
function ok(desc, real, esperado) {
  total++
  const bate = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bate) {
    falhas++
    console.log(`  ✗ ${desc}\n      esperado ${JSON.stringify(esperado)}\n      recebido ${JSON.stringify(real)}`)
  } else {
    console.log(`  ✓ ${desc}`)
  }
}

// ---------------------------------------------------------------------------
// 1. CASO NEURIAN — plantao N do dia 01/09, previsto 19:00 -> 07:00 do dia 02
// ---------------------------------------------------------------------------
console.log('\n1. NEURIAN — plantao N 19:00->07:00+1, celula 01/09/2026')
const celulaNeurian = J.dataDaCelula(1, 9, 2026)
const blocoNeurian = {
  inicio_previsto: '2026-09-01T22:00:00+00:00', // 19:00 local
  fim_previsto: '2026-09-02T10:00:00+00:00',    // 07:00 local do dia 2
}
const c = (iso) => J.classificarBatida(iso, celulaNeurian, blocoNeurian)

ok('entrada real 18:58 do dia 1 e do turno, sem rotulo',
  c('2026-09-01T21:58:00+00:00'), { posicao: 'no_turno', delta: 0, rotulo: null })

ok('saida real 07:02 do dia 2 e do turno, rotulada +1D',
  c('2026-09-02T10:02:00+00:00'), { posicao: 'no_turno', delta: 1, rotulo: '+1D' })

ok('07:02 DO DIA 1 (saida do plantao da vespera) fica visivel, mas fora do turno',
  c('2026-09-01T10:02:00+00:00'), { posicao: 'no_dia', delta: 0, rotulo: null })

ok('07:00 do dia 1 idem',
  c('2026-09-01T10:00:00+00:00'), { posicao: 'no_dia', delta: 0, rotulo: null })

// A regressao que motivou tudo: a batida das 07:02 do dia 2 NAO pode sumir da lista.
ok('saida real do dia 2 aparece na lista',
  J.batidaVisivelNaCelula('2026-09-02T10:02:00+00:00', celulaNeurian, blocoNeurian), true)

// E a antiga (dia civil puro) tambem continua aparecendo — a regra e UNIAO, nunca troca.
ok('batida do dia civil da celula continua aparecendo',
  J.batidaVisivelNaCelula('2026-09-01T10:02:00+00:00', celulaNeurian, blocoNeurian), true)

ok('batida de tres dias depois nao aparece',
  J.batidaVisivelNaCelula('2026-09-04T12:00:00+00:00', celulaNeurian, blocoNeurian), false)

// ---------------------------------------------------------------------------
// 2. ORDEM DE EXIBICAO — o candidato natural primeiro
// ---------------------------------------------------------------------------
console.log('\n2. ordem de exibicao')
const lista = [
  { nome: '07:02 do dia 1 (vespera)', instante: Date.parse('2026-09-01T10:02:00Z'), posicao: 'no_dia' },
  { nome: '07:02 do dia 2 (saida real)', instante: Date.parse('2026-09-02T10:02:00Z'), posicao: 'no_turno' },
  { nome: '18:58 do dia 1 (entrada real)', instante: Date.parse('2026-09-01T21:58:00Z'), posicao: 'no_turno' },
]
ok('as do turno vem primeiro, cronologicas; as do dia civil depois',
  [...lista].sort(J.compararBatidasParaExibir).map(x => x.nome),
  ['18:58 do dia 1 (entrada real)', '07:02 do dia 2 (saida real)', '07:02 do dia 1 (vespera)'])

// ---------------------------------------------------------------------------
// 3. SEM BLOCO PREVISTO — cai no dia civil, o comportamento antigo
// ---------------------------------------------------------------------------
console.log('\n3. celula sem previsto (recem-lancada)')
ok('mesmo dia civil aparece',
  J.batidaVisivelNaCelula('2026-09-01T10:02:00+00:00', celulaNeurian, null), true)
ok('dia seguinte nao aparece sem bloco para justifica-lo',
  J.batidaVisivelNaCelula('2026-09-02T10:02:00+00:00', celulaNeurian, null), false)

// ---------------------------------------------------------------------------
// 4. FUSO — a data e a de America/Sao_Paulo, nunca a do processo (armadilha 12)
// ---------------------------------------------------------------------------
console.log('\n4. fuso')
// 02/09 02:30 UTC = 01/09 23:30 em Sao Paulo. Para a celula do dia 2, e a VESPERA.
ok('22:30-03 do dia 1 gravado como 02/09 UTC ainda e -1D para a celula do dia 2',
  J.deltaDiaDaBatida('2026-09-02T02:30:00+00:00', J.dataDaCelula(2, 9, 2026)), -1)
ok('e para a celula do dia 1 e o proprio dia',
  J.deltaDiaDaBatida('2026-09-02T02:30:00+00:00', J.dataDaCelula(1, 9, 2026)), 0)

// ---------------------------------------------------------------------------
// 5. ROTULOS
// ---------------------------------------------------------------------------
console.log('\n5. rotulos')
ok('mesmo dia nao ganha rotulo', J.rotuloDiaRelativo(0), null)
ok('dia seguinte', J.rotuloDiaRelativo(1), '+1D')
ok('vespera usa o sinal de menos, nao o hifen', J.rotuloDiaRelativo(-1), '−1D')

// ---------------------------------------------------------------------------
// 6. VIRADA DE MES — o plantao do dia 30 termina no dia 1 do mes seguinte
// ---------------------------------------------------------------------------
console.log('\n6. virada de mes')
const celula30 = J.dataDaCelula(30, 9, 2026)
const bloco30 = {
  inicio_previsto: '2026-09-30T22:00:00+00:00',
  fim_previsto: '2026-10-01T10:00:00+00:00',
}
ok('saida de 01/10 pertence ao turno do dia 30 e sai como +1D',
  J.classificarBatida('2026-10-01T10:03:00+00:00', celula30, bloco30),
  { posicao: 'no_turno', delta: 1, rotulo: '+1D' })

console.log(`\n${total - falhas}/${total} casos passaram.`)
if (falhas > 0) {
  console.log(`\n${falhas} FALHA(S).`)
  process.exit(1)
}
