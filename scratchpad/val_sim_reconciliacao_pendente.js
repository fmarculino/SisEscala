/**
 * VALIDADOR DO PORTAO — injeta regressoes de proposito e exige que sim_reconciliacao_pendente.js
 * REPROVE em todas. Portao que nunca falha nao vale nada.
 *
 *   npx tsc src/utils/reconciliacaoPendente.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *   node scratchpad/val_sim_reconciliacao_pendente.js
 *
 * ⚠️ Cada injecao CONFERE que a substituicao foi mesmo aplicada antes de rodar o portao
 * (armadilha 48: um `replace` no-op por diferenca de indentacao no JS compilado faz o
 * validador "passar" sem ter testado nada — teste que mente e pior que nenhum teste).
 */

const fs = require('fs')
const { execFileSync } = require('child_process')

const ALVO = 'scratchpad/_sim/reconciliacaoPendente.js'
const original = fs.readFileSync(ALVO, 'utf8')

const REGRESSOES = [
  {
    nome: 'conflito deixa de contaminar o dia (o caso 21:49 volta)',
    de: `        if (d.conflitos.length > 0)\n            d.elegivel = false;\n`,
    para: `        if (false)\n            d.elegivel = false;\n`,
  },
  {
    nome: 'impedimento deixa de derrubar (escala Fechada seria escrita)',
    de: `        if (d.impedimento)\n            d.elegivel = false;\n`,
    para: `        if (false)\n            d.elegivel = false;\n`,
  },
  {
    // Exercita a guarda `ganhos.length === 0` pelo unico caminho que a torna alcancavel:
    // com o `else` restrito, uma linha 'perda' some da classificacao e o dia ganho+perda
    // voltaria a ser elegivel — o caso 3 do portao pega.
    nome: 'tipo fora de ganho/troca deixa de ser tratado como conflito',
    de: `        else\n            d.conflitos.push(m);`,
    para: `        else if (l.tipo === 'troca')\n            d.conflitos.push(m);`,
  },
  {
    nome: 'a acao passa a receber TODOS os dias, nao so os elegiveis',
    de: `    return dias.filter(d => d.elegivel).map(d => ({ servidorId: d.servidorId, data: d.data }));`,
    para: `    return dias.map(d => ({ servidorId: d.servidorId, data: d.data }));`,
  },
  {
    nome: 'relato volta a contar o calculado (status ok com campos 0)',
    de: `    const aplicados = res.filter(r => r.status === 'ok' && r.campos > 0);`,
    para: `    const aplicados = res.filter(r => r.status === 'ok');`,
  },
  {
    nome: 'flag restritiva do banco deixa de ser obedecida',
    de: `        if (!l.dia_elegivel)\n            d.elegivel = false;\n`,
    para: `        if (false)\n            d.elegivel = false;\n`,
  },
]

let falhas = 0

for (const r of REGRESSOES) {
  if (!original.includes(r.de)) {
    console.error(`  ERRO DE MONTAGEM: trecho nao encontrado para "${r.nome}"`)
    console.error('    O JS compilado mudou de forma. Atualize o validador — nao o ignore.')
    falhas++
    continue
  }

  const mutado = original.replace(r.de, r.para)
  if (mutado === original) {
    console.error(`  ERRO DE MONTAGEM: substituicao no-op para "${r.nome}"`)
    falhas++
    continue
  }

  fs.writeFileSync(ALVO, mutado)
  let reprovou = false
  try {
    execFileSync(process.execPath, ['scratchpad/sim_reconciliacao_pendente.js'], { stdio: 'pipe' })
  } catch {
    reprovou = true
  }
  fs.writeFileSync(ALVO, original)

  if (reprovou) {
    console.log(`  OK  o portao pegou: ${r.nome}`)
  } else {
    console.error(`  REPROVOU  o portao NAO pegou: ${r.nome}`)
    falhas++
  }
}

// O portao tem que passar com o codigo intacto — senao "reprovou em tudo" seria trivial.
try {
  execFileSync(process.execPath, ['scratchpad/sim_reconciliacao_pendente.js'], { stdio: 'pipe' })
  console.log('  OK  o portao passa com o codigo intacto')
} catch {
  console.error('  REPROVOU  o portao falha mesmo sem regressao injetada')
  falhas++
}

console.log(`\n${falhas === 0 ? 'VALIDADOR OK' : `VALIDADOR REPROVOU (${falhas})`}`)
process.exit(falhas > 0 ? 1 : 0)
