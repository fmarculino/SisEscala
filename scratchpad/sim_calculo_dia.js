/**
 * Portao de src/utils/folha/calculoDia.ts (04/09/2026).
 *
 * Transpile antes:
 *   npx tsc src/utils/folha/calculoDia.ts --outDir scratchpad/_sim --module commonjs --target es2020   (gera scratchpad/_sim/calculoDia.js)
 *
 * Cobre os casos da Portaria 382/2019 (Art. 7 §1/§2/§3/§5) e as armadilhas medidas em producao:
 * jornada que cruza a meia-noite, jornada sem intervalo, jornada com acento agudo, jornada_nome
 * vazio no snapshot, e o total mensal acima de 24h.
 */
const C = require('./_sim/calculoDia.js')

let ok = 0, falhou = 0
function t(nome, real, esperado) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado)
  if (a === b) { ok++; return }
  falhou++
  console.log(`  FALHOU  ${nome}\n          esperado ${b}\n          obtido   ${a}`)
}
const dia = (o) => Object.assign({ dia: 1, turno_codigo: 'M' }, o)

console.log('== formatacao HH:MM ==')
t('total mensal acima de 24h nao volta a zero', C.formatarMinutosHHMM(210 * 60), '210:00')
t('47 min', C.formatarMinutosHHMM(47), '0:47')
t('11 min (o 0.18h que a impressao mostrava)', C.formatarMinutosHHMM(11), '0:11')
t('zero', C.formatarMinutosHHMM(0), '0:00')
t('nulo', C.formatarMinutosHHMM(null), '0:00')
t('negativo nao vaza', C.formatarMinutosHHMM(-30), '0:00')

console.log('== previsto: nunca fabricar horario ==')
t('08H AS 18H', C.previstoDaJornada('08H ÀS 18H'), { entradaMin: 480, saidaMin: 1080 })
t('acento agudo (a mina do catalogo)', C.previstoDaJornada('08H ÁS 20H'), { entradaMin: 480, saidaMin: 1200 })
t('minuscula com agudo', C.previstoDaJornada('09h ás 21h'), { entradaMin: 540, saidaMin: 1260 })
t('cruza meia-noite', C.previstoDaJornada('18H ÀS 06H'), { entradaMin: 1080, saidaMin: 1800 })
t('com minutos', C.previstoDaJornada('07H30 AS 16H30'), { entradaMin: 450, saidaMin: 990 })
t('nome vazio -> null (NAO 08:00-17:00)', C.previstoDaJornada(''), null)
t('nome sem horario -> null', C.previstoDaJornada('PLANTAO 12X36'), null)
t('undefined -> null', C.previstoDaJornada(undefined), null)

console.log('== atraso, saida antecipada e excedente ==')
let c = C.calcularDia(dia({ entrada: '08:30', saida: '18:00', jornada_nome: '08H ÀS 18H', saida_intervalo: '12:00', retorno_intervalo: '14:00' }))
t('atraso 30min sem excedente', [c.atrasoEntradaMinutos, c.excedenteSaidaMinutos, c.compensavelMinutos], [30, 0, 0])

c = C.calcularDia(dia({ entrada: '08:03', saida: '18:00', jornada_nome: '08H ÀS 18H', saida_intervalo: '12:00', retorno_intervalo: '14:00' }))
t('atraso de 3min fica no piso (nao acusa)', [c.atrasoEntradaMinutos, c.statusSugerido], [0, 'nenhum'])

c = C.calcularDia(dia({ entrada: '08:00', saida: '18:40', jornada_nome: '08H ÀS 18H', saida_intervalo: '12:00', retorno_intervalo: '14:00' }))
t('excedente sem atraso -> nao ha o que compensar', [c.excedenteSaidaMinutos, c.compensavelMinutos, c.statusSugerido], [40, 0, 'nenhum'])

c = C.calcularDia(dia({ entrada: '08:00', saida: '17:00', jornada_nome: '08H ÀS 18H', saida_intervalo: '12:00', retorno_intervalo: '14:00' }))
t('saida antecipada 60min', [c.saidaAntecipadaMinutos, c.excedenteSaidaMinutos], [60, 0])

console.log('== Art. 7 §1 e §2: os dois ritos exigem autorizacao ==')
c = C.calcularDia(dia({ entrada: '08:15', saida: '18:20', jornada_nome: '08H ÀS 18H', saida_intervalo: '12:00', retorno_intervalo: '14:00' }))
t('atraso 15min (<=20) reposto: compensavel 15, PENDENTE', [c.compensavelMinutos, c.statusSugerido], [15, 'pendente'])

