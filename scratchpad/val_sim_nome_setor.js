/**
 * Validador do portao: injeta regressoes de proposito e EXIGE que sim_nome_setor.js reprove cada
 * uma. Portao que nunca falha nao vale nada.
 *
 *   npx tsc src/utils/setores/nomeSetor.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *   node scratchpad/val_sim_nome_setor.js
 *
 * ⚠️ As ancoras sao o texto do JS COMPILADO, nao o do TypeScript. Por isso cada injecao confere
 *   que a substituicao foi de fato aplicada — injecao que vira no-op faz o validador "passar" sem
 *   ter testado nada, que e' pior que nao ter validador.
 */
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

const ALVO = require.resolve('./_sim/nomeSetor.js')
const original = fs.readFileSync(ALVO, 'utf8')

const REGRESSOES = [
  {
    nome: 'lado menor volta a aceitar 1 palavra (ruido: ENFERMAGEM acusa TEC ENFERMAGEM)',
    de: 'menor.length >= 2',
    para: 'menor.length >= 1',
  },
  {
    nome: 'A e O voltam a ser ligacao (BLOCO A vira so BLOCO e acusa BLOCO B SHL)',
    de: `'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'PARA'`,
    para: `'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'PARA', 'A', 'O'`,
  },
  {
    nome: 'digitacao volta a medir o nome inteiro com distancia 2 (CARDIOLOGIA x RADIOLOGIA)',
    de: 'if (ehErroDeDigitacao(palavrasAlvo, palavrasOutro)) {',
    para: 'if (Math.min(alvo.length, outro.length) >= 5 && distancia(alvo, outro) > 0 && distancia(alvo, outro) <= 2) {',
  },
  {
    nome: 'palavra divergente curta volta a contar como digitacao (BLOCO A x BLOCO B)',
    de: 'Math.min(x.length, y.length) >= 4',
    para: 'Math.min(x.length, y.length) >= 1',
  },
  {
    nome: 'encontrarNomeIdentico para de normalizar (RECEPCAO deixa de achar RECEPÇÃO)',
    de: 'return existentes.find(e => normalizarNomeSetor(e) === alvo) ?? null;',
    para: 'return existentes.find(e => e === nome) ?? null;',
  },
  {
    nome: 'limite de sugestoes deixa de ser aplicado',
    de: '.slice(0, limite)',
    para: '.slice(0)',
  },
  {
    nome: 'a recusa deixa de explicar a consequencia na transferencia',
    de: 'transferir um servidor vai ver',
    para: 'ninguem vera',
  },
]

let reprovadas = 0
const naoReprovaram = []

for (const r of REGRESSOES) {
  const ocorrencias = original.split(r.de).length - 1
  if (ocorrencias < 1) {
    console.error(`ABORTA: ancora nao encontrada no JS compilado -> ${r.nome}\n  procurei: ${r.de}`)
    fs.writeFileSync(ALVO, original)
    process.exit(1)
  }

  const corrompido = original.split(r.de).join(r.para)
  if (corrompido === original) {
    console.error(`ABORTA: injecao virou no-op -> ${r.nome}`)
    fs.writeFileSync(ALVO, original)
    process.exit(1)
  }

  fs.writeFileSync(ALVO, corrompido)
  let reprovou = false
  try {
    execFileSync(process.execPath, [require.resolve('./sim_nome_setor.js')], { stdio: 'pipe' })
  } catch {
    reprovou = true
  }
  fs.writeFileSync(ALVO, original)

  if (reprovou) { reprovadas++; console.log(`  OK   reprovou: ${r.nome}`) }
  else naoReprovaram.push(r.nome)
}

console.log(`\n${reprovadas}/${REGRESSOES.length} regressões reprovadas pelo portão`)
if (naoReprovaram.length) {
  console.log('\nPASSARAM SEM SEREM PEGAS (o portão não cobre):')
  for (const n of naoReprovaram) console.log('  - ' + n)
  process.exit(1)
}
