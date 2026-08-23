/**
 * Portao de toleranciaExtra.ts (nao ha framework de teste no projeto).
 *
 * Transpile antes:
 *   npx tsc src/utils/folha/toleranciaExtra.ts --outDir scratchpad/_sim --module commonjs --target es2020
 * Depois:
 *   node scratchpad/sim_tolerancia_extra.js
 */
const T = require('./_sim/toleranciaExtra.js')
const { toleranciaAbsorve, lerLimitesTolerancia, TOLERANCIA_CLT, minutosEntre } = T

let ok = 0, falhou = 0
function caso(nome, real, esperado) {
  const bateu = JSON.stringify(real) === JSON.stringify(esperado)
  if (bateu) ok++; else { falhou++; console.log('  FALHOU: ' + nome + '  esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(real)) }
}
const abs = (saida, entrada, lim) => toleranciaAbsorve({ excedenteSaidaMin: saida, antecipacaoEntradaMin: entrada, limites: lim })

console.log('### CLT padrao (5 por marcacao / 10 no dia)')
caso('saiu 4 min depois -> absorve',            abs(4, 0), true)
caso('saiu 5 min depois (limite exato)',        abs(5, 0), true)
caso('saiu 6 min depois -> NAO absorve',        abs(6, 0), false)
caso('saiu 12 min -> NAO absorve (paga 12)',    abs(12, 0), false)
caso('4 antes + 4 depois = 8 no dia -> absorve', abs(4, 4), true)
caso('5 antes + 5 depois = 10 no dia -> absorve', abs(5, 5), true)
caso('6 antes + 4 depois -> entrada estoura',   abs(4, 6), false)
caso('4 antes + 6 depois -> saida estoura',     abs(6, 4), false)
caso('sem excedente de saida -> nada a absorver', abs(0, 4), false)
caso('excedente negativo (saiu antes)',         abs(-3, 0), false)

console.log('### desligada (0/0)')
const off = { porMarcacaoMin: 0, diariaMin: 0 }
caso('1 min com tolerancia desligada',          abs(1, 0, off), false)
caso('4 min com tolerancia desligada',          abs(4, 0, off), false)

console.log('### limite diario mais apertado que o por marcacao')
const apertado = { porMarcacaoMin: 5, diariaMin: 6 }
caso('4 antes + 4 depois = 8 > 6 diario',       abs(4, 4, apertado), false)
caso('3 antes + 3 depois = 6 = diario',         abs(3, 3, apertado), true)

console.log('### leitura da configuracao')
caso('lista crua do PostgREST', lerLimitesTolerancia([
  { chave: 'tolerancia_extra_minutos_por_marcacao', valor: 7 },
  { chave: 'tolerancia_extra_minutos_diaria', valor: 14 },
]), { porMarcacaoMin: 7, diariaMin: 14 })
caso('valor como string (jsonb devolve texto)', lerLimitesTolerancia([
  { chave: 'tolerancia_extra_minutos_por_marcacao', valor: '3' },
  { chave: 'tolerancia_extra_minutos_diaria', valor: '9' },
]), { porMarcacaoMin: 3, diariaMin: 9 })
caso('config ausente -> default CLT',           lerLimitesTolerancia(null), TOLERANCIA_CLT)
caso('chave faltando -> default so nela',       lerLimitesTolerancia([
  { chave: 'tolerancia_extra_minutos_diaria', valor: 20 },
]), { porMarcacaoMin: 5, diariaMin: 20 })
caso('valor invalido nao vira NaN',             lerLimitesTolerancia([
  { chave: 'tolerancia_extra_minutos_por_marcacao', valor: 'abc' },
]), TOLERANCIA_CLT)
caso('valor negativo cai no default',           lerLimitesTolerancia([
  { chave: 'tolerancia_extra_minutos_por_marcacao', valor: -5 },
]), TOLERANCIA_CLT)
caso('zero e valido (desliga), nao vira default', lerLimitesTolerancia([
  { chave: 'tolerancia_extra_minutos_por_marcacao', valor: 0 },
  { chave: 'tolerancia_extra_minutos_diaria', valor: 0 },
]), { porMarcacaoMin: 0, diariaMin: 0 })

console.log('### minutosEntre')
const d = h => new Date('2026-08-10T' + h + ':00-03:00')
caso('18:07 - 18:00 = 7',                       minutosEntre(d('18:07'), d('18:00')), 7)
caso('nunca negativo',                          minutosEntre(d('17:55'), d('18:00')), 0)
caso('null devolve 0',                          minutosEntre(null, d('18:00')), 0)

console.log('')
console.log(ok + ' passaram, ' + falhou + ' falharam')
process.exit(falhou ? 1 : 0)