c = C.calcularDia(dia({ entrada: '08:45', saida: '18:50', jornada_nome: '08H ÀS 18H', saida_intervalo: '12:00', retorno_intervalo: '14:00' }))
t('atraso 45min (>20) reposto: compensavel 45, PENDENTE', [c.compensavelMinutos, c.statusSugerido], [45, 'pendente'])

c = C.calcularDia(dia({ entrada: '08:20', saida: '18:50', jornada_nome: '08H ÀS 18H', saida_intervalo: '12:00', retorno_intervalo: '14:00' }))
t('excedente maior que o atraso: compensa so o atraso', [c.atrasoEntradaMinutos, c.excedenteSaidaMinutos, c.compensavelMinutos], [20, 50, 20])

console.log('== Art. 7 §3: teto de 2h ==')
c = C.calcularDia(dia({ entrada: '11:00', saida: '21:20', jornada_nome: '08H ÀS 18H', saida_intervalo: '13:00', retorno_intervalo: '14:00' }))
t('atraso 180 e excedente 200 -> teto 120', [c.atrasoEntradaMinutos, c.excedenteSaidaMinutos, c.compensavelMinutos], [180, 200, 120])

console.log('== Art. 7 §5: dia incompleto nao compensa ==')
c = C.calcularDia(dia({ entrada: '08:30', saida: '', jornada_nome: '08H ÀS 18H' }))
t('sem saida', [c.diaCompleto, c.compensavelMinutos], [false, 0])
c = C.calcularDia(dia({ entrada: '08:30', saida: '18:40', jornada_nome: '08H ÀS 18H' }))
t('jornada de 10h sem marcas de intervalo -> incompleto', [c.diaCompleto, c.compensavelMinutos], [false, 0])
c = C.calcularDia(dia({ entrada: '14:30', saida: '18:20', jornada_nome: '14H ÀS 18H' }))
t('jornada de 4h nao exige intervalo -> completo', [c.diaCompleto, c.compensavelMinutos], [true, 20])
c = C.calcularDia(dia({ entrada: '08:30', saida: '18:40', jornada_nome: '' }))
t('sem previsto: nao mede atraso nem compensa', [c.previsto, c.atrasoEntradaMinutos, c.compensavelMinutos], [null, 0, 0])

// ⚠️ A CONSEQUENCIA, nao so o parser: nome nao-parseavel NAO pode virar atraso fabricado.
// Sem isto, um default de 08:00-17:00 passaria despercebido para quem entra as 13:00.
c = C.calcularDia(dia({ entrada: '13:05', saida: '19:10', jornada_nome: 'PLANTAO 12X36', saida_intervalo: '15:00', retorno_intervalo: '16:00' }))
t('nome nao-parseavel NAO fabrica atraso', [c.atrasoEntradaMinutos, c.excedenteSaidaMinutos, c.compensavelMinutos], [0, 0, 0])
c = C.calcularDia(dia({ entrada: '13:05', saida: '19:10', jornada_nome: '13H ÀS 19H' }))
t('a mesma jornada, com nome legivel, mede certo', [c.atrasoEntradaMinutos, c.excedenteSaidaMinutos], [0, 10])

console.log('== jornada_nome vazio no snapshot usa o fallback da folha (878 dias em 09/2026) ==')
c = C.calcularDia(dia({ entrada: '08:30', saida: '18:20', saida_intervalo: '12:00', retorno_intervalo: '14:00' }), '08H ÀS 18H')
t('fallback resolve o previsto', [c.atrasoEntradaMinutos, c.compensavelMinutos], [30, 20])

console.log('== turno que cruza a meia-noite ==')
c = C.calcularDia(dia({ entrada: '18:11', saida: '06:20', jornada_nome: '18H ÀS 06H', saida_intervalo: '23:00', retorno_intervalo: '00:00' }))
t('atraso 11 e excedente 20 (sem virar 24h)', [c.atrasoEntradaMinutos, c.excedenteSaidaMinutos, c.compensavelMinutos], [11, 20, 11])

console.log('== noturno (22h-05h) ==')
c = C.calcularDia(dia({ entrada: '08:00', saida: '18:00', jornada_nome: '08H ÀS 18H', saida_intervalo: '12:00', retorno_intervalo: '14:00' }))
t('jornada diurna nao tem noturno', c.noturnoMinutos, 0)
c = C.calcularDia(dia({ entrada: '19:00', saida: '07:00', jornada_nome: '19H ÀS 07H' }))
t('19h->07h = 7h de noturno (22-05)', c.noturnoMinutos, 420)
c = C.calcularDia(dia({ entrada: '17:00', saida: '23:00', jornada_nome: '17H ÀS 23H' }))
t('17h->23h = 1h de noturno', c.noturnoMinutos, 60)

