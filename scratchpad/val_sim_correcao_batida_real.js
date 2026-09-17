/**
 * VALIDADOR DO PORTAO: injeta regressoes de proposito e exige que sim_correcao_batida_real.js
 * REPROVE em todas.
 *
 * Portao que nunca falha nao vale nada (armadilha 36). E — lição da armadilha 48 — cada
 * substituicao e CONFERIDA: injecao que nao altera o arquivo faz o validador "passar" sem ter
 * testado coisa nenhuma, e teste que mente e pior que nao ter teste.
 *
 * ⚠️ As ancoras sao do JS COMPILADO (scratchpad/_sim), nao do TypeScript: o tsc reescreve
 *    quebras de linha, tipos e defaults, entao casar contra o .ts vira no-op silencioso.
 *
 * Uso:
 *   npx tsc src/utils/folha/correcaoBatidaReal.ts src/utils/gestaoJustificativas.ts \
 *     --outDir scratchpad/_sim --module commonjs --target es2020
 *   node scratchpad/val_sim_correcao_batida_real.js
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const DIR = path.join(__dirname, '_sim')
const CORR = path.join(DIR, 'folha', 'correcaoBatidaReal.js')
const JUST = path.join(DIR, 'gestaoJustificativas.js')
const PORTAO = path.join(__dirname, 'sim_correcao_batida_real.js')

for (const f of [CORR, JUST]) {
  if (!fs.existsSync(f)) {
    console.error(`ABORTADO: ${f} nao existe. Transpile antes (veja o cabecalho).`)
    process.exit(1)
  }
}

const ORIG = { [CORR]: fs.readFileSync(CORR, 'utf8'), [JUST]: fs.readFileSync(JUST, 'utf8') }

const REGRESSOES = [
  {
    nome: 'RH volta a poder DIGITAR horario sobre batida real (vedacao 4 da Portaria 671)',
    arquivo: CORR,
    de: `exports.PAPEIS_DIGITAM_SOBRE_BATIDA_REAL = [
    'super_admin', 'admin',
];`,
    para: `exports.PAPEIS_DIGITAM_SOBRE_BATIDA_REAL = [
    'super_admin', 'admin', 'rh', 'rh_unidade',
];`,
  },
  {
    nome: 'RH perde o rearranjo -- o beco de 17/09/2026 de volta',
    arquivo: CORR,
    de: `exports.PAPEIS_REARRANJAM_BATIDA_REAL = [
    'super_admin', 'admin', 'rh', 'rh_unidade',
];`,
    para: `exports.PAPEIS_REARRANJAM_BATIDA_REAL = [
    'super_admin', 'admin',
];`,
  },
  {
    nome: 'coordenador ganha o rearranjo de batida real',
    arquivo: CORR,
    de: `exports.PAPEIS_REARRANJAM_BATIDA_REAL = [
    'super_admin', 'admin', 'rh', 'rh_unidade',
];`,
    para: `exports.PAPEIS_REARRANJAM_BATIDA_REAL = [
    'super_admin', 'admin', 'rh', 'rh_unidade', 'coordenador', 'ass_adm',
];`,
  },
  {
    nome: "ehBatidaReal deixa de reconhecer 'real', o vocabulario da FOLHA",
    arquivo: CORR,
    de: `return origem === 'rep' || origem === 'terminal' || origem === 'real';`,
    para: `return origem === 'rep' || origem === 'terminal';`,
  },
  {
    nome: 'digitar sobre batida real passa a ser tratado como simples rearranjo',
    arquivo: CORR,
    de: `return params.novoHorarioDigitado ? 'digitar_sobre_real' : 'rearranjar';`,
    para: `return 'rearranjar';`,
  },
  {
    nome: 'a recusa volta ao texto antigo, que nao dizia o que fazer',
    arquivo: CORR,
    de: `return 'Só o RH (Geral ou da Unidade) e o Administrador podem remanejar batidas registradas '
            + 'em terminal ou relógio. Para validar um passo que ficou VAZIO, o caminho continua aberto '
            + 'para você.';`,
    para: `return 'Apenas administradores podem alterar ou reverter batidas presenciais registradas em terminal.';`,
  },
  {
    nome: "a fila volta a NAO oferecer decisao em plantao 'registrado'",
    arquivo: JUST,
    de: `return params.ehReversao
        || params.estado === 'em_avaliacao'
        || params.estado === 'registrado';`,
    para: `return params.ehReversao
        || params.estado === 'em_avaliacao';`,
  },
  {
    nome: 'falta contra o ponto deixa de exigir confirmacao',
    arquivo: JUST,
    de: `return params.desfechoNovo === 'falta' && params.temRegistro;`,
    para: `return false;`,
  },
]

let reprovou = 0
const passaramIndevidamente = []

for (const reg of REGRESSOES) {
  // restaura tudo antes de cada injecao
  for (const f of [CORR, JUST]) fs.writeFileSync(f, ORIG[f], 'utf8')

  const antes = fs.readFileSync(reg.arquivo, 'utf8')
  if (!antes.includes(reg.de)) {
    console.error(`ABORTADO: a ancora da regressao "${reg.nome}" nao existe no JS compilado.`)
    console.error('  O codigo mudou de forma; atualize o validador em vez de deixa-lo passar vazio.')
    for (const f of [CORR, JUST]) fs.writeFileSync(f, ORIG[f], 'utf8')
    process.exit(1)
  }
  const depois = antes.split(reg.de).join(reg.para)
  if (depois === antes) {
    console.error(`ABORTADO: a injecao "${reg.nome}" foi um no-op.`)
    for (const f of [CORR, JUST]) fs.writeFileSync(f, ORIG[f], 'utf8')
    process.exit(1)
  }
  fs.writeFileSync(reg.arquivo, depois, 'utf8')

  let falhou = false
  try {
    execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
  } catch {
    falhou = true
  }

  if (falhou) {
    reprovou++
    console.log(`  OK  o portao REPROVOU: ${reg.nome}`)
  } else {
    passaramIndevidamente.push(reg.nome)
    console.error(`  XX  o portao PASSOU com a regressao: ${reg.nome}`)
  }
}

for (const f of [CORR, JUST]) fs.writeFileSync(f, ORIG[f], 'utf8')

console.log(`\nval_sim_correcao_batida_real: ${reprovou}/${REGRESSOES.length} regressoes reprovadas`)
if (passaramIndevidamente.length) {
  console.error('\nO portao nao cobre:')
  passaramIndevidamente.forEach(n => console.error('  - ' + n))
  process.exit(1)
}
