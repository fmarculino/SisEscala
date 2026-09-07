// Portao da autorizacao previa de hora extra (Art. 8 da Portaria 382/2019-GAB-MAB/SMS).
//
// O QUE ESTA ENTREGA RESOLVE: 473h de hora extra em 08/2026 nasceram sem ninguem autorizar nada.
// A folha media a saida, achava excedente e virava verba por inercia.
//
// 🚨 A ASERCAO MAIS IMPORTANTE DESTE ARQUIVO E A DO GRUPO 1: `pendente` NAO PODE MUDAR VALOR
// NENHUM. Se ela cair, a entrega deixou de ser um gate e virou um corte automatico de verba numa
// folha que o servidor assina — o defeito seria muito pior que o problema.
//
// Transpile antes:
//   npx tsc src/utils/folha/calculoDia.ts src/utils/folha/cargaDiaria.ts src/utils/folha/reabertura.ts \
//     --outDir scratchpad/_sim --module commonjs --target es2020 --skipLibCheck
// Rodar:  node scratchpad/sim_autorizacao_extra.js
'use strict'
const fs = require('fs')
const path = require('path')
const C = require('./_sim/calculoDia.js')

const RAIZ = path.resolve(__dirname, '..')
let total = 0, falhas = 0
function ok(nome, achado, esperado) {
  total++
  const a = JSON.stringify(achado), e = JSON.stringify(esperado)
  if (a === e) console.log(`  ok   ${nome}`)
  else { falhas++; console.log(`  FALHA ${nome}\n        esperado: ${e}\n        achado:   ${a}`) }
}

const OPC = {
  horasNormaisPorDia: 8,
  jornadaNome: '08H AS 18H',
  mes: 9,
  ano: 2026,
  isFaltaDefinitiva: () => false,
}

/** Dia simples com hora extra apurada e sem atraso — o caso puro do Art. 8. */
function diaComExtra(extraMin, extras) {
  return Object.assign({
    dia: 10,
    turno_codigo: 'R',
    jornada_nome: '08H AS 18H',
    entrada: '08:00',
    saida_intervalo: '12:00',
    retorno_intervalo: '14:00',
    saida: '18:00',
    hora_extra_minutos: extraMin,
  }, extras || {})
}

// ===========================================================================
// 1. O DEFAULT NAO MEXE EM VERBA
// ===========================================================================
console.log('\n1. pendente nao muda valor nenhum')
const semDecisao = diaComExtra(60)
ok('sem decisao, o dia esta pendente', C.statusAutorizacaoExtraDoDia(semDecisao, 60), 'pendente')
ok('e a hora extra sai inalterada', C.extraAposAutorizacao(semDecisao, 60), 60)

const tA = C.totaisFolha([diaComExtra(60)], OPC)
const tB = C.totaisFolha([diaComExtra(60, { extra_autorizacao_status: 'pendente' })], OPC)
ok('o total do mes e o mesmo com e sem o campo gravado',
  [tA.extra50Minutos, tA.extra100Minutos], [tB.extra50Minutos, tB.extra100Minutos])
ok('e ele vale exatamente a hora extra bruta', tA.extra50Minutos, 60)
ok('o dia entra na fila de decisao', tA.pendentesAutorizacaoExtra, [10])
ok('e o valor pendente e reportado a parte', tA.extraPendenteAutorizacaoMinutos, 60)

// ===========================================================================
// 2. SO A DECISAO EXPLICITA MUDA NUMERO
// ===========================================================================
console.log('\n2. a decisao da chefia')
const autorizado = diaComExtra(60, { extra_autorizacao_status: 'autorizada' })
ok('autorizada mantem a hora extra', C.extraAposAutorizacao(autorizado, 60), 60)
ok('e sai da fila', C.totaisFolha([autorizado], OPC).pendentesAutorizacaoExtra, [])

const recusado = diaComExtra(60, { extra_autorizacao_status: 'nao_autorizada' })
ok('nao autorizada zera a verba', C.extraAposAutorizacao(recusado, 60), 0)
const tR = C.totaisFolha([recusado], OPC)
ok('o total do mes perde os 60 min', tR.extra50Minutos, 0)
ok('mas o valor recusado continua VISIVEL, nao some', tR.extraNaoAutorizadaMinutos, 60)
ok('e nao fica na fila de pendentes', tR.pendentesAutorizacaoExtra, [])

