/**
 * Valida o portao do manual: injeta defeitos reais de conteudo e exige que sim_manual.js reprove
 * cada um. Portao de conteudo que nunca falha da a falsa impressao de que o manual esta conferido.
 *
 * Confere que cada injecao foi APLICADA antes de rodar (armadilha 48 do CLAUDE.md): substituicao
 * no-op faria o portao "passar" e este validador mentir.
 *
 * Rodar (depois de transpilar, ver o cabecalho de sim_manual.js):
 *   node scratchpad/val_sim_manual.js
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const DIR = path.join(__dirname, '_sim_manual/conteudo')
const PORTAO = path.join(__dirname, 'sim_manual.js')

if (!fs.existsSync(DIR)) {
  console.error('Transpile primeiro -- ver o cabecalho de scratchpad/sim_manual.js')
  process.exit(1)
}

const injecoes = [
  {
    arquivo: 'duvidas.js',
    nome: 'link "veja" apontando para secao que nao existe',
    de: "secaoId: 'nao-apareceu'",
    para: "secaoId: 'secao-que-nao-existe'",
  },
  {
    arquivo: 'ponto.js',
    nome: 'tabela com linha faltando uma celula',
    de: "['Verde', 'Registrado, dentro do horário previsto.', 'Seguir o dia.']",
    para: "['Verde', 'Registrado, dentro do horário previsto.']",
  },
  {
    arquivo: 'gestao.js',
    nome: 'jargao tecnico vazando para o texto do usuario',
    de: 'Os locais, e as regras de ponto de cada um',
    para: 'A tabela escala_diaria e as regras de ponto de cada um',
  },
  {
    arquivo: 'escalas.js',
    nome: 'negrito nao fechado',
    de: 'O que você digita fica **só na sua tela**',
    para: 'O que você digita fica **só na sua tela',
  },
  {
    arquivo: 'servidor.js',
    nome: 'duas secoes com o mesmo id',
    de: "id: 'pin'",
    para: "id: 'portal'",
  },
]

let tudoCerto = true

for (const inj of injecoes) {
  const arquivo = path.join(DIR, inj.arquivo)
  const original = fs.readFileSync(arquivo, 'utf8')

  if (!original.includes(inj.de)) {
    console.error(`NAO APLICADA: "${inj.nome}" -- trecho ausente em ${path.basename(arquivo)}`)
    console.error(`  procurado: ${inj.de}`)
    tudoCerto = false
    continue
  }

  const quebrado = original.replace(inj.de, () => inj.para)
  if (quebrado === original) {
    console.error(`NAO APLICADA (no-op): ${inj.nome}`)
    tudoCerto = false
    continue
  }

  fs.writeFileSync(arquivo, quebrado)
  let reprovou = false
  try {
    execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
  } catch (e) {
    reprovou = true
  }
  fs.writeFileSync(arquivo, original)

  if (reprovou) {
    console.log(`OK   o portao reprova: ${inj.nome}`)
  } else {
    console.error(`FALHA o portao PASSOU com: ${inj.nome}`)
    tudoCerto = false
  }
}

try {
  execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
  console.log('OK   o portao passa com o manual intacto')
} catch (e) {
  console.error('FALHA o portao reprova o manual INTACTO')
  tudoCerto = false
}

process.exit(tudoCerto ? 0 : 1)
