/**
 * Move o fechamento do modal de confirmacao do CALLBACK para o BOTAO.
 * Padrao do projeto: aborta se a contagem de ocorrencias divergir do esperado.
 * Nao toca em jornadas/page.tsx nem usuarios/UserManagementClient.tsx: esses dois mantem o
 * modal aberto de proposito, com spinner dentro, enquanto a operacao assincrona roda.
 */
const fs = require('fs')

const ALVOS = [
  'src/app/(dashboard)/afastamentos/page.tsx',
  'src/app/(dashboard)/escalas/page.tsx',
  'src/app/(dashboard)/folha-ponto/[id]/FolhaPontoEditor.tsx',
]

const ALVO = 'onClick={confirmModal.onConfirm}'

for (const arquivo of ALVOS) {
  const original = fs.readFileSync(arquivo, 'utf8')
  const ocorrencias = original.split(ALVO).length - 1
  if (ocorrencias !== 1) {
    console.error(`ABORTADO: ${arquivo} tem ${ocorrencias} ocorrencia(s) de "${ALVO}", esperava 1.`)
    process.exit(1)
  }

  // Preserva a indentacao da linha original e o EOL do arquivo (migrations/arquivos CRLF).
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const linhas = original.split(/\r?\n/)
  const idx = linhas.findIndex(l => l.includes(ALVO))
  const ind = linhas[idx].match(/^\s*/)[0]

  const substituto = [
    `${ind}/*`,
    `${ind}  🚨 FECHAR E RESPONSABILIDADE DO BOTAO, NUNCA DO CALLBACK (28/08/2026).`,
    `${ind}  O botao chamava o callback direto, e quem fechava era cada callback, um`,
    `${ind}  por um — em ScaleGrid dois dos oito esqueceram, e o modal de confirmacao ficava na`,
    `${ind}  tela por cima do que o proprio clique acabou de abrir. Fechar aqui e o unico lugar`,
    `${ind}  que nao da para esquecer ao acrescentar um fluxo novo.`,
    `${ind}`,
    `${ind}  ⚠️ A ORDEM IMPORTA: fecha ANTES de executar. React agrupa os setState do mesmo`,
    `${ind}  handler e o ultimo vence, entao um callback que ENCADEIA outra confirmacao continua`,
    `${ind}  funcionando (null -> novo = novo). Invertido, o encadeado seria apagado.`,
    `${ind}*/`,
    `${ind}onClick={() => {`,
    `${ind}  const acao = confirmModal.onConfirm`,
    `${ind}  setConfirmModal(null)`,
    `${ind}  acao?.()`,
    `${ind}}}`,
  ]

  linhas.splice(idx, 1, ...substituto)
  const saida = linhas.join(eol)

  // Conferencia estrutural: a ocorrencia antiga sumiu e a nova entrou exatamente uma vez.
  if (saida.includes(ALVO)) {
    console.error(`ABORTADO: ${arquivo} ainda contem o padrao antigo.`)
    process.exit(1)
  }
  if ((saida.split('setConfirmModal(null)').length - 1) < 1) {
    console.error(`ABORTADO: ${arquivo} ficou sem o fechamento.`)
    process.exit(1)
  }

  fs.writeFileSync(arquivo, saida)
  console.log(`  ok  ${arquivo}`)
}
console.log('\n  3 arquivos reescritos.\n')
