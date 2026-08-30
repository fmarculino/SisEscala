// Segundo passo do achado 6: tirar o `.join('')` que desfaz a marcacao, e marcar com raw() os
// fragmentos HTML escritos no codigo.
//
// POR QUE O `.join('')` PRECISA SAIR
//   `itens.map(i => h`...`)` devolve HtmlSeguro[]. O `.join('')` transforma isso numa STRING
//   comum — perdendo a marca —, e o literal externo passa a ESCAPAR aquele HTML. O relatorio
//   nao fica inseguro: fica com as tags visiveis como texto. `h` ja concatena array, entao o
//   join virou ruido.
//
// ⚠️ Este e o modo de falha VISIVEL do desenho (ver src/utils/htmlSeguro.ts): esquecer aqui
// estraga a aparencia, nunca a seguranca. E o oposto de esquecer um escape.
const fs = require('fs')

function exigir(c, m) { if (!c) { console.error('ABORTADO: ' + m); process.exit(1) } }

// ── 1) `.join('')` colado num literal marcado: `).join('')  ->  `)
const ARQUIVOS = [
  'src/app/(dashboard)/afastamentos/page.tsx',
  'src/app/(dashboard)/auditoria/page.tsx',
  'src/app/(dashboard)/folha-ponto/page.tsx',
  'src/app/(dashboard)/servidores/ServidoresClient.tsx',
  'src/utils/report-templates.ts',
]

const ESPERADO_JOIN = 13
let totalJoin = 0

for (const caminho of ARQUIVOS) {
  let s = fs.readFileSync(caminho, 'utf8')
  const antes = (s.match(/\.join\(''\)/g) || []).length
  // Remove SO o `.join('')`; nao toca em `.join(', ')` nem em join de outra coisa.
  s = s.replace(/\.join\(''\)/g, '')
  const depois = (s.match(/\.join\(''\)/g) || []).length
  exigir(depois === 0, `sobrou .join('') em ${caminho}`)
  totalJoin += antes
  fs.writeFileSync(caminho, s, 'utf8')
  if (antes) console.log(`  ${String(antes).padStart(2)} .join('') removidos  ${caminho}`)
}

exigir(totalJoin === ESPERADO_JOIN,
  `esperava ${ESPERADO_JOIN} ocorrencias de .join(''), achei ${totalJoin}`)

// ── 2) fragmentos HTML escritos no codigo: envolver em raw()
const FRAGMENTOS = [
  ['src/app/(dashboard)/servidores/ServidoresClient.tsx',
   `\${servidor.ignora_janela_presenca ? '<span class="text-[8px] font-bold text-amber-700 bg-amber-100 px-1 py-0.2 rounded border border-amber-300 ml-1">HORÁRIO LIVRE</span>' : ''}`,
   `\${servidor.ignora_janela_presenca ? raw('<span class="text-[8px] font-bold text-amber-700 bg-amber-100 px-1 py-0.2 rounded border border-amber-300 ml-1">HORÁRIO LIVRE</span>') : ''}`],

  ['src/utils/report-templates.ts',
   `\${config.draft ? '<div class="watermark no-print" style="opacity: 0.035;">PREVISÃO</div><div class="watermark hidden print:block">PREVISÃO</div>' : ''}`,
   `\${config.draft ? raw('<div class="watermark no-print" style="opacity: 0.035;">PREVISÃO</div><div class="watermark hidden print:block">PREVISÃO</div>') : ''}`],

  ['src/utils/report-templates.ts',
   `\${config.draft ? '<span class="text-[9px] font-black uppercase tracking-wider bg-amber-500 text-zinc-950 px-2 py-0.5 rounded">Previsão</span>' : ''}`,
   `\${config.draft ? raw('<span class="text-[9px] font-black uppercase tracking-wider bg-amber-500 text-zinc-950 px-2 py-0.5 rounded">Previsão</span>') : ''}`],
]

for (const [caminho, antigo, novo] of FRAGMENTOS) {
  const s = fs.readFileSync(caminho, 'utf8')
  const n = s.split(antigo).length - 1
  exigir(n === 1, `esperava 1 ocorrencia do fragmento em ${caminho}, achei ${n}`)
  fs.writeFileSync(caminho, s.replace(antigo, () => novo), 'utf8')
}
console.log(`  ${FRAGMENTOS.length} fragmentos HTML marcados com raw()`)

// ── 3) Conferencia final: nenhum literal HTML pode ter ficado SEM a tag `h`
//    (o script anterior ja marcou; aqui e' a rede de seguranca contra edicao manual)
for (const caminho of ARQUIVOS) {
  const s = fs.readFileSync(caminho, 'utf8')
  exigir(s.includes("from '@/utils/htmlSeguro'"), `${caminho} sem o import de htmlSeguro`)
}

// ── 4) raw() so pode aparecer com STRING LITERAL dentro. raw(variavel) e' o caminho de volta
//    para o achado 6, e passaria despercebido.
const RE_RAW = /\braw\(\s*([^)]*)/g
let suspeitos = 0
for (const caminho of ARQUIVOS) {
  const s = fs.readFileSync(caminho, 'utf8')
  let m
  while ((m = RE_RAW.exec(s))) {
    const arg = m[1].trim()
    if (!/^['"]/.test(arg)) {
      console.error(`  ⚠️ raw() com argumento NAO-literal em ${caminho}: ${arg.slice(0, 60)}`)
      suspeitos++
    }
  }
}
exigir(suspeitos === 0, `${suspeitos} uso(s) de raw() com variavel - cada um e um XSS em potencial`)

console.log('\nOK: join removido, fragmentos marcados, nenhum raw() com variavel.')
