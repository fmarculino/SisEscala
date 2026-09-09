import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}` }
async function q(p){ const out=[]; for(let f=0;;f+=1000){
  const r = await fetch(`${U}/rest/v1/${p}`,{headers:{...H, Range:`${f}-${f+999}`}})
  if(!r.ok){ console.error('ERRO',r.status,(await r.text()).slice(0,200)); process.exit(1) }
  const pg = await r.json(); out.push(...pg); if(pg.length<1000) break } return out }
const falhas = await q(`rep_cadastros_fila?select=erro&status=eq.falhou`)
// normaliza: tira IPs, numeros e sessoes
const norm = e => (e||'')
  .replace(/\d+\.\d+\.\d+\.\d+/g,'<IP>').replace(/\b\d{5,}\b/g,'<N>')
  .replace(/session=\w+/g,'session=<S>').slice(0,150)
const c = {}
for (const f of falhas) { const k = norm(f.erro); c[k]=(c[k]||0)+1 }
for (const [k,n] of Object.entries(c).sort((a,b)=>b[1]-a[1])) console.log(`${n.toString().padStart(5)} | ${k}`)
