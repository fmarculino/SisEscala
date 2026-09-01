/*
 * Portao de src/utils/sequenciaPresenca.ts. Nao ha framework de teste no projeto.
 *
 *   npx tsc src/utils/sequenciaPresenca.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *   node scratchpad/sim_sequencia_presenca.js
 *
 * O caso 1 e o bug relatado em 01/09/2026: plantao noturno 19:00 / 22:00 / 23:00 / 07:00, que a
 * grade recusava e nao deixava o coordenador concluir a validacao manual.
 */
const { avaliarSequenciaPresenca, minutosDoHHMM } = require('./_sim/sequenciaPresenca')

let falhas = 0
function caso(nome, horarios, cruzaMeiaNoite, esperado) {
  const r = avaliarSequenciaPresenca(horarios, { cruzaMeiaNoite })
  const dia2 = r.diaSeguinte.join(',')
  const okEsperado = esperado.ok === r.ok
  const okDia2 = esperado.diaSeguinte === undefined || esperado.diaSeguinte === dia2
  if (okEsperado && okDia2) {
    console.log(`  ok   ${nome}`)
  } else {
    falhas++
    console.log(`  FALHA ${nome}`)
    console.log(`        esperado ok=${esperado.ok} diaSeguinte="${esperado.diaSeguinte ?? '(qualquer)'}"`)
    console.log(`        obtido   ok=${r.ok} diaSeguinte="${dia2}" msg=${r.mensagem || ''}`)
  }
}

console.log('Plantao noturno (o caso relatado):')
caso('N 19:00/22:00/23:00/07:00 com virada',
  { entrada: '19:00', intervalo_saida: '22:00', intervalo_retorno: '23:00', saida: '07:00' },
  true, { ok: true, diaSeguinte: 'saida' })
caso('mesma sequencia SEM virada prevista e recusada',
  { entrada: '19:00', intervalo_saida: '22:00', intervalo_retorno: '23:00', saida: '07:00' },
  false, { ok: false })
caso('intervalo depois da meia-noite: 19:00/00:30/01:30/07:00',
  { entrada: '19:00', intervalo_saida: '00:30', intervalo_retorno: '01:30', saida: '07:00' },
  true, { ok: true, diaSeguinte: 'intervalo_saida,intervalo_retorno,saida' })
caso('so 2o periodo: retorno 23:00 e saida 07:00',
  { intervalo_retorno: '23:00', saida: '07:00' },
  true, { ok: true, diaSeguinte: 'saida' })
caso('MTN 07:00 -> 07:00 sao 24h exatas e passam',
  { entrada: '07:00', saida: '07:00' },
  true, { ok: true, diaSeguinte: 'saida' })

console.log('Diurno:')
caso('08:00/12:00/13:00/18:00 sem virada',
  { entrada: '08:00', intervalo_saida: '12:00', intervalo_retorno: '13:00', saida: '18:00' },
  false, { ok: true, diaSeguinte: '' })
caso('08:00/12:00/13:00/18:00 num dia que vira (nada muda)',
  { entrada: '08:00', intervalo_saida: '12:00', intervalo_retorno: '13:00', saida: '18:00' },
  true, { ok: true, diaSeguinte: '' })
caso('retorno antes da saida do intervalo e recusado',
  { entrada: '08:00', intervalo_saida: '13:00', intervalo_retorno: '12:00', saida: '18:00' },
  false, { ok: false })
caso('saida igual a entrada, sem virada, e recusada',
  { entrada: '08:00', saida: '08:00' },
  false, { ok: false })

console.log('Teto de 24h (o que impede a normalizacao de esconder erro de digitacao):')
caso('19:00/18:00/17:00 estoura as 24h',
  { entrada: '19:00', intervalo_saida: '18:00', intervalo_retorno: '17:00' },
  true, { ok: false })
// Cada passo desloca no maximo UM dia e todos ficam crescentes: so o teto de 24h
// recusa esta. E o caso que valida o teto sozinho.
caso('23:00/22:00/23:30 cresce a cada passo e ainda assim passa de 24h',
  { entrada: '23:00', intervalo_saida: '22:00', intervalo_retorno: '23:30' },
  true, { ok: false })
caso('19:00/18:00 sozinho ainda cabe em 24h',
  { entrada: '19:00', intervalo_saida: '18:00' },
  true, { ok: true, diaSeguinte: 'intervalo_saida' })

console.log('Preenchimento parcial e lixo:')
caso('nenhum passo preenchido', {}, false, { ok: true, diaSeguinte: '' })
caso('um passo so', { entrada: '19:00' }, true, { ok: true, diaSeguinte: '' })
caso('nulos e vazios sao ignorados',
  { entrada: '19:00', intervalo_saida: null, intervalo_retorno: '', saida: '07:00' },
  true, { ok: true, diaSeguinte: 'saida' })
caso('hora invalida e ignorada, nao derruba a sequencia',
  { entrada: '19:00', saida: '25:99' },
  true, { ok: true, diaSeguinte: '' })
caso('HH:MM:SS aceito (batida selecionada traz segundos)',
  { entrada: '19:00:07', saida: '07:03:41' },
  true, { ok: true, diaSeguinte: 'saida' })

console.log('minutosDoHHMM:')
for (const [v, esp] of [['00:00', 0], ['07:00', 420], ['23:59', 1439], ['24:00', null], ['7:00', null], [null, null]]) {
  const got = minutosDoHHMM(v)
  if (got === esp) { console.log(`  ok   ${JSON.stringify(v)} -> ${got}`) }
  else { falhas++; console.log(`  FALHA ${JSON.stringify(v)} -> ${got}, esperado ${esp}`) }
}

console.log(falhas === 0 ? '\nTODOS OS CASOS PASSARAM' : `\n${falhas} CASO(S) REPROVADO(S)`)
process.exit(falhas === 0 ? 0 : 1)
