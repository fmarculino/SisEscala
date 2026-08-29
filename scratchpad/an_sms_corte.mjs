import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
const EVENTO = c => { const s=String(c||'').toLowerCase(); return s.includes('extra')||s.includes('plant')||s.includes('sobreaviso') }
const j = async (url, range) => {
  const r = await fetch(url, { headers: range ? {...H, Range: range} : H })
  const t = await r.text()
  return { ok: r.ok, status: r.status, body: r.ok ? JSON.parse(t) : t.slice(0,40) }
}

const un = await (await fetch(`${U}/rest/v1/unidades?select=id,nome`, {headers:H})).json()
console.log('mes/ano  unidade                      esc.mensal  urlLen  UMA-REQUISICAO           paginado+chunk')
console.log('-'.repeat(104))
for (const [mes, ano] of [[8,2026],[9,2026]]) {
  for (const u of un) {
    const em = await (await fetch(`${U}/rest/v1/escala_mensal?select=id&unidade_id=eq.${u.id}&mes=eq.${mes}&ano=eq.${ano}`, {headers:H})).json()
    if (!em?.length) continue
    const ids = em.map(e => e.id)
    const url1 = `${U}/rest/v1/escala_diaria?select=categoria&escala_mensal_id=in.(${ids.join(',')})&order=dia.asc`
    const r1 = await j(url1)
    // Correto: chunk de ids + paginacao de cada chunk
    let ok = []
    for (let i=0;i<ids.length;i+=120){
      const lote = ids.slice(i,i+120)
      const urlL = `${U}/rest/v1/escala_diaria?select=categoria&escala_mensal_id=in.(${lote.join(',')})&order=dia.asc`
      for (let f=0;;f+=1000){ const p = await j(urlL, `${f}-${f+999}`); if(!p.ok) throw new Error(p.body); ok.push(...p.body); if(p.body.length<1000) break }
    }
    const antes = r1.ok ? `${String(r1.body.length).padStart(5)} lin / ${String(r1.body.filter(d=>EVENTO(d.categoria)).length).padStart(4)} ev` : `HTTP ${r1.status} ${r1.body}`.padEnd(24)
    const depois = `${String(ok.length).padStart(5)} lin / ${String(ok.filter(d=>EVENTO(d.categoria)).length).padStart(4)} ev`
    const marca = (!r1.ok || r1.body.length !== ok.length) ? '  <<<' : ''
    console.log(`${String(mes).padStart(2,'0')}/${ano}  ${String(u.nome).slice(0,26).padEnd(28)}${String(ids.length).padStart(9)}${String(url1.length).padStart(8)}  ${antes.padEnd(24)} ${depois}${marca}`)
  }
}
