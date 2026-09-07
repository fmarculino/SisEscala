#!/usr/bin/env node
/**
 * Preserva a decisao de AUTORIZACAO DE HORA EXTRA (Art. 8) nas QUATRO copias da geracao de folha.
 *
 * POR QUE UM GERADOR: sao quatro copias que ja divergiram entre si antes neste projeto (foi o que
 * criou sequenciaDia.ts). Esquecer UMA delas faz "Sincronizar" APAGAR a decisao da chefia por
 * aquele caminho — e o sintoma e' a autorizacao sumir sozinha, dias depois, sem erro nenhum.
 *
 *   executeGerarFolhaPonto        e sincronizarFolhaPonto        -> folha-ponto/actions.ts
 *   gerarFolhaPontoServidor       e sincronizarFolhaPontoServidor -> consultar-escala/actions.ts
 *
 * A ancora e' a chamada irma `carregarDecisaoCompensacao(...)`, que ja esta nas quatro: se um dia
 * ela sair de alguma, a contagem quebra e este gerador ABORTA em vez de deixar a nova de fora em
 * silencio.
 *
 * Rodar:  node scratchpad/gen_autorizacao_extra.js [--ensaio]
 */
'use strict'
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const ENSAIO = process.argv.includes('--ensaio')

const ARQUIVOS = [
  'src/app/(dashboard)/folha-ponto/actions.ts',
  'src/app/consultar-escala/actions.ts',
]

const ANCORA = 'carregarDecisaoCompensacao(registro, registroExistente)'
const NOVA = 'carregarDecisaoAutorizacaoExtra(registro, registroExistente)'
const ESPERADO_POR_ARQUIVO = 2   // duas copias da geracao em cada arquivo

const falhas = []
const saida = new Map()

for (const rel of ARQUIVOS) {
  const p = path.join(RAIZ, rel)
  if (!fs.existsSync(p)) { falhas.push(`arquivo ausente: ${rel}`); continue }
  let txt = fs.readFileSync(p, 'utf8')

  const jaTem = txt.split(NOVA).length - 1
  const ancoras = txt.split(ANCORA).length - 1

  if (ancoras !== ESPERADO_POR_ARQUIVO) {
    falhas.push(`${rel}: esperava ${ESPERADO_POR_ARQUIVO} chamada(s) de carregarDecisaoCompensacao, achou ${ancoras}`)
    continue
  }
  if (jaTem === ESPERADO_POR_ARQUIVO) { saida.set(rel, txt); continue }   // idempotente
  if (jaTem !== 0) {
    falhas.push(`${rel}: ja tem ${jaTem} chamada(s) da nova — estado a meio caminho, resolva a mao`)
    continue
  }

  // Insere logo DEPOIS da irma, preservando a indentacao daquela linha.
  txt = txt.replace(
    new RegExp(`^([ \\t]*)${ANCORA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gm'),
    (linha, indent) => `${linha}\n${indent}${NOVA}`
  )

  // Import: a nova funcao entra na MESMA linha de import da irma, para nao existir a chance de
  // uma estar importada e a outra nao.
  const impAntes = txt.split('carregarDecisaoCompensacao,').length - 1
  if (impAntes === 1) {
    txt = txt.split('carregarDecisaoCompensacao,').join('carregarDecisaoCompensacao, carregarDecisaoAutorizacaoExtra,')
  } else {
    falhas.push(`${rel}: esperava 1 import de carregarDecisaoCompensacao, achou ${impAntes}`)
    continue
  }

  saida.set(rel, txt)
}

// Conferencia estrutural: as duas chamadas tem que andar sempre em par.
for (const [rel, txt] of saida) {
  const a = txt.split(ANCORA).length - 1
  const b = txt.split(NOVA).length - 1
  if (a !== b) falhas.push(`${rel}: ${a} chamada(s) de compensacao contra ${b} de autorizacao — tem que ser igual`)
  if (b > 0 && !txt.includes('carregarDecisaoAutorizacaoExtra,')) {
    falhas.push(`${rel}: usa carregarDecisaoAutorizacaoExtra e NAO importa`)
  }
}

if (falhas.length) {
  console.error('\nABORTADO - nenhum arquivo foi escrito:\n')
  falhas.forEach((f) => console.error('  x ' + f))
  process.exit(1)
}

if (ENSAIO) {
  console.log('ENSAIO - nada escrito. Arquivos que mudariam:')
  for (const rel of saida.keys()) console.log('  ' + rel)
  process.exit(0)
}

for (const [rel, txt] of saida) fs.writeFileSync(path.join(RAIZ, rel), txt, 'utf8')
console.log(`OK  ${saida.size} arquivo(s), ${ARQUIVOS.length * ESPERADO_POR_ARQUIVO} copias da geracao cobertas`)
