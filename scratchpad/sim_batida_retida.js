// PORTAO de src/utils/reconciliacaoPendente.ts apos a batida retida (17/09/2026).
// Transpile antes:
//   npx tsc src/utils/reconciliacaoPendente.ts --outDir scratchpad/_sim --module commonjs --target es2020
// Rode:  node scratchpad/sim_batida_retida.js
const R = require('./_sim/reconciliacaoPendente.js')

let ok = 0, falhas = []
function eq(rotulo, achado, esperado) {
  const a = JSON.stringify(achado), e = JSON.stringify(esperado)
  if (a === e) { ok++; return }
  falhas.push(`${rotulo}\n     esperado: ${e}\n     achado:   ${a}`)
}
function verdade(rotulo, cond) { eq(rotulo, !!cond, true) }

// ---------------------------------------------------------------------------
// Fabrica de linhas cruas, no formato exato de fn_reconciliacao_pendente_escala.
// ---------------------------------------------------------------------------
function linha(over = {}) {
  return {
    escala_mensal_id: 'EM1', servidor_id: 'S1', servidor_nome: 'FULANO',
    dia: 3, data: '2026-09-03', escala_diaria_id: 'ED1',
    categoria: 'Regular', turno_codigo: 'MT',
    campo: 'entrada', valor_atual: null, valor_projetado: '2026-09-03T10:08:00+00:00',
    origem_projetada: 'rep', tipo: 'ganho', dia_elegivel: true, impedimento: null,
    batidas_retidas: 0,
    ...over,
  }
}
/** A linha de DIAGNOSTICO que a RPC emite para o dia sem divergencia e com batida retida. */
function diag(over = {}) {
  return linha({
    escala_diaria_id: null, categoria: null, turno_codigo: null,
    campo: 'batida_retida', valor_atual: null, valor_projetado: null, origem_projetada: null,
    tipo: 'batida_retida', dia_elegivel: false, impedimento: 'batida_retida',
    batidas_retidas: 4,
    ...over,
  })
}

// ===========================================================================
// 1. O caso que motivou: dia SEM divergencia e COM batida retida
//    (THAYNA, 03/09/2026 -- 4 batidas do Regular MT desconsideradas em 17/09)
// ===========================================================================
{
  const dias = R.agruparPorDia([diag()])
  eq('1.1 o dia APARECE na previa', dias.length, 1)
  eq('1.2 conta as batidas retidas', dias[0].batidasRetidas, 4)
  eq('1.3 nao vira ganho', dias[0].ganhos.length, 0)
  eq('1.4 NAO vira conflito de campo (rotulo vazio na tela)', dias[0].conflitos.length, 0)
  eq('1.5 nao e elegivel', dias[0].elegivel, false)

  const r = R.resumirPrevia(dias)
  eq('1.6 resumo conta o dia', r.diasComBatidaRetida, 1)
  eq('1.7 resumo soma as batidas', r.batidasRetidas, 4)
  eq('1.8 NAO conta como dia bloqueado por competencia', r.diasBloqueados, 0)
  eq('1.9 NAO conta como dia com conflito', r.diasComConflito, 0)
  eq('1.10 nao oferece nada para preencher', r.horarios, 0)

  eq('1.11 entra na lista de restauracao', R.diasParaRestaurar(dias),
     [{ servidorId: 'S1', data: '2026-09-03' }])
  eq('1.12 NAO entra na lista de preenchimento', R.diasParaAplicar(dias), [])
}

// ===========================================================================
// 2. Dia com ganho REAL e batida retida ao lado
//    🚨 A batida retida NAO pode tornar o dia inelegivel: o que a projecao conseguiu
//    resolver com as batidas que sobraram continua sendo ganho legitimo.
// ===========================================================================
{
  const dias = R.agruparPorDia([
    linha({ campo: 'entrada', tipo: 'ganho', batidas_retidas: 2 }),
    linha({ campo: 'saida', tipo: 'ganho', batidas_retidas: 2 }),
  ])
  eq('2.1 um dia', dias.length, 1)
  eq('2.2 continua ELEGIVEL', dias[0].elegivel, true)
  eq('2.3 dois ganhos', dias[0].ganhos.length, 2)
  eq('2.4 sabe das retidas', dias[0].batidasRetidas, 2)
  eq('2.5 entra nas duas listas', [R.diasParaAplicar(dias).length, R.diasParaRestaurar(dias).length], [1, 1])

  const r = R.resumirPrevia(dias)
  eq('2.6 conta os horarios', r.horarios, 2)
  eq('2.7 conta o aviso', r.diasComBatidaRetida, 1)
  // A contagem NAO e a soma das linhas: a RPC repete a mesma contagem em cada linha do dia.
  eq('2.8 nao SOMA a contagem repetida das linhas', r.batidasRetidas, 2)
}

// ===========================================================================
// 3. Dia com CONFLITO e batida retida (o estado real da THAYNA hoje)
// ===========================================================================
{
  const dias = R.agruparPorDia([
    linha({ campo: 'entrada', tipo: 'troca', valor_atual: '2026-09-03T22:05:00+00:00',
            valor_projetado: '2026-09-04T01:01:00+00:00', dia_elegivel: false, batidas_retidas: 4 }),
    linha({ campo: 'intervalo_saida', tipo: 'perda', valor_atual: '2026-09-04T01:01:00+00:00',
            valor_projetado: null, dia_elegivel: false, batidas_retidas: 4 }),
  ])
  eq('3.1 inelegivel', dias[0].elegivel, false)
  eq('3.2 dois conflitos', dias[0].conflitos.length, 2)
  eq('3.3 sabe das retidas', dias[0].batidasRetidas, 4)
  const r = R.resumirPrevia(dias)
  eq('3.4 conta como conflito', r.diasComConflito, 1)
  eq('3.5 E como batida retida', r.diasComBatidaRetida, 1)
  eq('3.6 oferece restaurar', R.diasParaRestaurar(dias).length, 1)
}

