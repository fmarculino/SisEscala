import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)return out;const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const uni=await q('unidades?select=id,nome');const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const disp=await q('dispositivos_rep?select=id,nome,unidade_id,ativo,atende_toda_unidade,updated_at&ativo=eq.true&order=nome')
const ds=await q('dispositivos_rep_setores?select=dispositivo_id,setor_id,created_at')
const n={};for(const r of ds)n[r.dispositivo_id]=(n[r.dispositivo_id]||0)+1
console.log('=== RELOGIOS DE SMS E HMM ===')
for(const d of disp.filter(d=>/SMS|HMM/.test(un[d.unidade_id]||'')))
  console.log(` ${d.nome.padEnd(30)} toda_unidade=${String(d.atende_toda_unidade).padEnd(5)} setores=${String(n[d.id]||0).padEnd(4)} updated=${String(d.updated_at).slice(0,16)}`)
const recentes=ds.filter(r=>r.created_at>'2026-09-15T00:00')
console.log('\nvinculos dispositivo->setor criados a partir de 15/09:',recentes.length)
const porD={};for(const r of recentes)porD[r.dispositivo_id]=(porD[r.dispositivo_id]||0)+1
for(const [k,v] of Object.entries(porD)) console.log(`   ${disp.find(d=>d.id===k)?.nome||k}: +${v}`)
