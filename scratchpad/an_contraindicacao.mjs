import { env } from './_env.mjs'
const E = env('.env.production')
const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error(r.status,(await r.text()).slice(0,150));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const unis=await q(`unidades?select=id,nome`);const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const disp=await q(`dispositivos_rep?select=id,nome,unidade_id,ativo`)
const comRelogio=new Set(disp.filter(d=>d.ativo).map(d=>d.unidade_id))
console.log('unidades com relogio ativo:',comRelogio.size,'de',unis.length)
const ems=await q(`escala_mensal?select=id,servidor_id,mes,ano,unidade_id&ano=eq.2026&mes=eq.9`)
const emById=Object.fromEntries(ems.map(e=>[e.id,e]))
const eds=await q(`escala_diaria?select=id,escala_mensal_id,dia,categoria&categoria=in.(Regular,Plantão,Extra)&order=id`)
const mapa={}
for(const d of eds){const em=emById[d.escala_mensal_id];if(!em)continue;const k=`${em.servidor_id}|${d.dia}`;(mapa[k]=mapa[k]||new Set()).add(em.unidade_id)}
const multi=Object.entries(mapa).filter(([,s])=>s.size>1)
const srvs=await q(`servidores?select=id,nome,matricula,unidade_id`);const sn=Object.fromEntries(srvs.map(s=>[s.id,s]))
console.log('\n=== PESSOAS COM ESCALA EM 2+ UNIDADES NO MESMO DIA (09/2026) ===')
const porPessoa={}
for(const [k,s] of multi){const [srv,dia]=k.split('|');(porPessoa[srv]=porPessoa[srv]||{dias:0,unis:new Set()});porPessoa[srv].dias++;for(const u of s)porPessoa[srv].unis.add(u)}
for(const [srv,v] of Object.entries(porPessoa)){const s=sn[srv]
  console.log(`${s.nome} (${s.matricula}) | lotacao: ${un[s.unidade_id]} | ${v.dias} dias | unidades: ${[...v.unis].map(u=>`${un[u]}${comRelogio.has(u)?'':' [SEM RELOGIO]'}`).join(' + ')}`)}
console.log('\n=== ESCALAS 09/2026 EM UNIDADE SEM RELOGIO ATIVO ===')
const semRel={}
for(const e of ems) if(!comRelogio.has(e.unidade_id)) semRel[un[e.unidade_id]]=(semRel[un[e.unidade_id]]||0)+1
for(const [k,v] of Object.entries(semRel).sort((a,b)=>b[1]-a[1])) console.log(String(v).padStart(4),k)
