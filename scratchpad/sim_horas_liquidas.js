/**
 * Portao das HORAS NORMAIS LIQUIDAS e da REABERTURA DE FOLHA (04/09/2026).
 *
 * Transpile antes:
 *   npx tsc src/utils/folha/cargaDiaria.ts src/utils/folha/reabertura.ts src/utils/folha/calculoDia.ts --outDir scratchpad/_sim --module commonjs --target es2020
 */
const C = require('./_sim/cargaDiaria.js')
const R = require('./_sim/reabertura.js')
const D = require('./_sim/calculoDia.js')

let ok = 0, falhou = 0
function t(nome, real, esperado) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado)
  if (a === b) { ok++; return }
  falhou++
  console.log(`  FALHOU  ${nome}\n          esperado ${b}\n          obtido   ${a}`)
}

console.log('== horas normais: o intervalo sai da jornada ==')
const j1018 = { nome: '08H ÀS 18H', horas_totais: 10, intervalo_minutos: 120 }
t('08H AS 18H bruto (ate 08/2026)', C.horasNormaisDaJornada(j1018, false), 10)
t('08H AS 18H liquido (de 09/2026)', C.horasNormaisDaJornada(j1018, true), 8)
t('o caso da folha: 21 dias x liquido = 168h', C.horasNormaisDaJornada(j1018, true) * 21, 168)
t('jornada sem intervalo nao muda', C.horasNormaisDaJornada({ nome: '13H ÀS 19H', horas_totais: 6, intervalo_minutos: 0 }, true), 6)
t('intervalo nulo e tratado como zero', C.horasNormaisDaJornada({ horas_totais: 6, intervalo_minutos: null }, true), 6)
t('sem jornada cai no padrao', C.horasNormaisDaJornada(null, true), 8)
t('nunca negativo', C.horasNormaisDaJornada({ horas_totais: 1, intervalo_minutos: 120 }, true), 0)

console.log('== as tres jornadas que o cadastro corrigiu ==')
// ⚠️ Depois da migration 20260904110000 as tres guardam o VAO (9h) e 1h de intervalo.
for (const nome of ['08H ÀS 17H', '09H ÀS 18H', '10H ÀS 19H']) {
  t(`${nome} -> 8h de trabalho`, C.horasNormaisDaJornada({ nome, horas_totais: 9, intervalo_minutos: 60 }, true), 8)
}
// 🚨 O motivo de a migration existir: 08H AS 17H guardava 8 (ja liquido). Descontar dali daria 7.
t('cadastro ANTIGO de 08H AS 17H daria 7h (por isso foi corrigido)',
  C.horasNormaisDaJornada({ nome: '08H ÀS 17H', horas_totais: 8, intervalo_minutos: 60 }, true), 7)

console.log('== o mapa por jornada carrega a mesma regra ==')
const jornadas = [j1018, { nome: '13H ÀS 19H', horas_totais: 6, intervalo_minutos: 0 }]
t('mapa bruto', [...C.montarCargaPorJornada(jornadas, false).values()], [10, 6])
t('mapa liquido', [...C.montarCargaPorJornada(jornadas, true).values()], [8, 6])
t('default do mapa e bruto (compatibilidade)', [...C.montarCargaPorJornada(jornadas).values()], [10, 6])
t('horasNormaisDoDia usa o mapa', C.horasNormaisDoDia({ jornada_nome: '08H ÀS 18H' }, C.montarCargaPorJornada(jornadas, true), 8), 8)
t('jornada desconhecida cai no padrao', C.horasNormaisDoDia({ jornada_nome: 'INEXISTENTE' }, C.montarCargaPorJornada(jornadas, true), 8), 8)

console.log('== corte: 08/2026 continua com o vao (documento assinado) ==')
t('08/2026 fora', D.horasNormaisLiquidasVigente(8, 2026), false)
t('09/2026 dentro', D.horasNormaisLiquidasVigente(9, 2026), true)
t('10/2026 dentro', D.horasNormaisLiquidasVigente(10, 2026), true)
t('config move para 10/2026', D.horasNormaisLiquidasVigente(9, 2026, '2026-10'), false)
t('config malformada nao abre para tras', D.horasNormaisLiquidasVigente(8, 2026, 'setembro'), false)
t('e uma chave SEPARADA da compensacao', [D.COMPETENCIA_HORAS_LIQUIDAS_PADRAO, D.COMPETENCIA_COMPENSACAO_PADRAO], ['2026-09', '2026-09'])
// A consequencia: a mesma folha, competencias diferentes
t('08/2026 soma 10h/dia', C.horasNormaisDaJornada(j1018, D.horasNormaisLiquidasVigente(8, 2026)), 10)
t('09/2026 soma 8h/dia', C.horasNormaisDaJornada(j1018, D.horasNormaisLiquidasVigente(9, 2026)), 8)

console.log('== reabertura de folha fechada ==')
t('super_admin reabre', R.podeReabrirFolha('super_admin'), true)
t('admin (Diretor) reabre', R.podeReabrirFolha('admin'), true)
t('RH Geral reabre', R.podeReabrirFolha('rh'), true)
t('RH da Unidade reabre', R.podeReabrirFolha('rh_unidade'), true)
t('coordenador NAO reabre (fechou, nao desfaz sozinho)', R.podeReabrirFolha('coordenador'), false)
t('ass_adm NAO reabre', R.podeReabrirFolha('ass_adm'), false)
t('servidor NAO reabre', R.podeReabrirFolha('servidor'), false)
t('papel nulo NAO reabre', R.podeReabrirFolha(null), false)
t('papel desconhecido NAO reabre', R.podeReabrirFolha('novo_papel'), false)

console.log(`\n${falhou === 0 ? 'TUDO OK' : 'HOUVE FALHA'} — ${ok} passaram, ${falhou} falharam`)
process.exit(falhou === 0 ? 0 : 1)
