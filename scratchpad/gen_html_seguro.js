// Marca com a tag `h` todo template literal que monta HTML nos geradores de relatorio.
//
// ⚠️ NAO usa regex para achar os literais. Template literal do JS ANINHA (`${ ... `outro` ... }`),
// e regex nao conta profundidade — pegaria o pedaco errado e produziria arquivo que nem compila.
// Aqui vai um scanner que rastreia aspas, comentarios e a profundidade de `${}`.
//
// O QUE ELE FAZ: acha os literais que contem marcacao HTML e insere `h` antes da crase de
// abertura. O CONTEUDO do literal nao muda em nenhum caractere — o escape passa a acontecer em
// tempo de execucao, dentro de `h`.
//
// Roda:  node scratchpad/gen_html_seguro.js [--aplicar]
// Sem --aplicar, so relata.
const fs = require('fs')

const ALVOS = [
  'src/app/(dashboard)/auditoria/page.tsx',
  'src/app/(dashboard)/afastamentos/page.tsx',
  'src/app/(dashboard)/folha-ponto/page.tsx',
  'src/app/(dashboard)/servidores/ServidoresClient.tsx',
  'src/utils/report-templates.ts',
]

const APLICAR = process.argv.includes('--aplicar')
const TEM_HTML = /<\s*\/?\s*(?:!DOCTYPE|html|head|body|div|table|thead|tbody|tr|td|th|span|p|h[1-6]|style|script|img|br|hr|section|header|footer|strong|em|b|i|ul|ol|li)\b/i

/**
 * Varre o arquivo e devolve os template literals, com posicao e profundidade de aninhamento.
 * Reconhece: '...' "..." `...` /*...* / //... e a recursao de `${ }`.
 */
function acharTemplates(src) {
  const achados = []

  function varrer(ini, fim, prof) {
    let i = ini
    while (i < fim) {
      const c = src[i]

      // comentarios
      if (c === '/' && src[i + 1] === '/') { while (i < fim && src[i] !== '\n') i++; continue }
      if (c === '/' && src[i + 1] === '*') { i += 2; while (i < fim && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }

      // strings comuns
      if (c === "'" || c === '"') {
        const q = c; i++
        while (i < fim && src[i] !== q) { if (src[i] === '\\') i++; i++ }
        i++; continue
      }

      // template literal
      if (c === '`') {
        const inicio = i
        i++
        let temHtml = false
        while (i < fim) {
          if (src[i] === '\\') { i += 2; continue }
          if (src[i] === '`') break
          if (src[i] === '$' && src[i + 1] === '{') {
            // acha o fecha correspondente contando chaves, e recursa la dentro
            let d = 1, j = i + 2
            while (j < fim && d > 0) {
              const ch = src[j]
              if (ch === '\\') { j += 2; continue }
              if (ch === "'" || ch === '"') { const q = ch; j++; while (j < fim && src[j] !== q) { if (src[j] === '\\') j++; j++ } j++; continue }
              if (ch === '`') { // literal aninhado: deixa a recursao tratar
                let d2 = 0, k = j + 1
                while (k < fim) {
                  if (src[k] === '\\') { k += 2; continue }
                  if (src[k] === '`' && d2 === 0) break
                  if (src[k] === '$' && src[k + 1] === '{') { d2++; k += 2; continue }
                  if (src[k] === '}' && d2 > 0) { d2--; k++; continue }
                  k++
                }
                j = k + 1; continue
              }
              if (ch === '{') d++
              if (ch === '}') d--
              j++
            }
            varrer(i + 2, j - 1, prof + 1)   // recursa DENTRO da interpolacao
            i = j
            continue
          }
          i++
        }
        const conteudo = src.slice(inicio, i + 1)
        if (TEM_HTML.test(conteudo)) achados.push({ inicio, fim: i + 1, prof, tamanho: conteudo.length })
        i++
        continue
      }

      i++
    }
  }

  varrer(0, src.length, 0)
  return achados.sort((a, b) => a.inicio - b.inicio)
}

let totalLiterais = 0
const relatorio = []

for (const caminho of ALVOS) {
  if (!fs.existsSync(caminho)) { console.log(`(ausente) ${caminho}`); continue }
  let src = fs.readFileSync(caminho, 'utf8')
  const eol = src.includes('\r\n') ? '\r\n' : '\n'

  if (src.includes("from '@/utils/htmlSeguro'")) {
    console.log(`(ja transformado) ${caminho}`)
    continue
  }

  const templates = acharTemplates(src)
  // Nao marcar literal que ja tenha tag imediatamente antes (nenhum tem hoje, mas o script
  // precisa ser reexecutavel sem duplicar).
  const marcar = templates.filter(t => {
    const antes = src.slice(Math.max(0, t.inicio - 2), t.inicio)
    return !/\bh$/.test(antes)
  })

  totalLiterais += marcar.length
  relatorio.push({ caminho, quantos: marcar.length, maior: Math.max(...marcar.map(t => t.tamanho), 0) })

  if (!APLICAR) continue

  // insere de tras pra frente, para os indices nao se moverem
  for (const t of [...marcar].reverse()) {
    src = src.slice(0, t.inicio) + 'h' + src.slice(t.inicio)
  }

  // import logo apos o ultimo import do arquivo. `report-templates.ts` nao tem import nenhum —
  // nesse caso o import vai para o topo, antes de qualquer declaracao.
  const linhas = src.split(eol)
  const ultimoImport = linhas.reduce((acc, l, i) => (/^import /.test(l) ? i : acc), -1)
  if (ultimoImport >= 0) {
    linhas.splice(ultimoImport + 1, 0, "import { h, raw } from '@/utils/htmlSeguro'")
  } else {
    const primeiraUtil = linhas.findIndex(l => l.trim() !== '' && !l.trim().startsWith('//'))
    linhas.splice(Math.max(primeiraUtil, 0), 0, "import { h, raw } from '@/utils/htmlSeguro'", '')
  }
  src = linhas.join(eol)

  fs.writeFileSync(caminho, src, 'utf8')
}

console.log(APLICAR ? 'APLICADO:' : 'ENSAIO (use --aplicar para gravar):')
for (const r of relatorio) {
  console.log(`  ${String(r.quantos).padStart(2)} literais HTML  (maior: ${r.maior} chars)  ${r.caminho}`)
}
console.log(`  ---`)
console.log(`  ${totalLiterais} literais marcados com a tag h`)
console.log('')
console.log('FALTA A MAO depois disso:')
console.log('  1. `.join(\'\')` sobre array de literais marcados: tirar o join e deixar `h` juntar,')
console.log('     senao o array vira string e o literal externo a escapa.')
console.log('  2. ternario que devolve fragmento HTML (ex.: `? \'<span ...>\' : \'\'`): envolver em raw().')
console.log('  3. `document.write(x)` passa a receber HtmlSeguro: usar String(x).')
