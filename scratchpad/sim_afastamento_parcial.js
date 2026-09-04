/*
 * Portao do afastamento PARCIAL por slot (04/09/2026).
 *
 * Nao ha framework de teste no projeto — este arquivo e o portao, no mesmo molde de
 * sim_calculo_dia.js e sim_limite_carga.js.
 *
 * Transpile antes:
 *   npx tsc src/utils/afastamentoParcial.ts src/utils/afastamentos.ts \
 *     src/utils/folha/afastamentosDia.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *
 * Rode:  node scratchpad/sim_afastamento_parcial.js
 */
const P = require('./_sim/afastamentoParcial')
const A = require('./_sim/afastamentos')
const F = require('./_sim/folha/afastamentosDia')
const C = require('./_sim/folha/calculoDia')

let ok = 0
const falhas = []
function eq(nome, obtido, esperado) {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) ok++
  else falhas.push(`${nome}\n     esperado: ${b}\n     obtido:   ${a}`)
}

// ------------------------------------------------------------------ fabricas de evento
const SERV = 'srv-1'
const integral = (extra = {}) => ({ servidor_id: SERV, data_inicio: '2026-08-25', data_fim: '2026-08-25', slots: null, periodo_tipo: 'integral', hora_inicio: null, tipos_eventos: { nome: 'Ferias' }, ...extra })
const porSlot = (slots, extra = {}) => ({ servidor_id: SERV, data_inicio: '2026-08-25', data_fim: '2026-08-25', slots, periodo_tipo: 'slot', hora_inicio: null, tipos_eventos: { nome: 'DECLARACAO DE COMPARECIMENTO' }, ...extra })
const porHoras = (extra = {}) => ({ servidor_id: SERV, data_inicio: '2026-08-25', data_fim: '2026-08-25', slots: null, periodo_tipo: 'horas', hora_inicio: '08:00', hora_fim: '10:00', minutos_afastamento: 120, regime_abono: 'abonado', tipos_eventos: { nome: 'DECLARACAO DE COMPARECIMENTO' }, ...extra })
const alcance = (evs, turnoSlots) => P.alcanceNoTurno(P.resumoAfastamentoDia(evs), turnoSlots)

// =====================================================================================
// 1. alcanceNoTurno — a regra central: CONTENCAO, nao intersecao
// =====================================================================================
eq('1  integral anula turno MT', alcance([integral()], ['M', 'T']), 'anula')
eq('2  {M} sobre MT e PARCIAL (o caso LUANA)', alcance([porSlot(['M'])], ['M', 'T']), 'parcial')
eq('3  {T} sobre MT e PARCIAL', alcance([porSlot(['T'])], ['M', 'T']), 'parcial')
eq('4  {M} sobre turno M cobre e anula', alcance([porSlot(['M'])], ['M']), 'anula')
eq('5  {M,T} sobre MT cobre e anula', alcance([porSlot(['M', 'T'])], ['M', 'T']), 'anula')
eq('6  {M,T,N} sobre MT cobre e anula', alcance([porSlot(['M', 'T', 'N'])], ['M', 'T']), 'anula')
eq('7  {T} sobre turno M nao alcanca', alcance([porSlot(['T'])], ['M']), 'nao_alcanca')
eq('8  turno sem slots conhecidos: afastamento por slot nao alcanca', alcance([porSlot(['M'])], []), 'nao_alcanca')
eq('9  turno sem slots conhecidos: integral ainda anula', alcance([integral()], []), 'anula')
eq('10 sem afastamento nenhum', alcance([], ['M', 'T']), 'nao_alcanca')
eq('11 so afastamento por horas nunca alcanca', alcance([porHoras()], ['M', 'T']), 'nao_alcanca')
eq('12 {M} sobre MTN e parcial', alcance([porSlot(['M'])], ['M', 'T', 'N']), 'parcial')

// 🚨 O caso que PROTEGE as ferias lancadas com slot errado (medido em producao: LILIANE, 09/2026,
// Ferias com slots {M,T} sobre jornada 19H AS 07H). Intersecao vazia NAO e parcial — se fosse, a
// limpeza de escala pararia de apagar e a servidora ficaria escalada durante as proprias ferias.
eq('13 {M,T} sobre turno N: nao alcanca (protege as ferias mal lancadas)', alcance([porSlot(['M', 'T'])], ['N']), 'nao_alcanca')
eq('14 {N} sobre turno N cobre e anula', alcance([porSlot(['N'])], ['N']), 'anula')

