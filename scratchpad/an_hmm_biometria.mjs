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
  if (!r.ok) throw new Error(`${fn} -> ${r.status} ${await r.text()}`)
  return r.json()
}
async function todas(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
    const p = await r.json(); out.push(...p); if (p.length < 1000) break
  }
  return out
}
const disp = JSON.parse(fs.readFileSync('scratchpad/_hmm_disp.json', 'utf8'))
const porNome = Object.fromEntries(disp.map(d => [d.nome, d]))
const snap = {}
for (const n of ['REP-iDClass-HMM-01','REP-iDClass-HMM-02','REP-iDClass-HMM-03'])
  snap[n] = JSON.parse(fs.readFileSync(`scratchpad/_snap_${n.slice(-6)}.json`, 'utf8'))

// conjuntos por servidor_id
const set = n => new Map(snap[n].map(l => [l.servidor_id, l]))
const s1 = set('REP-iDClass-HMM-01'), s3 = set('REP-iDClass-HMM-03')
const so1 = [...s1.keys()].filter(k => !s3.has(k))
const so3 = [...s3.keys()].filter(k => !s1.has(k))
console.log(`=== conjuntos (por servidor_id) ===`)
console.log(`so no HMM-01/02: ${so1.length}   so no HMM-03: ${so3.length}   em ambos: ${[...s1.keys()].filter(k=>s3.has(k)).length}`)
const semDigNo3MasCom1 = [...s1.entries()].filter(([k,v]) => v.tem_biometria && s3.has(k) && !s3.get(k).tem_biometria)
const semDigNo1MasCom3 = [...s3.entries()].filter(([k,v]) => v.tem_biometria && s1.has(k) && !s1.get(k).tem_biometria)
console.log(`tem digital no 01 e NAO no 03: ${semDigNo3MasCom1.length}`)
console.log(`tem digital no 03 e NAO no 01: ${semDigNo1MasCom3.length}`)

console.log('\n=== fn_biometria_faltante_dispositivo ===')
for (const d of disp) {
  try {
    const p = await rpc('fn_biometria_faltante_dispositivo', { p_dispositivo_id: d.id })
    const origens = {}
    for (const x of p) origens[x.origem_nome] = (origens[x.origem_nome] || 0) + 1
    console.log(`${d.nome.padEnd(22)} pendentes=${String(p.length).padStart(4)}  origens=${JSON.stringify(origens)}`)
    if (p.length) fs.writeFileSync(`scratchpad/_pend_${d.nome.slice(-6)}.json`, JSON.stringify(p, null, 2))
  } catch (e) { console.log(`${d.nome.padEnd(22)} ERRO: ${e.message.slice(0, 200)}`) }
}

console.log('\n=== rep_biometria_copias (ultimas 24h) ===')
const ontem = new Date(Date.now() - 24*3600*1000).toISOString()
const copias = await todas(`rep_biometria_copias?created_at=gte.${ontem}&select=*&order=created_at.desc`)
const porDest = {}
for (const c of copias) {
  const k = `${(disp.find(d=>d.id===c.dispositivo_destino_id)||{}).nome || c.dispositivo_destino_id} ${c.sucesso ? 'ok' : 'FALHA'}`
  porDest[k] = (porDest[k] || 0) + 1
}
console.log(JSON.stringify(porDest, null, 1))
const falhas = copias.filter(c => !c.sucesso).slice(0, 5)
for (const f of falhas) console.log('falha:', (f.erro||'').slice(0,180))

console.log('\n=== rep_administradores_parque ===')
const admins = await todas('rep_administradores_parque?select=*')
console.log(`total=${admins.length}`)
for (const a of admins) {
  const sv = await fetch(`${U}/rest/v1/servidores?id=eq.${a.servidor_id}&select=nome,matricula,cpf,pis_pasep`, { headers: H }).then(r=>r.json())
  console.log(` ${sv[0]?.nome} (mat ${sv[0]?.matricula})  dispositivo_ponto=${(disp.find(d=>d.id===a.dispositivo_ponto_id)||{}).nome || a.dispositivo_ponto_id}  motivo=${a.motivo}`)
  for (const n of ['REP-iDClass-HMM-01','REP-iDClass-HMM-02','REP-iDClass-HMM-03']) {
    const l = snap[n].find(x => x.servidor_id === a.servidor_id)
    console.log(`   ${n}: ${l ? `cadastrado ident=${l.identificador_afd} digital=${l.tem_biometria}` : 'NAO CADASTRADO'}`)
  }
}
