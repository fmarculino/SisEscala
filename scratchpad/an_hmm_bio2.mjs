import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
async function rpc(fn, body) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${fn} -> ${r.status} ${(await r.text()).slice(0,200)}`)
  return r.json()
}
async function todas(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${(await r.text()).slice(0,200)}`)
    const p = await r.json(); out.push(...p); if (p.length < 1000) break
  }
  return out
}
const disp = JSON.parse(fs.readFileSync('scratchpad/_hmm_disp.json', 'utf8'))
console.log('=== fn_biometria_faltante_dispositivo (p_destino_id) ===')
for (const d of disp) {
  const p = await rpc('fn_biometria_faltante_dispositivo', { p_destino_id: d.id })
  const origens = {}
  for (const x of p) origens[x.origem_nome] = (origens[x.origem_nome] || 0) + 1
  console.log(`${d.nome.padEnd(22)} pendentes=${String(p.length).padStart(4)}  origens=${JSON.stringify(origens)}`)
}
console.log('\n=== rep_biometria_copias: colunas ===')
const uma = await fetch(`${U}/rest/v1/rep_biometria_copias?select=*&limit=1`, { headers: H }).then(r=>r.json())
console.log(Object.keys(uma[0] || {}).join(', '))
const ontem = new Date(Date.now() - 24*3600*1000).toISOString()
const cols = Object.keys(uma[0] || {})
const campoData = cols.find(c => /created_at|copiado_em|registrado_em|tentado_em/.test(c)) || 'id'
const copias = await todas(`rep_biometria_copias?${campoData}=gte.${ontem}&select=*&order=${campoData}.desc`)
console.log(`\n=== copias nas ultimas 24h: ${copias.length} ===`)
const nomeDisp = Object.fromEntries(disp.map(d => [d.id, d.nome]))
const agr = {}
for (const c of copias) {
  const dest = nomeDisp[c.dispositivo_id || c.dispositivo_destino_id || c.destino_id] || (c.dispositivo_id || c.dispositivo_destino_id || c.destino_id || '?').slice(0,8)
  const k = `${dest} ${c.sucesso ? 'ok' : 'FALHA'}`
  agr[k] = (agr[k] || 0) + 1
}
console.log(JSON.stringify(agr, null, 1))
const falhas = copias.filter(c => c.sucesso === false)
const msgs = {}
for (const f of falhas) { const m = (f.erro || f.mensagem_erro || '(sem mensagem)').slice(0,140); msgs[m] = (msgs[m]||0)+1 }
console.log('\nmensagens de falha:'); console.log(JSON.stringify(msgs, null, 1))
