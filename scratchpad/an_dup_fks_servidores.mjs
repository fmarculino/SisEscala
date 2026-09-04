import { U, H } from './an_duplicados.mjs'
const r = await fetch(`${U}/rest/v1/`, { headers: H })
const spec = await r.json()
const alvo = /servidores\.id/
const achados = []
for (const [tab, def] of Object.entries(spec.definitions||{})) {
  for (const [col, c] of Object.entries(def.properties||{})) {
    if (typeof c.description === 'string' && alvo.test(c.description)) achados.push(`${tab}.${col}`)
  }
}
console.log('FKs -> servidores.id (', achados.length, '):')
console.log(achados.join('\n'))
console.log('\ntotal de tabelas expostas:', Object.keys(spec.definitions||{}).length)