console.log('== a decisao: pendente NUNCA altera valor ==')
const reg = dia({ entrada: '08:30', saida: '18:20', jornada_nome: '08H ÀS 18H', saida_intervalo: '12:00', retorno_intervalo: '14:00', hora_extra_minutos: 20 })
const cal = C.calcularDia(reg)
t('pendente: extra intacta', C.extraEfetivaDoDia(reg, cal), 20)
t('pendente: atraso cheio', C.atrasoEfetivoDoDia(reg, cal), 30)
t('autorizada: abate o compensavel da extra', C.extraEfetivaDoDia(Object.assign({}, reg, { compensacao_status: 'autorizada' }), cal), 0)
t('autorizada: abate o compensavel do atraso', C.atrasoEfetivoDoDia(Object.assign({}, reg, { compensacao_status: 'autorizada' }), cal), 10)
t('extra confirmada: extra intacta', C.extraEfetivaDoDia(Object.assign({}, reg, { compensacao_status: 'extra_confirmada' }), cal), 20)
t('extra confirmada: atraso continua registrado', C.atrasoEfetivoDoDia(Object.assign({}, reg, { compensacao_status: 'extra_confirmada' }), cal), 30)

console.log('== totais do mes ==')
const isFalta = (o) => !!o && o.includes('FALTA') && !o.includes('AGUARDANDO')
const registros = [
  dia({ dia: 1, entrada: '08:00', saida: '18:00', saida_intervalo: '12:00', retorno_intervalo: '14:00' }),
  dia({ dia: 2, entrada: '08:30', saida: '18:20', saida_intervalo: '12:00', retorno_intervalo: '14:00', hora_extra_minutos: 20 }),
  dia({ dia: 3, entrada: '', saida: '', observacao: 'FALTA' }),
  dia({ dia: 4, turno_codigo: null, afastamento: 'ATESTADO MEDICO' }),
  dia({ dia: 6, entrada: '08:00', saida: '18:00', saida_intervalo: '12:00', retorno_intervalo: '14:00', afastamento: 'DECLARAÇÃO DE COMPARECIMENTO: 08:00 às 10:00', abono_minutos: 120 }),
  dia({ dia: 5, entrada: '08:00', saida: '18:40', saida_intervalo: '12:00', retorno_intervalo: '14:00', hora_extra_minutos: 40 }),
]
const tot = C.totaisFolha(registros, { horasNormaisPorDia: 10, jornadaNome: '08H ÀS 18H', ano: 2026, mes: 9, isFaltaDefinitiva: isFalta })
t('horas normais: 5 dias com turno x 10h', tot.normaisMinutos, 3000)
t('faltas', tot.faltas, 1)
t('abono = TEMPO abonado, nao dia de afastamento', tot.abonoMinutos, 120)
t('extra 50: 20 (pendente, intacta) + 40', tot.extra50Minutos, 60)
t('atraso do mes', tot.atrasoMinutos, 30)
t('dias pendentes de decisao', tot.pendentesCompensacao, [2])
t('minutos que a decisao pode abater', tot.compensavelPendenteMinutos, 20)

const totAut = C.totaisFolha(
  registros.map(r => (r.dia === 2 ? Object.assign({}, r, { compensacao_status: 'autorizada' }) : r)),
  { horasNormaisPorDia: 10, jornadaNome: '08H ÀS 18H', ano: 2026, mes: 9, isFaltaDefinitiva: isFalta }
)
t('autorizada: extra do mes cai 20', totAut.extra50Minutos, 40)
t('autorizada: atraso do mes cai 20', totAut.atrasoMinutos, 10)
t('autorizada: sai da fila de pendentes', totAut.pendentesCompensacao, [])

console.log('== abono NAO pode ser deduzido de "tem afastamento" ==')
// ⚠️ Medido em 08/2026: contar dia com afastamento daria 1.173 "abonos" — 304 Ferias,
// 206 Licenca Premio, 197 Licenca saude. Rotular aquilo de abono engana quem confere folha.
t('Ferias NAO viram abono',
  C.totaisFolha([dia({ dia: 1, turno_codigo: null, afastamento: 'Férias' })], { horasNormaisPorDia: 8, ano: 2026, mes: 9, isFaltaDefinitiva: isFalta }).abonoMinutos, 0)
