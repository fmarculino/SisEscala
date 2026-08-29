import { q, rpc } from './prodenv.mjs'

const setores = await q('setores?select=id,ativo,unidade_id,dicionario_setores(nome)&order=id')
const unidades = Object.fromEntries((await q('unidades?select=id,nome')).map(u => [u.id, u.nome]))

const tabelas = new Map()   // "tabela.coluna" -> { setores: n, linhas: n }
const porSetor = []
let i = 0
const fila = [...setores]
async function worker() {
  while (fila.length) {
    const s = fila.shift()
    const deps = await rpc('fn_dependencias_setor', { p_setor_id: s.id })
    porSetor.push({ s, deps })
    for (const d of deps) {
      const k = `${d.tabela}.${d.coluna}`
      const cur = tabelas.get(k) || { setores: 0, linhas: 0 }
      cur.setores++; cur.linhas += Number(d.qtd)
      tabelas.set(k, cur)
    }
    if (++i % 100 === 0) process.stderr.write(`${i}/${setores.length}\n`)
  }
}
await Promise.all(Array.from({ length: 8 }, worker))

console.log('=== FKs com uso real (tabela.coluna | setores atingidos | linhas)')
for (const [k, v] of [...tabelas].sort((a, b) => b[1].setores - a[1].setores)) {
  console.log(`  ${k.padEnd(45)} ${String(v.setores).padStart(4)} setores  ${String(v.linhas).padStart(7)} linhas`)
}
const livres = porSetor.filter(x => x.deps.length === 0)
console.log(`\nsetores livres (excluíveis hoje): ${livres.length} de ${setores.length}`)
console.log(`inativos COM vínculo: ${porSetor.filter(x => x.s.ativo === false && x.deps.length).length}`)
console.log(`inativos SEM vínculo: ${porSetor.filter(x => x.s.ativo === false && !x.deps.length).length}`)

console.log('\n=== setores INATIVOS e o que os segura')
for (const x of porSetor.filter(x => x.s.ativo === false)) {
  console.log(`  ${unidades[x.s.unidade_id]} / ${x.s.dicionario_setores?.nome}: ` +
    (x.deps.map(d => `${d.tabela}.${d.coluna}=${d.qtd}`).join(', ') || 'LIVRE'))
}