// A UNIAO do dia: duas declaracoes parciais que juntas cobrem o turno (caso KETHURY, 14/08/2026).
eq('15 {M} + {T} no mesmo dia cobrem MT e ANULAM', alcance([porSlot(['M']), porSlot(['T'])], ['M', 'T']), 'anula')
eq('16 {M} + {M} no mesmo dia continuam parciais em MT', alcance([porSlot(['M']), porSlot(['M'])], ['M', 'T']), 'parcial')
eq('17 parcial + integral no mesmo dia: anula', alcance([porSlot(['M']), integral()], ['M', 'T']), 'anula')
eq('18 parcial + por horas no mesmo dia: segue parcial', alcance([porSlot(['M']), porHoras()], ['M', 'T']), 'parcial')

// resumoAfastamentoDia
eq('19 resumo une e ordena os slots', P.resumoAfastamentoDia([porSlot(['T']), porSlot(['M'])]).slots, ['M', 'T'])
eq('20 resumo marca integral', P.resumoAfastamentoDia([integral()]).integral, true)
eq('21 resumo ignora o por horas', P.resumoAfastamentoDia([porHoras()]).temAfastamento, false)
eq('22 slotsTrabalhados de {M} num MT', P.slotsTrabalhados(['M', 'T'], P.resumoAfastamentoDia([porSlot(['M'])])), ['T'])
eq('23 slotsTrabalhados com integral e vazio', P.slotsTrabalhados(['M', 'T'], P.resumoAfastamentoDia([integral()])), [])

// =====================================================================================
// 2. encontrarAfastamentosBloqueantes — o que a grade e o trigger recusam
// =====================================================================================
const bloq = (evs, turnoSlots, categoria = 'Regular', permitirPlantaoExtra = false) =>
  A.encontrarAfastamentosBloqueantes({ eventos: evs, servidorId: SERV, dataISO: '2026-08-25', categoria, turnoSlots, permitirPlantaoExtra })

eq('24 {M} num MT NAO bloqueia mais (era o bug)', bloq([porSlot(['M'])], ['M', 'T']).length, 0)
eq('25 integral num MT bloqueia', bloq([integral()], ['M', 'T']).length, 1)
eq('26 {M} num turno M bloqueia', bloq([porSlot(['M'])], ['M']).length, 1)
eq('27 {M}+{T} num MT bloqueiam e os DOIS sao exibidos', bloq([porSlot(['M']), porSlot(['T'])], ['M', 'T']).length, 2)
eq('28 por horas nunca bloqueia', bloq([porHoras()], ['M', 'T']).length, 0)
eq('29 evento de outro servidor nao alcanca', bloq([porSlot(['M', 'T'], { servidor_id: 'outro' })], ['M', 'T']).length, 0)
eq('30 evento fora da data nao alcanca', bloq([porSlot(['M', 'T'], { data_inicio: '2026-08-01', data_fim: '2026-08-02' })], ['M', 'T']).length, 0)
eq('31 celula vazia (turnoSlots []) so e bloqueada por integral', bloq([porSlot(['M'])], []).length, 0)
eq('32 celula vazia com integral bloqueia', bloq([integral()], []).length, 1)
eq('33 Plantao liberado pela config nao bloqueia', bloq([integral()], ['M', 'T'], 'Plantão', true).length, 0)
eq('34 Sobreaviso NUNCA e liberado pela config', bloq([integral()], ['M', 'T'], 'Sobreaviso', true).length, 1)
eq('35 Regular NUNCA e liberado pela config', bloq([integral()], ['M', 'T'], 'Regular', true).length, 1)
eq('36 {M,T} sobre turno N nao bloqueia (ja era assim)', bloq([porSlot(['M', 'T'])], ['N']).length, 0)

// =====================================================================================
// 3. minutosPrevistosNosSlots — o ABONO do meio periodo
// =====================================================================================
const jornada = (nome) => C.previstoDaJornada(nome)
eq('37 {M} numa jornada 08H AS 18H = 4h', P.minutosPrevistosNosSlots(['M'], jornada('08H ÀS 18H')), 240)
eq('38 {T} numa jornada 08H AS 18H = 6h', P.minutosPrevistosNosSlots(['T'], jornada('08H ÀS 18H')), 360)
eq('39 {M} numa jornada 07H AS 13H = 5h', P.minutosPrevistosNosSlots(['M'], jornada('07H ÀS 13H')), 300)
eq('40 {M} numa jornada 12H AS 18H = 0 (nao ha manha)', P.minutosPrevistosNosSlots(['M'], jornada('12H ÀS 18H')), 0)
eq('41 {N} numa jornada 19H AS 07H pega so a faixa da noite', P.minutosPrevistosNosSlots(['N'], jornada('19H ÀS 07H')), 300)
eq('42 sem previsto devolve 0, nunca um palpite', P.minutosPrevistosNosSlots(['M'], null), 0)
eq('43 sem slots devolve 0', P.minutosPrevistosNosSlots([], jornada('08H ÀS 18H')), 0)
eq('44 jornada que nao parseia nao vira 08:00-17:00', jornada('ESCALA ESPECIAL'), null)

