#!/usr/bin/env node
/**
 * Recorta do CHANGELOG.md APENAS a seção da versão pedida — o texto que vai no campo
 * "Release notes" do GitHub.
 *
 * Existe porque colar o CHANGELOG inteiro naquele campo leva junto o histórico de todas as
 * versões anteriores, e recortar à mão a cada release é o tipo de passo que se erra em silêncio
 * (uma seção a mais, uma linha a menos).
 *
 * Uso:
 *   node scripts/notas-da-release.mjs                 # a versão do package.json
 *   node scripts/notas-da-release.mjs 2.68.0          # uma versão específica
 *   node scripts/notas-da-release.mjs --arquivo       # grava em scratchpad/_release-notes.md
 *   node scripts/notas-da-release.mjs --publicar      # cria/atualiza a release no GitHub (exige gh)
 *
 * Sem o `gh` instalado, `--publicar` falha com instrução explícita em vez de fingir sucesso.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const gravarArquivo = args.includes('--arquivo')
const publicar = args.includes('--publicar')
const versaoPedida = args.find(a => !a.startsWith('--'))

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const versao = versaoPedida || pkg.version

const changelog = readFileSync('CHANGELOG.md', 'utf8')
const linhas = changelog.split(/\r?\n/)

// O cabeçalho da seção é `## [X.Y.Z] - AAAA-MM-DD`. Casar pelo colchete evita confundir a versão
// 2.6.0 com a 2.60.0, que um `includes` cru aceitaria.
const inicio = linhas.findIndex(l => l.startsWith(`## [${versao}]`))
if (inicio < 0) {
  console.error(`Nao achei a secao da versao ${versao} no CHANGELOG.md.`)
  console.error('Escreva a secao antes de publicar a release — a nota nao pode ser inventada aqui.')
  process.exit(1)
}

// Vai ate o proximo cabecalho de versao, nao ate o fim do arquivo.
const resto = linhas.slice(inicio + 1)
const fimRelativo = resto.findIndex(l => l.startsWith('## ['))
const corpo = (fimRelativo < 0 ? resto : resto.slice(0, fimRelativo))

// Tira as linhas em branco das pontas, preservando as do meio.
while (corpo.length && corpo[0].trim() === '') corpo.shift()
while (corpo.length && corpo[corpo.length - 1].trim() === '') corpo.pop()

if (corpo.length === 0) {
  console.error(`A secao da versao ${versao} existe mas esta vazia.`)
  process.exit(1)
}

const notas = corpo.join('\n') + '\n'

if (gravarArquivo || publicar) {
  if (!existsSync('scratchpad')) mkdirSync('scratchpad')
  writeFileSync('scratchpad/_release-notes.md', notas)
  console.error(`Notas da v${versao} gravadas em scratchpad/_release-notes.md`)
}

if (publicar) {
  const tag = `v${versao}`
  try {
    execFileSync('gh', ['--version'], { stdio: 'pipe' })
  } catch {
    console.error('\nO GitHub CLI (gh) nao esta instalado nesta maquina.')
    console.error('Instale com: winget install --id GitHub.cli')
    console.error(`Ou cole o conteudo de scratchpad/_release-notes.md no campo "Release notes" da tag ${tag}.`)
    process.exit(1)
  }

  // Release que ja existe e ATUALIZADA, nunca duplicada.
  let existe = true
  try {
    execFileSync('gh', ['release', 'view', tag], { stdio: 'pipe' })
  } catch {
    existe = false
  }

  const comando = existe
    ? ['release', 'edit', tag, '--notes-file', 'scratchpad/_release-notes.md']
    : ['release', 'create', tag, '--title', tag, '--notes-file', 'scratchpad/_release-notes.md']

  execFileSync('gh', comando, { stdio: 'inherit' })
  console.error(`\nRelease ${tag} ${existe ? 'atualizada' : 'publicada'}.`)
} else if (!gravarArquivo) {
  process.stdout.write(notas)
}