// ===========================================================================
// 4. COMPATIBILIDADE: RPC anterior a 20260917140000 nao manda a coluna
//    ⚠️ `undefined` tratado como "ha batida retida" acusaria o parque inteiro.
// ===========================================================================
{
  const semCampo = linha(); delete semCampo.batidas_retidas
  const dias = R.agruparPorDia([semCampo])
  eq('4.1 campo ausente vira 0', dias[0].batidasRetidas, 0)
  eq('4.2 nao entra na restauracao', R.diasParaRestaurar(dias), [])
  eq('4.3 continua elegivel', dias[0].elegivel, true)

  const nulo = R.agruparPorDia([linha({ batidas_retidas: null })])
  eq('4.4 null vira 0', nulo[0].batidasRetidas, 0)

  const lixo = R.agruparPorDia([linha({ batidas_retidas: 'abc' })])
  eq('4.5 valor nao numerico vira 0 (nunca NaN na tela)', lixo[0].batidasRetidas, 0)
}

// ===========================================================================
// 5. Impedimento de verdade continua distinguivel do diagnostico
// ===========================================================================
{
  const dias = R.agruparPorDia([
    linha({ tipo: 'ganho', dia_elegivel: false, impedimento: 'escala_fechada' }),
  ])
  eq('5.1 bloqueado por escala fechada', R.resumirPrevia(dias).diasBloqueados, 1)
  eq('5.2 rotulo do impedimento real', R.rotuloImpedimento('escala_fechada'),
     'Escala Fechada — reabra a escala antes')
  verdade('5.3 batida_retida tem rotulo proprio',
     (R.rotuloImpedimento('batida_retida') || '').includes('fora de circulação'))
  eq('5.4 impedimento nulo nao tem rotulo', R.rotuloImpedimento(null), null)
}

// ===========================================================================
// 6. A frase do aviso: diz O QUE FAZER, nao so o que aconteceu (armadilha 44)
// ===========================================================================
{
  eq('6.1 zero nao gera frase', R.fraseBatidaRetida(0), '')
  eq('6.2 negativo nao gera frase', R.fraseBatidaRetida(-3), '')
  const u = R.fraseBatidaRetida(1), m = R.fraseBatidaRetida(4)
  verdade('6.3 singular concorda', u.includes('1 batida real foi tirada'))
  verdade('6.4 plural concorda', m.includes('4 batidas reais foram tiradas'))
  verdade('6.5 diz que a batida NAO se perdeu', u.includes('continua gravada'))
  verdade('6.6 diz o que fazer', u.includes('Restaurar Batidas') && m.includes('Restaurar Batidas'))
  verdade('6.7 nomeia a causa', u.includes('reversão'))
}

// ===========================================================================
// 7. O relato do resultado conhece o status novo
// ===========================================================================
{
  const rel = R.descreverResultado([
    { servidorId: 'S1', servidorNome: 'FULANO', data: '2026-09-03', status: 'batida_retida', campos: 0 },
    { servidorId: 'S2', servidorNome: 'BELTRANO', data: '2026-09-04', status: 'ok', campos: 2 },
  ])
  eq('7.1 conta so o que mudou', rel.horarios, 2)
  eq('7.2 o dia retido fica de fora', rel.recusados.length, 1)
  verdade('7.3 com motivo escrito, nunca em branco',
     rel.recusados[0].motivo.length > 10 && rel.recusados[0].motivo.includes('restaure'))
  verdade('7.4 status desconhecido nao vira sucesso',
     R.descreverResultado([{ servidorId: 'S1', servidorNome: 'X', data: '2026-09-03', status: 'sei_la', campos: 9 }]).horarios === 0)
}

// ===========================================================================
// 8. Regressoes que ja aconteceram neste modulo
// ===========================================================================
{
  // Dia com status 'ok' e campos 0 nao conta como sucesso (Gerador Inteligente, 25/08/2026).
  const rel = R.descreverResultado([{ servidorId: 'S1', servidorNome: 'X', data: '2026-09-03', status: 'ok', campos: 0 }])
  eq('8.1 ok com 0 campos nao e sucesso', rel.horarios, 0)
  eq('8.2 e aparece como recusado', rel.recusados.length, 1)

  // Tipo desconhecido vira conflito, nunca ganho (a duvida fecha).
  const dias = R.agruparPorDia([linha({ tipo: 'coisa_nova' })])
  eq('8.3 tipo desconhecido nao vira ganho', dias[0].ganhos.length, 0)
  eq('8.4 vira conflito', dias[0].conflitos.length, 1)
  eq('8.5 e torna o dia inelegivel', dias[0].elegivel, false)

  // Data pura nunca vira new Date (armadilha 12).
  eq('8.6 dia extraido da data pura', R.diaDaData('2026-09-07'), 7)
  eq('8.7 data invalida nao quebra', R.diaDaData('xx'), 0)
}

// ===========================================================================
console.log(`\n${ok} asserções passaram, ${falhas.length} falharam.`)
if (falhas.length) {
  console.log('\nFALHAS:')
  for (const f of falhas) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('PORTAO OK')
