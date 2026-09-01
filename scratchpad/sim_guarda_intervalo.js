/*
 * scratchpad/sim_guarda_intervalo.js
 *
 * Simula os cenários de batidas repetidas na entrada e guarda de intervalo mínimo.
 */

function simularTerminal({ entradas, intervaloFlexivel, agoraMin, agoraEpochMin, inicioMin, fimMin, intIniMin, intFimMin, janelaMin = 30 }) {
  const b_inicio = inicioMin
  const b_fim = fimMin
  const b_int_ini = intIniMin
  const b_int_fim = intFimMin
  const b_entradas = entradas
  const momento_atual_minutos = agoraMin

  let matched_action = null

  // Step 1: Checkin
  if (b_entradas[0] == null) {
    if (momento_atual_minutos >= (b_inicio - janelaMin) && momento_atual_minutos <= (b_inicio + janelaMin)) {
      return { success: true, action: 'checkin', message: 'Entrada confirmada' }
    }
  }

  // Step 2: Interval Exit
  if (b_int_ini != null) {
    if (intervaloFlexivel) {
      const decorridoMin = agoraEpochMin - b_entradas[0]
      if (b_entradas[0] != null && decorridoMin >= 60 && momento_atual_minutos >= (b_inicio + 60) && momento_atual_minutos < (b_fim - janelaMin)) {
        return { success: true, action: 'intervalo_saida', message: 'Saída intervalo confirmada' }
      }
    } else {
      if (momento_atual_minutos >= (b_int_ini - janelaMin) && momento_atual_minutos <= (b_int_ini + janelaMin)) {
        return { success: true, action: 'intervalo_saida', message: 'Saída intervalo confirmada' }
      }
    }
  }

  // Fallback / Batida repetida na entrada
  if (b_entradas[0] != null && (agoraEpochMin - b_entradas[0]) < 60) {
    return { success: true, action: 'entrada_repetida', message: 'Entrada já confirmada às 07:00. Bom trabalho!' }
  }

  return { success: false, action: null, message: 'Fora da janela de presença permitida.' }
}

console.log('--- TESTES DA GUARDA DE INTERVALO MÍNIMO NO TERMINAL ---')

// Cenário 1: Ingrid bate 1ª vez às 07:01 (Entrada)
const r1 = simularTerminal({
  entradas: [null],
  intervaloFlexivel: true,
  agoraMin: 421, // 07:01
  agoraEpochMin: 421,
  inicioMin: 420, // 07:00
  fimMin: 1140, // 19:00
  intIniMin: 720,
  intFimMin: 780
})
console.log('1ª batida 07:01:', r1.action, '->', r1.message, r1.action === 'checkin' ? '✅ OK' : '❌ ERRO')

// Cenário 2: Ingrid bate 2ª vez às 07:02 (1 min depois)
const r2 = simularTerminal({
  entradas: [421], // entrada às 07:01
  intervaloFlexivel: true,
  agoraMin: 422, // 07:02
  agoraEpochMin: 422,
  inicioMin: 420,
  fimMin: 1140,
  intIniMin: 720,
  intFimMin: 780
})
console.log('2ª batida 07:02:', r2.action, '->', r2.message, r2.action === 'entrada_repetida' ? '✅ OK (não consumiu intervalo)' : '❌ ERRO')

// Cenário 3: Ingrid bate 3ª vez às 07:03 (2 min depois)
const r3 = simularTerminal({
  entradas: [421],
  intervaloFlexivel: true,
  agoraMin: 423, // 07:03
  agoraEpochMin: 423,
  inicioMin: 420,
  fimMin: 1140,
  intIniMin: 720,
  intFimMin: 780
})
console.log('3ª batida 07:03:', r3.action, '->', r3.message, r3.action === 'entrada_repetida' ? '✅ OK (não consumiu intervalo)' : '❌ ERRO')

// Cenário 4: Ingrid vai almoçar às 12:00 (300 min depois)
const r4 = simularTerminal({
  entradas: [421],
  intervaloFlexivel: true,
  agoraMin: 720, // 12:00
  agoraEpochMin: 720,
  inicioMin: 420,
  fimMin: 1140,
  intIniMin: 720,
  intFimMin: 780
})
console.log('Batida real de almoço 12:00:', r4.action, '->', r4.message, r4.action === 'intervalo_saida' ? '✅ OK' : '❌ ERRO')
