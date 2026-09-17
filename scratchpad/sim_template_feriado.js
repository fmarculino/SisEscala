/**
 * Portao de `diasDeFeriado` + `generateTemplate` (issue #5): o Aplicar Template nao pode
 * preencher feriado.
 *
 * Transpile antes com:
 *   npx tsc src/utils/scaleTemplates.ts --outDir scratchpad/_sim_ui --module commonjs --target es2020
 */
const tpl = require('./_sim_ui/scaleTemplates.js')

let ok = 0
let falhas = 0

function eq(nome, obtido, esperado) {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) { ok++ } else {
    falhas++
    console.error('FALHOU: ' + nome + '\n  obtido:   ' + a + '\n  esperado: ' + b)
  }
}
function verdade(nome, cond) { eq(nome, !!cond, true) }
const dias = s => [...s].sort((a, b) => a - b)

// Setembro/2026: dia 1 = terca. Feriado da Independencia no dia 7 (segunda).
const FERIADOS_092026 = [
  { data: '2026-09-07', descricao: 'Independência do Brasil' },
  { data: '2026-09-21', descricao: 'Feriado municipal' }
]

// ---------------------------------------------------------------- diasDeFeriado

eq('acha os feriados da competencia', dias(tpl.diasDeFeriado(FERIADOS_092026, 9, 2026, 30)), [7, 21])
eq('lista vazia', dias(tpl.diasDeFeriado([], 9, 2026, 30)), [])
eq('null nao quebra', dias(tpl.diasDeFeriado(null, 9, 2026, 30)), [])
eq('undefined nao quebra', dias(tpl.diasDeFeriado(undefined, 9, 2026, 30)), [])

// So a competencia aberta. Um feriado de outro mes/ano nao pode furtar um dia de trabalho.
eq(
  'feriado de outro mes nao entra',
  dias(tpl.diasDeFeriado([{ data: '2026-10-12', descricao: 'Padroeira' }], 9, 2026, 30)),
  []
)
eq(
  'feriado do mesmo dia em outro ANO nao entra',
  dias(tpl.diasDeFeriado([{ data: '2025-09-07', descricao: 'Independência' }], 9, 2026, 30)),
  []
)
// Mes de um digito precisa casar com o zero a esquerda do banco.
eq(
  'mes com zero a esquerda casa',
  dias(tpl.diasDeFeriado([{ data: '2026-01-01', descricao: 'Ano novo' }], 1, 2026, 31)),
  [1]
)
// Dia fora do mes (dado torto) e descartado em vez de virar dia inexistente.
eq(
  'dia acima do fim do mes e descartado',
  dias(tpl.diasDeFeriado([{ data: '2026-02-30', descricao: 'inexistente' }], 2, 2026, 28)),
  []
)
eq(
  'linha sem data e ignorada',
  dias(tpl.diasDeFeriado([{ descricao: 'sem data' }, { data: null }, { data: '2026-09-07' }], 9, 2026, 30)),
  [7]
)
// Feriado repetido (dois cadastros no mesmo dia) conta uma vez so.
eq(
  'feriado duplicado nao duplica o dia',
  dias(tpl.diasDeFeriado(
    [{ data: '2026-09-07', descricao: 'A' }, { data: '2026-09-07', descricao: 'B' }],
    9, 2026, 30
  )),
  [7]
)

// ⚠️ ARMADILHA 12: o processo roda em UTC. `new Date('2026-09-07')` e meia-noite UTC, que em
// America/Sao_Paulo e dia 6 — uma implementacao por Date pularia o dia ERRADO.
const porData = new Date('2026-09-07').getDate()
verdade('a conta nao depende de new Date (que aqui daria ' + porData + ')', dias(tpl.diasDeFeriado(FERIADOS_092026, 9, 2026, 30))[0] === 7)

// ---------------------------------------------------------------- template + feriado

const cfg = { type: '5x2', turnoId: 'T1', startDay: 1, startWorking: true }

const semFeriado = tpl.generateTemplate(cfg, 30, 9, 2026, new Set())
verdade('5x2 preenche o feriado quando ele nao e pulado', !!semFeriado[7])

const feriadoPulado = tpl.generateTemplate(
  cfg, 30, 9, 2026,
  tpl.diasDeFeriado(FERIADOS_092026, 9, 2026, 30)
)
eq('5x2 nao preenche o dia 7', feriadoPulado[7], undefined)
eq('5x2 nao preenche o dia 21', feriadoPulado[21], undefined)
verdade('5x2 continua preenchendo o dia util vizinho', !!feriadoPulado[8])
// Fim de semana continua vazio por conta propria — o feriado nao mexeu nisso.
eq('5x2 continua sem sabado', feriadoPulado[5], undefined)
eq('5x2 continua sem domingo', feriadoPulado[6], undefined)

// 🚨 Os CICLICOS caem em qualquer dia da semana de proposito, e por isso preenchiam o feriado.
// Pular tem de valer para eles tambem: e justamente o plantonista que gera a presenca retroativa
// que ninguem consegue apagar.
for (const tipo of ['12x36', '12x48', '6x1']) {
  const base = tpl.generateTemplate({ ...cfg, type: tipo }, 30, 9, 2026, new Set())
  const comFeriado = tpl.generateTemplate(
    { ...cfg, type: tipo }, 30, 9, 2026,
    tpl.diasDeFeriado(FERIADOS_092026, 9, 2026, 30)
  )
  eq(tipo + ': nao preenche o dia 7', comFeriado[7], undefined)
  eq(tipo + ': nao preenche o dia 21', comFeriado[21], undefined)
  // O ciclo NAO se desloca: pular um dia nao pode empurrar o resto da escala.
  const outrosIguais = Object.keys(base)
    .filter(d => d !== '7' && d !== '21')
    .every(d => comFeriado[d] === base[d])
  verdade(tipo + ': o ciclo dos demais dias nao se desloca', outrosIguais)
}

// Feriado e os outros motivos de pular convivem no mesmo canal (protectedDays).
const combinado = tpl.generateTemplate(
  cfg, 30, 9, 2026,
  new Set([...tpl.diasDeFeriado(FERIADOS_092026, 9, 2026, 30), 8, 9])
)
eq('feriado e afastamento no mesmo conjunto', [combinado[7], combinado[8], combinado[9]], [undefined, undefined, undefined])
verdade('e o dia 10 continua preenchido', !!combinado[10])

// Competencia sem feriado nenhum: o template nao muda em nada.
const semNada = tpl.generateTemplate(cfg, 31, 8, 2026, tpl.diasDeFeriado(FERIADOS_092026, 8, 2026, 31))
const semNadaDireto = tpl.generateTemplate(cfg, 31, 8, 2026, new Set())
eq('mes sem feriado fica identico', semNada, semNadaDireto)

console.log('\n' + ok + ' assercoes passaram, ' + falhas + ' falharam')
process.exit(falhas === 0 ? 0 : 1)
