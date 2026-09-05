// Portao de horasLinha.ts + paginacao.ts (05/09/2026). Nao ha framework de teste no projeto.
//
// Transpile antes:
//   npx tsc src/utils/escala/horasLinha.ts src/utils/paginacao.ts --outDir scratchpad/_sim --module commonjs --target es2020
//
// Validado injetando regressao de proposito (val_sim_horas_escala.js) — teste que nunca reprova
// nao vale nada (CLAUDE.md, armadilha 36).
const { horasDaLinhaEscala, horasProntidaoSobreaviso, tetoLiquidoJornada } = require('./_sim/escala/horasLinha')
const { buscarTodasPaginas } = require('./_sim/paginacao')

let ok = 0, falhas = []
function eq(nome, obtido, esperado) {
  if (obtido === esperado) { ok++; return }
  falhas.push(`${nome}: obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`)
}

// ---------------- tetoLiquidoJornada ----------------
eq('teto 08H AS 18H (10h vao, 120min)', tetoLiquidoJornada({ horas_totais: 10, intervalo_minutos: 120 }), 8)
eq('teto 08H AS 12H (4h, sem intervalo)', tetoLiquidoJornada({ horas_totais: 4, intervalo_minutos: 0 }), 4)
eq('teto com intervalo maior que a jornada nunca negativo', tetoLiquidoJornada({ horas_totais: 1, intervalo_minutos: 120 }), 0)
eq('teto de jornada nula', tetoLiquidoJornada(null), null)
eq('teto de horas_totais ausente', tetoLiquidoJornada({ intervalo_minutos: 60 }), null)
eq('teto de horas_totais zero', tetoLiquidoJornada({ horas_totais: 0, intervalo_minutos: 60 }), null)
eq('teto aceita string do PostgREST', tetoLiquidoJornada({ horas_totais: '10', intervalo_minutos: '120' }), 8)

// ---------------- Regular: o caso que motivou tudo ----------------
const J8 = { horas_totais: 10, intervalo_minutos: 120 }   // "08H AS 18H"
const J6 = { horas_totais: 6, intervalo_minutos: 0 }      // "07H AS 13H"
eq('Regular MT(12h) em jornada 10h/2h de intervalo -> 8h', horasDaLinhaEscala('Regular', 12, J8), 8)
eq('Regular M(6h) em jornada 10h/2h -> 6h (turno reduzido NAO vira 8h)', horasDaLinhaEscala('Regular', 6, J8), 6)
eq('Regular M4(4h) em jornada 6h -> 4h', horasDaLinhaEscala('Regular', 4, J6), 4)
eq('Regular sem jornada resolvivel -> horas do turno, sem teto inventado', horasDaLinhaEscala('Regular', 12, null), 12)
eq('Regular com jornada sem horas_totais -> sem teto', horasDaLinhaEscala('Regular', 12, { intervalo_minutos: 60 }), 12)

// ---------------- Plantao e Extra: NUNCA limitados pela jornada regular ----------------
eq('Plantao MT(12h) em jornada de 8h liquidas -> 12h cheias', horasDaLinhaEscala('Plantão', 12, J8), 12)
eq('Plantao MTN(24h) -> 24h', horasDaLinhaEscala('Plantão', 24, J8), 24)
eq('Extra 2h em jornada de 8h -> 2h', horasDaLinhaEscala('Extra', 2, J8), 2)
eq('Extra 12h nao e cortado pela jornada', horasDaLinhaEscala('Extra', 12, J6), 12)