// 🚨 A recusa nao pode apagar o REGISTRO — so a verba. O horario batido continua na folha.
console.log('\n2b. a recusa nao apaga o registro do dia')
ok('a entrada continua la', recusado.entrada, '08:00')
ok('a saida continua la', recusado.saida, '18:00')
ok('e hora_extra_minutos, que e o fato medido, tambem', recusado.hora_extra_minutos, 60)

// ===========================================================================
// 3. A ORDEM: COMPENSA (Art. 7) E DEPOIS AUTORIZA (Art. 8)
// ===========================================================================
// Dia real: entrou 30 min atrasado e saiu 45 min depois. 30 min repoem o atraso; 15 sobram.
console.log('\n3. Art. 8 sobre Art. 7, nesta ordem')
function diaAtrasoEExtra(extras) {
  return Object.assign({
    dia: 12,
    turno_codigo: 'R',
    jornada_nome: '08H AS 18H',
    entrada: '08:30',
    saida_intervalo: '12:00',
    retorno_intervalo: '14:00',
    saida: '18:45',
    hora_extra_minutos: 45,
  }, extras || {})
}
const comp = diaAtrasoEExtra({ compensacao_status: 'autorizada' })
const calc = C.calcularDia(comp, OPC.jornadaNome)
ok('a compensacao proposta e de 30 min', calc.compensavelMinutos, 30)
const liquida = C.extraEfetivaDoDia(comp, calc)
ok('sobram 15 min depois da compensacao', liquida, 15)
ok('e sao esses 15 que precisam de autorizacao',
  C.statusAutorizacaoExtraDoDia(comp, liquida), 'pendente')

// ⚠️ Se a autorizacao viesse ANTES da compensacao, a chefia decidiria sobre 45 min — 30 dos
// quais nem sao hora extra, e sim reposicao que o Art. 7 ja resolve. Perguntar duas vezes sobre
// o mesmo minuto ensina quem decide a clicar sem ler.
const compERecusa = diaAtrasoEExtra({ compensacao_status: 'autorizada', extra_autorizacao_status: 'nao_autorizada' })
const tC = C.totaisFolha([compERecusa], OPC)
ok('com compensacao autorizada E extra recusada, o mes fica sem extra', tC.extra50Minutos, 0)
ok('e o recusado e so o que sobrou (15), nunca os 45', tC.extraNaoAutorizadaMinutos, 15)

// Dia inteiramente compensado nao tem o que autorizar.
console.log('\n3b. dia inteiramente compensado nao vira pergunta')
const tudoComp = Object.assign(diaAtrasoEExtra({ compensacao_status: 'autorizada' }), {
  entrada: '08:45', saida: '18:45', hora_extra_minutos: 45,
})
const calcTudo = C.calcularDia(tudoComp, OPC.jornadaNome)
ok('nao sobra excedente', C.extraEfetivaDoDia(tudoComp, calcTudo), 0)
ok('e o estado e `nenhum`, nao `pendente`',
  C.statusAutorizacaoExtraDoDia(tudoComp, C.extraEfetivaDoDia(tudoComp, calcTudo)), 'nenhum')

// ⚠️ Esta asercao passa pelo TOTALIZADOR de proposito, e nao pela funcao direta. A que existia
// antes chamava statusAutorizacaoExtraDoDia ja com o liquido em maos — entao um totaisFolha que
// passasse a BRUTA (ignorando a compensacao) passava despercebido. O validador pegou isso.
const tTudo = C.totaisFolha([tudoComp], OPC)
ok('e o totalizador NAO o poe na fila', tTudo.pendentesAutorizacaoExtra, [])
ok('nem contabiliza valor pendente', tTudo.extraPendenteAutorizacaoMinutos, 0)

// ===========================================================================
// 4. VIGENCIA — competencia anterior nao muda, e nao entra na fila
// ===========================================================================
console.log('\n4. vigencia por competencia')
ok('09/2026 esta dentro', C.regraAutorizacaoExtraVigente(9, 2026, null), true)
ok('08/2026 esta fora (as 473h ficam como estao)', C.regraAutorizacaoExtraVigente(8, 2026, null), false)
ok('config malformada cai no padrao, nunca abre para tras',
  C.regraAutorizacaoExtraVigente(8, 2026, 'lixo'), false)
ok('e a chave pode ADIAR', C.regraAutorizacaoExtraVigente(9, 2026, '2026-10'), false)

const tAgosto = C.totaisFolha([diaComExtra(60, { extra_autorizacao_status: 'nao_autorizada' })],
  Object.assign({}, OPC, { mes: 8 }))
