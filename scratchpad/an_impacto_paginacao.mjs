/** LEITURA de producao (autorizada). Quanto a fila deixava de ver, por unidade, em 08 e 09/2026. */
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }

const get = async (path, range) => {
  const h = range ? { ...H, Range: range } : H
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: h })
  if (!r.ok) throw new Error(`${path} -> ${r.status}`)
  return r.json()
}
async function todas(path) {
  const out = []
  for (let f = 0; ; f += 1000) { const p = await get(path, `${f}-${f+999}`); out.push(...p); if (p.length < 1000) break }
  return out
}
const EVENTO = c => { const s = String(c||'').toLowerCase(); return s.includes('extra') || s.includes('plant') || s.includes('sobreaviso') }

const unidades = await todas('unidades?select=id,nome')
const nomeU = new Map(unidades.map(u => [u.id, u.nome]))

for (const [mes, ano] of [[8, 2026], [9, 2026]]) {
  console.log(`\n=== ${String(mes).padStart(2,'0')}/${ano} — EVENTOS (Extra/Plantao/Sobreaviso) que a fila mostrava ===`)
  console.log('  unidade'.padEnd(48) + 'ANTES'.padStart(8) + 'DEPOIS'.padStart(8) + 'PERDIDOS'.padStart(10))
  console.log('  ' + '-'.repeat(72))
  let tA = 0, tD = 0
  for (const u of unidades) {
    const em = await todas(`escala_mensal?select=id&unidade_id=eq.${u.id}&mes=eq.${mes}&ano=eq.${ano}`)
    if (!em.length) continue
    const ids = em.map(e => e.id)
    // A fila monta `.in(escala_mensal_id, ids)` com order dia asc. Reproduzo em lotes de 150
    // ids para nao estourar o tamanho da URL, somando as paginas (DEPOIS) e cortando (ANTES).
    let depois = 0, antes = 0
    for (let i = 0; i < ids.length; i += 150) {
      const lote = ids.slice(i, i + 150)
      const q = `escala_diaria?select=categoria&escala_mensal_id=in.(${lote.join(',')})&order=dia.asc`
      const todasL = await todas(q)
      depois += todasL.filter(d => EVENTO(d.categoria)).length
    }
    // "ANTES" = uma unica requisicao sem Range sobre TODOS os ids (o que o codigo fazia).
    const q1 = `escala_diaria?select=categoria&escala_mensal_id=in.(${ids.join(',')})&order=dia.asc`
    try { antes = (await get(q1)).filter(d => EVENTO(d.categoria)).length } catch { antes = NaN }
    tA += antes; tD += depois
    const perdidos = depois - antes
    if (perdidos > 0) {
      console.log('  ' + String(nomeU.get(u.id)).slice(0,44).padEnd(48) + String(antes).padStart(8) + String(depois).padStart(8) + String(perdidos).padStart(10) + '  <<<')
    }
  }
  console.log('  ' + 'TOTAL'.padEnd(48) + String(tA).padStart(8) + String(tD).padStart(8) + String(tD - tA).padStart(10))
}