// ---------------- Sobreaviso nao entra na carga ----------------
eq('Sobreaviso vale 0 na carga', horasDaLinhaEscala('Sobreaviso', 12, J8), 0)
eq('Sobreaviso 24h vale 0 na carga', horasDaLinhaEscala('Sobreaviso', 24, null), 0)
eq('prontidao usa horas_computadas quando ha', horasProntidaoSobreaviso(12, 'MT'), 12)
eq('prontidao MTN sem horas cadastradas -> 24', horasProntidaoSobreaviso(0, 'MTN'), 24)
eq('prontidao MT sem horas cadastradas -> 12', horasProntidaoSobreaviso(0, 'MT'), 12)
eq('prontidao N sem horas cadastradas -> 12', horasProntidaoSobreaviso(null, 'N'), 12)
eq('prontidao de codigo desconhecido sem horas -> 0, nunca chute', horasProntidaoSobreaviso(0, 'XYZ'), 0)

// ---------------- entradas degeneradas ----------------
eq('horas nula -> 0', horasDaLinhaEscala('Regular', null, J8), 0)
eq('horas vazia -> 0', horasDaLinhaEscala('Plantão', '', J8), 0)
eq('horas negativa -> 0', horasDaLinhaEscala('Plantão', -5, J8), 0)
eq('horas nao numerica -> 0', horasDaLinhaEscala('Plantão', 'abc', J8), 0)
eq('categoria desconhecida cai no ramo sem teto', horasDaLinhaEscala('Outra', 9, J8), 9)

// ---------------- soma agregada: o numero que o painel exibe ----------------
// Reproduz a divergencia medida: 3 dias de Regular MT em jornada 10h/2h.
const dias = [
  { cat: 'Regular', h: 12 }, { cat: 'Regular', h: 12 }, { cat: 'Regular', h: 12 },
  { cat: 'Plantão', h: 12 }, { cat: 'Sobreaviso', h: 12 }
]
const somaCarga = dias.reduce((a, d) => a + horasDaLinhaEscala(d.cat, d.h, J8), 0)
eq('soma da carga: 3x8 de Regular + 12 de Plantao, sobreaviso fora', somaCarga, 36)
const somaBruta = dias.filter(d => d.cat !== 'Sobreaviso').reduce((a, d) => a + Number(d.h), 0)
eq('a soma BRUTA (o defeito antigo) daria 48 — a diferenca e o intervalo', somaBruta, 48)

// ---------------- paginacao ----------------
function fonte(total, tamanho, falharNaPagina) {
  const linhas = Array.from({ length: total }, (_, i) => ({ id: i }))
  return (from, to) => {
    if (falharNaPagina !== undefined && Math.floor(from / tamanho) === falharNaPagina) {
      return Promise.resolve({ data: null, error: { message: 'falha simulada' } })
    }
    return Promise.resolve({ data: linhas.slice(from, to + 1), error: null })
  }
}
;(async () => {
  let r = await buscarTodasPaginas(fonte(2338, 1000), 1000)
  eq('2338 linhas em paginas de 1000 -> traz todas', r.linhas.length, 2338)
  eq('2338 linhas -> completo', r.completo, true)

  r = await buscarTodasPaginas(fonte(1000, 1000), 1000)
  eq('exatamente 1000 (a fronteira que engana) -> traz 1000', r.linhas.length, 1000)
  eq('exatamente 1000 -> completo', r.completo, true)

  r = await buscarTodasPaginas(fonte(0, 1000), 1000)
  eq('vazio -> 0 linhas', r.linhas.length, 0)
  eq('vazio -> completo', r.completo, true)

  r = await buscarTodasPaginas(fonte(1384, 500), 500)
  eq('tamanho de pagina 500 -> traz as 1384', r.linhas.length, 1384)

  r = await buscarTodasPaginas(fonte(3000, 1000, 1), 1000)
  eq('falha na 2a pagina -> devolve so o que veio', r.linhas.length, 1000)
  eq('falha na 2a pagina -> completo = false (o aviso na tela depende disso)', r.completo, false)

  console.log(`\n${ok} asserções OK, ${falhas.length} falha(s)`)
  if (falhas.length) { falhas.forEach(f => console.error('  ✗ ' + f)); process.exit(1) }
  console.log('PORTAO OK')
})()