t('folha antiga (sem o campo) mostra 0, nunca um numero inventado',
  C.totaisFolha([dia({ dia: 1, turno_codigo: null, afastamento: 'Licença Prêmio' })], { horasNormaisPorDia: 8, ano: 2026, mes: 9, isFaltaDefinitiva: isFalta }).abonoMinutos, 0)
t('so o tempo gravado como abonado conta',
  C.totaisFolha([dia({ dia: 1, turno_codigo: null, afastamento: 'DECL. COMPARECIMENTO', abono_minutos: 90 })], { horasNormaisPorDia: 8, ano: 2026, mes: 9, isFaltaDefinitiva: isFalta }).abonoMinutos, 90)

console.log('== corte de vigencia: a regra vale a partir de 09/2026 ==')
t('08/2026 esta fora', C.regraCompensacaoVigente(8, 2026), false)
t('09/2026 esta dentro', C.regraCompensacaoVigente(9, 2026), true)
t('10/2026 esta dentro', C.regraCompensacaoVigente(10, 2026), true)
t('06/2026 esta fora', C.regraCompensacaoVigente(6, 2026), false)
t('01/2027 esta dentro', C.regraCompensacaoVigente(1, 2027), true)
t('config move o corte para 10/2026', C.regraCompensacaoVigente(9, 2026, '2026-10'), false)
t('config malformada cai no padrao (nao abre para tras)', C.regraCompensacaoVigente(8, 2026, 'setembro'), false)
t('config vazia cai no padrao', C.regraCompensacaoVigente(9, 2026, ''), true)

// A CONSEQUENCIA, nao so o booleano: competencia anterior nao ganha indicador nem fila.
const regAntes = [
  dia({ dia: 2, entrada: '08:30', saida: '18:20', saida_intervalo: '12:00', retorno_intervalo: '14:00', hora_extra_minutos: 20 }),
  dia({ dia: 3, turno_codigo: null, afastamento: 'DECL. COMPARECIMENTO', abono_minutos: 90 }),
]
const optsBase = { horasNormaisPorDia: 10, jornadaNome: '08H ÀS 18H', isFaltaDefinitiva: isFalta }
const antes = C.totaisFolha(regAntes, Object.assign({ ano: 2026, mes: 8 }, optsBase))
const depois = C.totaisFolha(regAntes, Object.assign({ ano: 2026, mes: 9 }, optsBase))
t('08/2026: sem atraso no rodape', antes.atrasoMinutos, 0)
t('08/2026: sem noturno no rodape', antes.noturnoMinutos, 0)
t('08/2026: sem abono no rodape', antes.abonoMinutos, 0)
t('08/2026: NINGUEM entra na fila de decisao', antes.pendentesCompensacao, [])
t('08/2026: a hora extra e a de sempre', antes.extra50Minutos + antes.extra100Minutos, 20)
t('09/2026: os indicadores aparecem', [depois.atrasoMinutos, depois.abonoMinutos], [30, 90])
t('09/2026: o dia entra na fila', depois.pendentesCompensacao, [2])

// O mais importante: compensacao AUTORIZADA em competencia anterior nao abate nada.
const regAut = [Object.assign({}, regAntes[0], { compensacao_status: 'autorizada' })]
const autAntes = C.totaisFolha(regAut, Object.assign({ ano: 2026, mes: 8 }, optsBase))
t('08/2026: autorizacao antiga nao abate extra', autAntes.extra50Minutos + autAntes.extra100Minutos, 20)
const autDepois = C.totaisFolha(regAut, Object.assign({ ano: 2026, mes: 9 }, optsBase))
t('09/2026: autorizacao abate extra', autDepois.extra50Minutos + autDepois.extra100Minutos, 0)

// diasPendentesDeCompensacao tambem respeita o corte (o gate de fechamento chama ela).
t('fila de fechamento vazia em 08/2026', C.diasPendentesDeCompensacao(regAntes, '08H ÀS 18H', { mes: 8, ano: 2026 }), [])
t('fila de fechamento cheia em 09/2026', C.diasPendentesDeCompensacao(regAntes, '08H ÀS 18H', { mes: 9, ano: 2026 }), [2])

console.log(`\n${falhou === 0 ? 'TUDO OK' : 'HOUVE FALHA'} — ${ok} passaram, ${falhou} falharam`)
process.exit(falhou === 0 ? 0 : 1)
