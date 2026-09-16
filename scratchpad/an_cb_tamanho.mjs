import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERR',r.status,(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const uni=await q('unidades?select=id,nome');const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const disp=await q('dispositivos_rep?select=id,nome,unidade_id,ativo&ativo=eq.true&order=nome')
const srv=await q('servidores?select=id,unidade_id,status&status=eq.Ativo')
const porUni={};for(const s of srv)porUni[s.unidade_id]=(porUni[s.unidade_id]||0)+1
console.log('=== RELOGIOS ATIVOS POR UNIDADE (com nº de lotados ativos) ===')
const g={};for(const d of disp)(g[d.unidade_id]=g[d.unidade_id]||[]).push(d.nome)
for(const [u,ns] of Object.entries(g).sort((a,b)=>(porUni[b[0]]||0)-(porUni[a[0]]||0)))
  console.log(` ${String(porUni[u]||0).padStart(4)} lotados | ${un[u]} : ${ns.join(', ')}`)
console.log('\n=== UNIDADES SEM RELOGIO ATIVO ===')
for(const u of uni) if(!g[u.id]) console.log(` ${String(porUni[u.id]||0).padStart(4)} lotados | ${u.nome}`)
