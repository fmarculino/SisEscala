import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const D = '19454bce-aa64-45af-865f-df2b18e0a205'

async function q(path, extra = {}) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, ...extra } })
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
  return r.json()
}
async function pag(path) {
  const out = []
  for (let f = 0; ; f += 1000) {
    const p = await q(path, { Range: `${f}-${f + 999}` })
    out.push(...p)
    if (p.length < 1000) break
  }
  return out
}
async function rpc(fn, body) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  return { ok: r.ok, status: r.status, body: await r.text() }
}

// 1) NSRs presentes acima de 130000
const regs = await pag(`rep_afd_registros?select=nsr,tipo_registro,ocorrido_em,recebido_em&dispositivo_id=eq.${D}&nsr=gte.130000&order=nsr`)
console.log(`registros >=130000: ${regs.length}`)
const nsrs = regs.map(r => Number(r.nsr)).sort((a,b)=>a-b)
console.log(`min=${nsrs[0]} max=${nsrs[nsrs.length-1]}`)
// lacunas
const gaps = []
for (let i = 1; i < nsrs.length; i++) {
  if (nsrs[i] !== nsrs[i-1] + 1) gaps.push([nsrs[i-1]+1, nsrs[i]-1])
}
console.log('lacunas:', JSON.stringify(gaps))

// 2) cursor
const cur = await rpc('fn_cursor_afd_dispositivo', { p_dispositivo_id: D })
console.log('cursor:', cur.status, cur.body)

// 3) sincronizacoes recentes
const sync = await q(`rep_sincronizacoes?select=*&dispositivo_id=eq.${D}&order=criado_em.desc&limit=25`)
console.log('\n=== SINCRONIZACOES RECENTES HMI-01 ===')
for (const s of sync) console.log(JSON.stringify(s))
