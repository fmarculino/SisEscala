/**
 * Valida o portao sim_conflito_pendencia.js: injeta regressoes de proposito no modulo
 * transpilado e exige que o portao REPROVE cada uma.
 *
 * Portao que nunca falha nao vale nada (CLAUDE.md, 30/08/2026). E ancora de injecao que nao casa
 * "passa" sem ter testado nada (armadilha 48) - por isso cada substituicao e conferida.
 *
 *   npx tsc src/utils/pendenciaRh/conflitoCadastro.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *   node scratchpad/val_sim_conflito_pendencia.js
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ALVO = path.join(__dirname, '_sim', 'conflitoCadastro.js')
const PORTAO = path.join(__dirname, 'sim_conflito_pendencia.js')
const original = fs.readFileSync(ALVO, 'utf8')

const regressoes = [
  {
    nome: 'conferencia que FALHOU volta a ser tratada como "pode seguir"',
    de: `if (e.conferencia.estado === 'falhou') {`,
    para: `if (false) {`,
  },
  {
    nome: '"atualizar" volta a ser oferecido para cadastro fora do escopo',
    de: `const atualizar = conflito.alvo_no_escopo`,
    para: `const atualizar = true`,
  },
  {
    nome: 'colisao de MATRICULA volta a oferecer cadastro novo',
    de: `if (conflito.tipo === 'matricula') {`,
    para: `if (false) {`,
  },
  {
    nome: 'bloqueio por escopo perde a explicacao (botao cinza mudo)',
    de: `motivo: opcoes.atualizar.motivo,`,
    para: `motivo: null,`,
  },
  {
    nome: 'a recusa do banco deixa de ser reconhecida (a pergunta volta a morrer em texto vermelho)',
    de: `return /cpf ja (esta )?cadastrado/.test(texto);`,
    para: `return false;`,
  },
  {
    nome: 'motivo do impedimento deixa de nomear a unidade do cadastro existente',
    de: `return conflito.unidade_nome ? \`em \${conflito.unidade_nome}\` : 'em outra unidade';`,
    para: `return 'em outra unidade';`,
  },
  {
    nome: 'criar cadastro deixa de exigir CPF',
    de: `if (!e.cpfInformado)`,
    para: `if (false)`,
  },
]

let reprovadas = 0
const problemas = []

for (const r of regressoes) {
  if (!original.includes(r.de)) {
    problemas.push(`ANCORA NAO ENCONTRADA (a injecao nao testaria nada): ${r.nome}\n    procurava: ${r.de}`)
    continue
  }
  const injetado = original.replace(r.de, r.para)
  if (injetado === original) {
    problemas.push(`SUBSTITUICAO NAO APLICADA: ${r.nome}`)
    continue
  }
  fs.writeFileSync(ALVO, injetado, 'utf8')
  let passou = true
  try {
    execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
  } catch {
    passou = false
  }
  fs.writeFileSync(ALVO, original, 'utf8')

  if (passou) {
    problemas.push(`PORTAO PASSOU COM A REGRESSAO: ${r.nome}`)
  } else {
    reprovadas++
    console.log(`  reprovada corretamente: ${r.nome}`)
  }
}

// O portao tem que passar com o modulo intacto, senao a validacao acima nao prova nada.
try {
  execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
} catch (e) {
  problemas.push('PORTAO REPROVA O MODULO INTACTO')
}

console.log(`\n${reprovadas}/${regressoes.length} regressões reprovadas`)
if (problemas.length) {
  problemas.forEach(p => console.log(`  ${p}`))
  process.exit(1)
}
console.log('VALIDADOR OK')
