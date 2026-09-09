// SOMENTE LEITURA. Mede quantos pares (dispositivo, servidor) estao reprovados HOJE e quantos
// deles seriam liberados pelo criterio "falha de TRANSPORTE nao reprova".
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function q(p){ const out=[]; for(let f=0;;f+=1000){
  const r = await fetch(`${U}/rest/v1/${p}`,{headers:{...H, Range:`${f}-${f+999}`}})
  if(!r.ok){ console.error('ERRO',r.status,(await r.text()).slice(0,200)); process.exit(1) }
  const pg = await r.json(); out.push(...pg); if(pg.length<1000) break } return out }
async function rpc(f,b){ const r = await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)})
  if(!r.ok){ console.error('RPC',f,r.status,(await r.text()).slice(0,200)); return null } return r.json() }

// mesmo criterio que a migration vai usar
const ehTransporte = e => {
  const m = (e||'')
  if (/recusou/i.test(m)) return false
  return /^Post "http/i.test(m) || /connectex|dial tcp|read tcp|wsarecv|wsasend|i\/o timeout|deadline exceeded|Client\.Timeout|connection reset|no such host|network is unreachable/i.test(m)
}

const nomes = Object.fromEntries((await q(`dispositivos_rep?select=id,nome`)).map(d=>[d.id,d.nome]))
const falhas = await q(`rep_cadastros_fila?select=dispositivo_id,servidor_id,erro,processado_em,created_at&status=eq.falhou`)
const pares = new Map()
for (const f of falhas) {
  const k = `${f.dispositivo_id}|${f.servidor_id}`
  const t = f.processado_em || f.created_at
  const cur = pares.get(k)
  if (!cur || t > cur.t) pares.set(k, { t, erro: f.erro, d: f.dispositivo_id, s: f.servidor_id })
}
console.log(`pares (dispositivo, servidor) com alguma falha: ${pares.size}`)

let reprovados = 0, liberadosPorTransporte = 0, continuamReprovados = 0
const porDisp = {}
let i = 0
for (const [, v] of pares) {
  i++
  const r = await rpc('fn_cadastro_rep_reprovado', { p_dispositivo_id: v.d, p_servidor_id: v.s })
  if (r !== true) continue
  reprovados++
  if (ehTransporte(v.erro)) {
    liberadosPorTransporte++
    porDisp[nomes[v.d]] = (porDisp[nomes[v.d]]||0)+1
  } else continuamReprovados++
}
console.log(`\nreprovados HOJE: ${reprovados}`)
console.log(`  liberados pelo criterio de TRANSPORTE: ${liberadosPorTransporte}`)
console.log(`  continuam reprovados (recusa legitima do equipamento): ${continuamReprovados}`)
console.log('\nliberados por dispositivo:')
for (const [n,c] of Object.entries(porDisp).sort((a,b)=>b[1]-a[1])) console.log(`${c.toString().padStart(5)}  ${n}`)
