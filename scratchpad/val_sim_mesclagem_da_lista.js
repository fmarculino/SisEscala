/**
 * Valida o PORTAO: injeta regressoes de proposito no modulo transpilado e exige que
 * sim_mesclagem_da_lista.js reprove cada uma. Portao que nunca falha nao vale nada.
 *
 * ⚠️ Confere que a substituicao foi de fato APLICADA antes de rodar o portao (armadilha 48 do
 * CLAUDE.md: um replace no-op faz o teste "passar" e o teste do teste mentir).
 *
 * Rodar (depois de transpilar, ver o cabecalho do sim):
 *   node scratchpad/val_sim_mesclagem_da_lista.js
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ALVO = path.join(__dirname, '_sim/mesclagemCadastro.js')
const PORTAO = path.join(__dirname, 'sim_mesclagem_da_lista.js')

if (!fs.existsSync(ALVO)) {
  console.error('Transpile primeiro: npx tsc src/utils/mesclagemCadastro.ts --outDir scratchpad/_sim --module commonjs --target es2020')
  process.exit(1)
}

const original = fs.readFileSync(ALVO, 'utf8')

const regressoes = [
  {
    nome: 'aceita CPF diferente entre os cadastros (mescla DUAS PESSOAS)',
    de: 'if (cpfs.size > 1) {',
    para: 'if (false) {',
  },
  {
    nome: 'oferece mesclagem sem o grupo existir no banco (promete o que nao ha)',
    de: 'if (!gruposComAcao.some(g => soDigitos(g.cpf) === cpf)) {',
    para: 'if (false) {',
  },
  {
    nome: 'esconde a escala fundida do relato (armadilha 22)',
    de: 'return fundidas.map(f =>',
    para: 'return [].map(f =>',
  },
]

let tudoCerto = true

for (const r of regressoes) {
  if (!original.includes(r.de)) {
    console.error(`NAO APLICADA: o trecho da regressao "${r.nome}" nao existe no transpilado.`)
    console.error(`  procurado: ${r.de}`)
    tudoCerto = false
    continue
  }

  const quebrado = original.split(r.de).join(r.para)
  if (quebrado === original) {
    console.error(`NAO APLICADA (substituicao no-op): ${r.nome}`)
    tudoCerto = false
    continue
  }

  fs.writeFileSync(ALVO, quebrado)
  let reprovou = false
  try {
    execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
  } catch (e) {
    reprovou = true
  }
  fs.writeFileSync(ALVO, original)

  if (reprovou) {
    console.log(`OK   o portao reprova: ${r.nome}`)
  } else {
    console.error(`FALHA o portao PASSOU com a regressao: ${r.nome}`)
    tudoCerto = false
  }
}

// E, sem regressao nenhuma, ele tem que passar -- senao "reprova sempre" nao prova nada.
try {
  execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
  console.log('OK   o portao passa com o codigo intacto')
} catch (e) {
  console.error('FALHA o portao reprova o codigo INTACTO')
  tudoCerto = false
}

process.exit(tudoCerto ? 0 : 1)
