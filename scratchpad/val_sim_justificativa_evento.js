// Valida o PORTAO de justificativaEvento: injeta regressoes de proposito e exige reprovacao.
// Um portao que nunca falha nao vale nada (armadilha 36).
//
// ⚠️ As ancoras do modulo sao o texto do JS COMPILADO (scratchpad/_sim/), nao o do TypeScript.
// Substituicao que nao casa vira no-op e o validador "passaria" sem ter testado nada
// (armadilha 48) — por isso toda injecao e conferida antes de rodar.
//
//   node scratchpad/val_sim_justificativa_evento.js
const fs = require('fs')
const { execFileSync } = require('child_process')

const MOD = 'scratchpad/_sim/justificativaEvento.js'
const GRADE = 'src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx'
const MIG = 'supabase/migrations/20260910120000_troca_de_turno_em_linha_regular.sql'

const REGRESSOES = [
  [MOD, 'Regular volta a "ter" justificativa de evento (o INSERT morreria em 23514 de novo)',
    s => s.replace("['Extra', 'Plantão', 'Sobreaviso']", "['Regular', 'Extra', 'Plantão', 'Sobreaviso']")],

  [MOD, 'o modal volta a prometer relatorio para qualquer categoria',
    s => s.replace(/function destinoDaJustificativaTurno\(categoria\) \{/,
      'function destinoDaJustificativaTurno(categoria) { return `ele fica no histórico da escala e sai no relatório de justificativas de ${categoria}.`;')],

  [MOD, 'a confirmacao volta a prometer relatorio sempre',
    s => s.replace(/const onde = [\s\S]*?: 'com a justificativa no histórico da escala';/,
      "const onde = `com a justificativa no histórico e no relatório de ${categoria}`;")],

  [MOD, 'a lista de categorias de evento perde o Plantao (fecharia demais)',
    s => s.replace("['Extra', 'Plantão', 'Sobreaviso']", "['Extra', 'Sobreaviso']")],

  [GRADE, 'a grade volta a interpolar a categoria no texto do modal',
    s => s.replace('{destinoDaJustificativaTurno(trocaTurnoModal.categoria)}',
      'ele fica no histórico da escala e sai no relatório de {trocaTurnoModal.categoria}.')],

  [MIG, 'a migration perde o guard (a escrita volta a ser incondicional)',
    s => s.replace('    IF public.fn_categoria_tem_justificativa_evento(p_categoria) THEN\r\n', '')],

  [MIG, 'a copia mecanica perde o guard de escala fechada',
    s => s.replace("    IF v_status = 'Fechada' THEN", "    IF false THEN")],
]

let falhas = 0
for (const [alvo, rot, muta] of REGRESSOES) {
  const original = fs.readFileSync(alvo, 'utf8')
  const mutado = muta(original)
  if (mutado === original) {
    console.log(`ERRO NA INJECAO (substituicao no-op, a ancora nao casou): ${rot}`)
    falhas++
    continue
  }
  fs.writeFileSync(alvo, mutado)
  let reprovou = false
  try {
    execFileSync('node', ['scratchpad/sim_justificativa_evento.js'], { stdio: 'pipe' })
  } catch { reprovou = true }
  fs.writeFileSync(alvo, original)
  console.log(`${reprovou ? 'OK   o portao reprova' : 'FALHA o portao PASSOU'}: ${rot}`)
  if (!reprovou) falhas++
}

// E, com tudo restaurado, o portao tem que voltar a passar.
try {
  execFileSync('node', ['scratchpad/sim_justificativa_evento.js'], { stdio: 'pipe' })
  console.log('OK   o portao passa com o codigo restaurado')
} catch (e) {
  console.log('FALHA o portao nao volta a passar depois das injecoes')
  falhas++
}

process.exit(falhas ? 1 : 0)
