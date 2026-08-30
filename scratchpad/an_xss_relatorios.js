// Inventario das interpolacoes que entram nos 5 geradores de relatorio HTML.
//
// O RISCO DOS DOIS LADOS
//   Nao escapar texto do banco = XSS armazenado (achado 6): o `window.open('')` abre
//   about:blank, que HERDA a origem da aplicacao, entao script injetado roda com a sessao de
//   quem imprimiu o relatorio.
//   Escapar o que ja e HTML GERADO (tableRows, content) = relatorio sai como codigo-fonte na
//   tela. Este script separa os dois antes de qualquer alteracao.
const fs = require('fs')

const ALVOS = [
  ['src/app/(dashboard)/afastamentos/page.tsx', 'reportHtml'],
  ['src/app/(dashboard)/auditoria/page.tsx', 'reportHtml'],
  ['src/app/(dashboard)/folha-ponto/page.tsx', 'printHTML'],
  ['src/app/(dashboard)/servidores/ServidoresClient.tsx', 'reportHtml'],
  ['src/utils/report-templates.ts', '(varios)'],
]

// Heuristica de classificacao. NAO decide sozinha: imprime para conferencia humana.
const PARECE_HTML = /(?:^|\b)(?:tableRows|rows|content|linhas|html|Html|HTML|body|corpo|itens|blocos)$/
const PARECE_NUMERO = /\.(?:length|size)$|^\d|count|total|Total|qtd|Qtd/

function interpolacoes(txt) {
  const out = []
  const re = /\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g
  let m
  while ((m = re.exec(txt))) out.push(m[1].trim())
  return out
}

let totalTexto = 0, totalHtml = 0, totalOutro = 0

for (const [caminho, nomeVar] of ALVOS) {
  if (!fs.existsSync(caminho)) { console.log(`(ausente) ${caminho}`); continue }
  const src = fs.readFileSync(caminho, 'utf8')

  // pega TODOS os template literals do arquivo que contenham marcacao HTML
  const literais = []
  const re = /`(?:[^`\\]|\\.)*`/gs
  let m
  while ((m = re.exec(src))) {
    const t = m[0]
    if (/<(?:div|td|th|tr|table|p|span|h[1-6]|body|html|style)\b/i.test(t)) literais.push(t)
  }

  const todas = literais.flatMap(interpolacoes)
  const unicas = [...new Set(todas)]

  const texto = [], htmlGerado = [], outro = []
  for (const i of unicas) {
    const base = i.split(/[?.]/).pop() || i
    if (PARECE_HTML.test(i) || PARECE_HTML.test(base)) htmlGerado.push(i)
    else if (PARECE_NUMERO.test(i)) outro.push(i)
    else texto.push(i)
  }

  totalTexto += texto.length; totalHtml += htmlGerado.length; totalOutro += outro.length

  console.log(`\n${'='.repeat(78)}`)
  console.log(`${caminho}   (${literais.length} literais HTML, ${todas.length} interpolacoes, ${unicas.length} distintas)`)
  console.log('='.repeat(78))

  console.log(`\n  NAO ESCAPAR — parece HTML ja gerado (${htmlGerado.length}):`)
  for (const i of htmlGerado) console.log(`     ${i}`)

  console.log(`\n  provavelmente numero/contagem, inofensivo (${outro.length}):`)
  for (const i of outro) console.log(`     ${i}`)

  console.log(`\n  ⚠️ ESCAPAR — texto que pode vir do banco (${texto.length}):`)
  for (const i of texto) console.log(`     ${i}`)
}

console.log(`\n${'='.repeat(78)}`)
console.log(`TOTAL: ${totalTexto} a escapar | ${totalHtml} a preservar como HTML | ${totalOutro} numericas`)
console.log('='.repeat(78))
