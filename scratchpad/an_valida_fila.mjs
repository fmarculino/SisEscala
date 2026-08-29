/** Reproduz a busca CORRIGIDA (lote de 120 ids + paginacao) contra producao. */
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
const IDS_POR_LOTE = 120
const EVENTO = c => { const s=String(c||'').toLowerCase(); return s.includes('extra')||s.includes('plant')||s.includes('sobreaviso') }

async function paginar(url) {
  const out = []
  for (let f=0;;f+=1000){
    const r = await fetch(url, { headers: {...H, Range: `${f}-${f+999}`} })
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${url.slice(0,80)}`)
    const p = await r.json(); out.push(...p); if (p.length < 1000) break
  }
  return out
}
async function porLotes(ids, montar) {
  const out = []
  for (let i=0;i<ids.length;i+=IDS_POR_LOTE) out.push(...await paginar(montar(ids.slice(i,i+IDS_POR_LOTE))))
  return out
}

const un = await (await fetch(`${U}/rest/v1/unidades?select=id,nome`, {headers:H})).json()
let maiorUrl = 0

for (const [mes,ano] of [[8,2026],[9,2026]]) {
  // MODO "TODAS AS UNIDADES" — o caso novo, e o mais pesado que existe.
  const em = await paginar(`${U}/rest/v1/escala_mensal?select=id,unidade_id&mes=eq.${mes}&ano=eq.${ano}`)
  const ids = em.map(e => e.id)
  const t0 = Date.now()
  const ed = await porLotes(ids, l => {
    const u = `${U}/rest/v1/escala_diaria?select=id,categoria,escala_mensal_id&escala_mensal_id=in.(${l.join(',')})&order=dia.asc`
    maiorUrl = Math.max(maiorUrl, u.length); return u
  })
  const ms = Date.now() - t0
  const eventos = ed.filter(d => EVENTO(d.categoria))
  console.log(`${String(mes).padStart(2,'0')}/${ano}  TODAS AS UNIDADES: ${String(ids.length).padStart(4)} escala_mensal, ${String(ed.length).padStart(6)} escala_diaria, ${String(eventos.length).padStart(5)} eventos  (${ms} ms)`)
}

console.log(`\nMaior URL gerada: ${maiorUrl} chars  ${maiorUrl < 8000 ? '(dentro do limite de 8 KB)' : '<<< ACIMA DE 8 KB'}`)

// As duas unidades que davam 414, agora por unidade.
for (const [mes,ano,alvo] of [[8,2026,'SMS'],[9,2026,'HMI']]) {
  const u = un.find(x => (x.nome||'').includes(alvo))
  const em = await paginar(`${U}/rest/v1/escala_mensal?select=id&unidade_id=eq.${u.id}&mes=eq.${mes}&ano=eq.${ano}`)
  const ed = await porLotes(em.map(e=>e.id), l => `${U}/rest/v1/escala_diaria?select=categoria&escala_mensal_id=in.(${l.join(',')})&order=dia.asc`)
  console.log(`${String(mes).padStart(2,'0')}/${ano}  ${alvo.padEnd(4)} (dava HTTP 414): ${ed.length} linhas, ${ed.filter(d=>EVENTO(d.categoria)).length} eventos — carrega`)
}
