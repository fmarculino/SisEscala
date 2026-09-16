import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERR',r.status,(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const sel='id,servidor_id,escala_mensal_id,status'
const r=await fetch(`${U}/rest/v1/folha_ponto?select=${sel}&mes=eq.9&ano=eq.2026`,{headers:H})
const vistas=await r.json()
const todas=await q(`folha_ponto?select=${sel}&mes=eq.9&ano=eq.2026`)
const vs=new Set(vistas.map(f=>f.id))
const perdidas=todas.filter(f=>!vs.has(f.id))
console.log('total',todas.length,'| a tela enxerga',vistas.length,'| INVISIVEIS',perdidas.length)
const ald='c0d11d0e-0a06-4bf8-8f99-e9dbfecccf4b'
console.log('folha do ALDENIR esta entre as invisiveis?',perdidas.some(f=>f.id===ald))

// quem sao as invisiveis, por unidade
const em=await q('escala_mensal?select=id,unidade_id&mes=eq.9&ano=eq.2026')
const eu=Object.fromEntries(em.map(e=>[e.id,e.unidade_id]))
const uni=await q('unidades?select=id,nome');const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const porUni={}
for(const f of perdidas){const n=un[eu[f.escala_mensal_id]]||'?';porUni[n]=(porUni[n]||0)+1}
console.log('\ninvisiveis por unidade:')
for(const [n,c] of Object.entries(porUni).sort((a,b)=>b[1]-a[1]))console.log(`  ${String(c).padStart(4)}  ${n}`)
