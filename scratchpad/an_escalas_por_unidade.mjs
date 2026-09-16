import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERR',r.status,(await r.text()).slice(0,300));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const uni=await q('unidades?select=id,nome');const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const em=await q('escala_mensal?select=id,unidade_id&mes=eq.9&ano=eq.2026&ativo=eq.true')
const c={};for(const e of em)c[un[e.unidade_id]||'?']=(c[un[e.unidade_id]||'?']||0)+1
console.log('escala_mensal ativas 09/2026 por unidade (top 8) — teto de 1000:')
for(const [n,v] of Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,8))console.log(`  ${String(v).padStart(4)}  ${n}`)
console.log('  TOTAL',em.length)