ok('em 08/2026 nem a recusa gravada muda o total', tAgosto.extra50Minutos, 60)
ok('e ninguem entra na fila', tAgosto.pendentesAutorizacaoExtra, [])

// A chave e PROPRIA: mover a da compensacao nao pode mover esta.
console.log('\n4b. a chave e separada da compensacao')
const soComp = C.totaisFolha([diaComExtra(60)], Object.assign({}, OPC, { compensacaoVigenteDesde: '2027-01' }))
ok('compensacao adiada nao tira a hora extra da fila do Art. 8', soComp.pendentesAutorizacaoExtra, [10])

// ===========================================================================
// 5. A FILA QUE O FECHAMENTO COBRA
// ===========================================================================
console.log('\n5. diasPendentesDeAutorizacaoExtra')
const mes = [diaComExtra(60), Object.assign(diaComExtra(30), { dia: 11 }),
             Object.assign(diaComExtra(20), { dia: 13, extra_autorizacao_status: 'autorizada' })]
ok('lista so quem nao foi decidido',
  C.diasPendentesDeAutorizacaoExtra(mes, OPC.jornadaNome, { mes: 9, ano: 2026 }), [10, 11])
ok('competencia anterior devolve vazio',
  C.diasPendentesDeAutorizacaoExtra(mes, OPC.jornadaNome, { mes: 8, ano: 2026 }), [])

// ===========================================================================
// 6. A DECISAO SOBREVIVE A "SINCRONIZAR"
// ===========================================================================
// Sem isto, regerar a folha APAGA a decisao da chefia — o mesmo defeito que
// carregarDecisaoCompensacao existe para evitar.
console.log('\n6. carregarDecisaoAutorizacaoExtra')
let novo = { dia: 10 }
C.carregarDecisaoAutorizacaoExtra(novo, {
  extra_autorizacao_status: 'nao_autorizada',
  extra_autorizado_por_nome: 'FULANO',
  extra_autorizacao_justificativa: 'sem previa',
})
ok('a decisao e preservada', novo.extra_autorizacao_status, 'nao_autorizada')
ok('e quem decidiu tambem', novo.extra_autorizado_por_nome, 'FULANO')

let novo2 = { dia: 10 }
C.carregarDecisaoAutorizacaoExtra(novo2, { extra_autorizacao_status: 'pendente' })
ok('pendente NAO e preservado (nao ha decisao a guardar)', novo2.extra_autorizacao_status, undefined)

// ===========================================================================
// 7. COBERTURA NO CODIGO — as quatro copias da geracao
// ===========================================================================
// Esquecer UMA faz "Sincronizar" apagar a decisao por aquele caminho, em silencio.
console.log('\n7. as quatro copias da geracao preservam a decisao')
for (const rel of ['src/app/(dashboard)/folha-ponto/actions.ts', 'src/app/consultar-escala/actions.ts']) {
  const txt = fs.readFileSync(path.join(RAIZ, rel), 'utf8')
  const comp = txt.split('carregarDecisaoCompensacao(registro, registroExistente)').length - 1
  const extra = txt.split('carregarDecisaoAutorizacaoExtra(registro, registroExistente)').length - 1
  ok(`${path.basename(path.dirname(rel))}: duas copias, e as duas preservam`, [comp, extra], [2, 2])
}

// O gate do fechamento tem que existir no SERVIDOR, nao so na tela.
const act = fs.readFileSync(path.join(RAIZ, 'src/app/(dashboard)/folha-ponto/actions.ts'), 'utf8')
ok('o fechamento cobra a decisao no servidor', act.includes('requerDecisaoAutorizacaoExtra: true'), true)
ok('a action reconfere a vigencia (POST chamavel direto)',
  act.includes('if (!regraAutorizacaoExtraVigente(folha.mes, folha.ano'), true)
ok('a action reconfere a elegibilidade, nunca aceita do cliente',
  act.includes("if (decisao !== 'pendente' && extraLiquida <= 0)"), true)
ok('e o Portal nao decide (papeis de chefia apenas)',
  /PAPEIS_QUE_DECIDEM[\s\S]{0,400}Apenas coordenação e RH podem autorizar hora extra/.test(act), true)

console.log(`\n${total - falhas}/${total} asercoes passaram.`)
if (falhas > 0) { console.log(`\n${falhas} FALHA(S).`); process.exit(1) }
