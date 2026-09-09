// Valida o PORTAO: injeta regressoes de proposito em scratchpad/_sim/conflitoEscala.js e exige
// que sim_conflito_pessoa.js REPROVE em todas. Portao que nunca falha nao vale nada.
//
// ⚠️ As ancoras sao o texto do JS COMPILADO, nao o do TypeScript. Cada injecao confere que a
// substituicao foi de fato APLICADA — sem isso o validador "passaria" sem ter testado nada
// (armadilha 48: teste do teste que mente).
//
// Rodar (depois de transpilar):
//   npx tsc src/utils/conflitoEscala.ts --outDir scratchpad/_sim --module commonjs --target es2020
//   node scratchpad/val_sim_conflito_pessoa.js
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ALVO = path.join(__dirname, '_sim', 'conflitoEscala.js')
const SIM = path.join(__dirname, 'sim_conflito_pessoa.js')

if (!fs.existsSync(ALVO)) {
  console.error('ABORTADO: transpile antes:\n  npx tsc src/utils/conflitoEscala.ts --outDir scratchpad/_sim --module commonjs --target es2020')
  process.exit(1)
}
const original = fs.readFileSync(ALVO, 'utf8')

function rodaSim() {
  try {
    execFileSync(process.execPath, [SIM], { stdio: 'pipe' })
    return true   // passou
  } catch (e) {
    return false  // reprovou
  }
}

if (!rodaSim()) {
  console.error('ABORTADO: o portao ja reprova com o codigo ATUAL. Corrija antes de validar.')
  process.exit(1)
}
console.log('baseline: o portao passa com o codigo atual\n')

const regressoes = [
  {
    nome: 'a grade volta a comparar so o proprio servidor_id (nao enxerga a irma)',
    de: 'daPessoa.includes(o.servidor_id) &&',
    para: 'o.servidor_id === servidorId &&',
  },
  {
    nome: 'a linha da irma volta a ser excluida pela escala',
    de: '(o.servidor_id !== servidorId || o.escala_mensal_id !== escalaMensalId) &&',
    para: 'o.escala_mensal_id !== escalaMensalId &&',
  },
  {
    nome: 'o mapa de pessoa e ignorado (idsDoServidor devolve so ele)',
    de: 'const daPessoa = idsDoServidor(idsDaPessoa, servidorId);',
    para: 'const daPessoa = [servidorId];',
  },
  {
    nome: 'perde o rotulo de "outra matricula" na mensagem e na flag',
    de: 'const outraMatricula = achado.servidor_id !== servidorId;',
    para: 'const outraMatricula = false;',
  },
  {
    nome: 'passa a conflitar por DIA, ignorando os slots (quebra MT x N)',
    de: 'o.slots.some(s => slots.includes(s))',
    para: 'true',
  },
]

let reprovaram = 0
for (const r of regressoes) {
  const n = original.split(r.de).length - 1
  if (n !== 1) {
    console.error(`ABORTADO [${r.nome}]: a ancora aparece ${n} vez(es) no JS compilado, esperava 1.`)
    fs.writeFileSync(ALVO, original)
    process.exit(1)
  }
  const modificado = original.split(r.de).join(r.para)
  if (modificado === original) {
    console.error(`ABORTADO [${r.nome}]: a substituicao NAO mudou nada (injecao no-op).`)
    fs.writeFileSync(ALVO, original)
    process.exit(1)
  }
  fs.writeFileSync(ALVO, modificado)
  const passou = rodaSim()
  if (passou) {
    console.error(`  FALHA: o portao PASSOU com a regressao "${r.nome}" — ele nao cobre esse caso.`)
  } else {
    reprovaram++
    console.log(`  ok    reprovou: ${r.nome}`)
  }
}

fs.writeFileSync(ALVO, original)
if (!rodaSim()) {
  console.error('\nABORTADO: o arquivo nao voltou ao original.')
  process.exit(1)
}

console.log(`\n${reprovaram} de ${regressoes.length} regressoes reprovadas; arquivo restaurado.`)
process.exit(reprovaram === regressoes.length ? 0 : 1)