// =====================================================================================
// 4. avaliarAfastamentosNoTurno — o veredito que as 4 copias da folha usam
// =====================================================================================
const turnoMT = { dicionario_turnos: { codigo: 'MT', slots: ['M', 'T'] } }
const turnoM = { dicionario_turnos: { codigo: 'M', slots: ['M'] } }

const vParcial = F.avaliarAfastamentosNoTurno([porSlot(['M'])], turnoMT, '08H ÀS 18H')
eq('45 parcial: nao anula o dia', vParcial.anulantes.length, 0)
eq('46 parcial: registra os slots perdidos', vParcial.slotsParciais, ['M'])
eq('47 parcial: abona os 240 min da manha', vParcial.abonoParcialMinutos, 240)

const vAnula = F.avaliarAfastamentosNoTurno([porSlot(['M'])], turnoM, '07H ÀS 13H')
eq('48 anula: devolve o anulante', vAnula.anulantes.length, 1)
eq('49 anula: nao marca slots parciais', vAnula.slotsParciais, [])
eq('50 anula: nao abona nada (o dia inteiro e afastamento)', vAnula.abonoParcialMinutos, 0)

const vNada = F.avaliarAfastamentosNoTurno([porSlot(['T'])], turnoM, '07H ÀS 13H')
eq('51 nao alcanca: nada em lugar nenhum', [vNada.anulantes.length, vNada.slotsParciais, vNada.abonoParcialMinutos], [0, [], 0])

// Dia SEM escala e afastamento integral: a folha precisa dizer "FERIAS", nao "FOLGA".
const vSemTurno = F.avaliarAfastamentosNoTurno([integral()], undefined, '08H ÀS 18H')
eq('52 integral sem turno na escala continua anulando', vSemTurno.anulantes.length, 1)
const vSlotSemTurno = F.avaliarAfastamentosNoTurno([porSlot(['M'])], undefined, '08H ÀS 18H')
eq('53 slot sem turno na escala nao anula (era assim antes)', vSlotSemTurno.anulantes.length, 0)

// =====================================================================================
// 5. calcularDia — o dia parcial nao pode acusar atraso, mas MANTEM a hora extra
// =====================================================================================
const diaBase = {
  jornada_nome: '08H ÀS 18H',
  entrada: '13:10', saida_intervalo: '', retorno_intervalo: '', saida: '18:00',
}
const semParcial = C.calcularDia({ ...diaBase })
eq('54 dia NORMAL com entrada 13:10 acusa 310 min de atraso', semParcial.atrasoEntradaMinutos, 310)

const comParcial = C.calcularDia({ ...diaBase, afastamento_slots: ['M'] })
eq('55 dia PARCIAL nao acusa atraso nenhum', comParcial.atrasoEntradaMinutos, 0)
eq('56 dia PARCIAL nao propoe compensacao', comParcial.compensavelMinutos, 0)
eq('57 dia PARCIAL segue com previsto (a extra depende dele)', comParcial.previsto, { entradaMin: 480, saidaMin: 1080 })

// A hora extra sobrevive: quem foi liberada de manha e saiu 18:30 fez 30 min depois do previsto.
const extraNoParcial = C.calcularDia({ ...diaBase, saida: '18:30', afastamento_slots: ['M'] })
eq('58 dia PARCIAL ainda mede o excedente da saida', extraNoParcial.excedenteSaidaMinutos, 30)

// Afastamento da TARDE: sair as 12:00 nao e saida antecipada.
const tardeAfastada = C.calcularDia({ jornada_nome: '08H ÀS 18H', entrada: '08:03', saida: '12:00', afastamento_slots: ['T'] })
eq('59 dia PARCIAL de tarde nao acusa saida antecipada', tardeAfastada.saidaAntecipadaMinutos, 0)
const tardeSemParcial = C.calcularDia({ jornada_nome: '08H ÀS 18H', entrada: '08:03', saida: '12:00' })
eq('60 dia NORMAL saindo 12:00 acusa 360 min de saida antecipada', tardeSemParcial.saidaAntecipadaMinutos, 360)

// Nao regrediu o caso comum.
const atrasoNormal = C.calcularDia({ jornada_nome: '08H ÀS 18H', entrada: '08:30', saida_intervalo: '12:00', retorno_intervalo: '14:00', saida: '18:30' })
eq('61 dia normal: atraso 30 e compensavel 30', [atrasoNormal.atrasoEntradaMinutos, atrasoNormal.compensavelMinutos], [30, 30])
eq('62 lista vazia de afastamento_slots nao muda nada', C.calcularDia({ ...diaBase, afastamento_slots: [] }).atrasoEntradaMinutos, 310)

// =====================================================================================
console.log(`\n${ok} casos ok, ${falhas.length} falha(s)`)
if (falhas.length) {
  console.error('\nFALHAS:\n  - ' + falhas.join('\n  - '))
  process.exit(1)
}
