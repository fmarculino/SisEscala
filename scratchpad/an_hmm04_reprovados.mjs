import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function q(p){ const out=[]; for(let f=0;;f+=1000){
  const r = await fetch(`${U}/rest/v1/${p}`,{headers:{...H, Range:`${f}-${f+999}`}})
  if(!r.ok){ console.error('ERRO',p,r.status,(await r.text()).slice(0,300)); process.exit(1) }
  const pg = await r.json(); out.push(...pg); if(pg.length<1000) break } return out }
async function rpc(f,b){ const r = await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)})
  if(!r.ok){ console.error('RPC',f,r.status,(await r.text()).slice(0,200)); return null } return r.json() }

const uni = (await q(`unidades?select=id,nome&nome=ilike.*HMM*`))[0]
const d04 = (await q(`dispositivos_rep?select=id,nome&unidade_id=eq.${uni.id}&nome=ilike.*HMM-04*`))[0]
console.log('HMM-04:', d04.id)

const f = await q(`rep_cadastros_fila?select=servidor_id,status,erro,processado_em,created_at,tentativas&dispositivo_id=eq.${d04.id}`)
const falhou = f.filter(x=>x.status==='falhou')
console.log(`\nfalhas: ${falhou.length}`)
const porDia = {}
for (const x of falhou) { const d=(x.processado_em||x.created_at||'').slice(0,13); porDia[d]=(porDia[d]||0)+1 }
console.log('falhas por hora (processado_em UTC):')
for (const [d,n] of Object.entries(porDia).sort()) console.log(`   ${d}h  x${n}`)

// quem falhou e NAO tem envio posterior
const ult = {}
for (const x of f) {
  const t = x.processado_em || x.created_at
  if (!ult[x.servidor_id] || t > ult[x.servidor_id].t) ult[x.servidor_id] = { t, status:x.status }
}
const presos = Object.entries(ult).filter(([,v])=>v.status==='falhou').map(([s])=>s)
console.log(`\nservidores cujo ULTIMO registro na fila e' falhou: ${presos.length}`)

// snapshot: quantos desses estao no relogio?
const snap = new Set((await q(`rep_usuarios_dispositivo?select=servidor_id&dispositivo_id=eq.${d04.id}`)).map(x=>x.servidor_id))
const forade = presos.filter(s=>!snap.has(s))
console.log(`   destes, NAO estao no snapshot do relogio: ${forade.length}`)

// fn_cadastro_rep_reprovado par a par (amostra + total)
console.log('\nchamando fn_cadastro_rep_reprovado par a par...')
let reprov = 0, liber = 0
for (const s of forade) {
  const r = await rpc('fn_cadastro_rep_reprovado', { p_dispositivo_id: d04.id, p_servidor_id: s })
  if (r === true) reprov++; else if (r === false) liber++; else { console.log('  resposta inesperada', r); break }
}
console.log(`   REPROVADOS (nao serao reenfileirados): ${reprov}`)
console.log(`   liberados: ${liber}`)
