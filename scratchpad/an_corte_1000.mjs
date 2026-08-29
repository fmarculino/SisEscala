/** LEITURA de producao (autorizada). getEventosPendentes pagina escala_mensal/escala_diaria? */
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function todas(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from+999}` } })
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
    const p = await r.json(); out.push(...p); if (p.length < 1000) break
  }
  return out
}

const unidades = await todas('unidades?select=id,nome')
const nomeU = new Map(unidades.map(u => [u.id, u.nome]))

for (const [mes, ano] of [[8, 2026], [9, 2026]]) {
  const em = await todas(`escala_mensal?select=id,unidade_id&mes=eq.${mes}&ano=eq.${ano}`)
  const emIds = new Set(em.map(e => e.id))
  const unidDeEm = new Map(em.map(e => [e.id, e.unidade_id]))
  const ed = await todas(`escala_diaria?select=id,escala_mensal_id,categoria`)
  const doMes = ed.filter(d => emIds.has(d.escala_mensal_id))

  const porUnid = new Map()
  for (const d of doMes) {
    const u = unidDeEm.get(d.escala_mensal_id)
    porUnid.set(u, (porUnid.get(u) ?? 0) + 1)
  }
  console.log(`\n=== ${String(mes).padStart(2,'0')}/${ano}: escala_diaria por unidade (a query da fila NAO pagina) ===`)
  console.log(`  escala_mensal no mes: ${em.length}  |  escala_diaria no mes: ${doMes.length}`)
  const linhas = [...porUnid.entries()].sort((a, b) => b[1] - a[1])
  for (const [u, n] of linhas) {
    const flag = n > 1000 ? '  <<< CORTADO EM 1000' : ''
    console.log(`   ${String(n).padStart(6)}  ${String(nomeU.get(u) ?? u).slice(0,44).padEnd(46)}${flag}`)
  }
  const cortadas = linhas.filter(([, n]) => n > 1000)
  console.log(`  unidades acima de 1000 linhas: ${cortadas.length}`)
  console.log(`  TOTAL com "Todas as Unidades": ${doMes.length} ${doMes.length > 1000 ? '<<< CORTADO' : ''}`)
}
