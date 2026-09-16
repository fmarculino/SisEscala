import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERR',r.status,(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
async function rpc(f,b){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok){console.error('RPC',f,r.status,t.slice(0,200));return null}return JSON.parse(t)}
const SEP=' > '
const uni=await q('unidades?select=id,nome');const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const set=await q('setores?select=id,unidade_id,parent_id,ativo,dicionario_setores(nome)')
const sn=Object.fromEntries(set.map(s=>[s.id,{...s,nome:s.dicionario_setores?.nome||'?'}]))
const cam=id=>{const p=[];let c=sn[id],g=0;while(c&&g++<10){p.unshift(c.nome);c=c.parent_id?sn[c.parent_id]:null}return p.join(SEP)}
const disp=await q('dispositivos_rep?select=id,nome,unidade_id,ativo')
const ds=await q('dispositivos_rep_setores?select=dispositivo_id,setor_id')
const comRel=new Set(disp.filter(d=>d.ativo).map(d=>d.unidade_id))
const srv=await q('servidores?select=id,nome,matricula,status,unidade_id,setor_id&status=eq.Ativo')
const mc=await q('marcacoes_ponto?select=servidor_id&origem=eq.rep&servidor_id=not.is.null&ocorrido_em=gte.2026-09-01')
const bateu=new Set(mc.map(m=>m.servidor_id))
const ems=await q('escala_mensal?select=servidor_id,setor_id,unidade_id&ano=eq.2026&mes=eq.9')
// universo por setor: lotados U escalados
const porSetor={}
const add=(setor_id,unidade_id,sid)=>{if(!setor_id)return;const k=setor_id;(porSetor[k]=porSetor[k]||{unidade_id,ids:new Set()}).ids.add(sid)}
for(const s of srv) add(s.setor_id,s.unidade_id,s.id)
for(const e of ems) add(e.setor_id,e.unidade_id,e.servidor_id)
const linhas=[]
for(const [sid,v] of Object.entries(porSetor)){
  if(!comRel.has(v.unidade_id)) continue          // unidade sem relogio: outro problema
  const total=v.ids.size; const b=[...v.ids].filter(x=>bateu.has(x)).length
  if(total>=1 && b===0) linhas.push({setor:cam(sid),uni:un[v.unidade_id],total})
}
linhas.sort((a,b)=>b.total-a.total)
console.log('=== SETORES COM PESSOAL E **ZERO** BATIDA REP EM 09/2026 (em unidade QUE TEM relogio) ===')
console.log('setores:',linhas.length,'| pessoas:',linhas.reduce((a,l)=>a+l.total,0),'\n')
for(const l of linhas.slice(0,30)) console.log(` ${String(l.total).padStart(3)}p  ${l.uni}  ${SEP}  ${l.setor}`)
const porUni={};for(const l of linhas)porUni[l.uni]=(porUni[l.uni]||0)+l.total
console.log('\npor unidade:');for(const [k,v] of Object.entries(porUni).sort((a,b)=>b[1]-a[1])) console.log(`  ${v}p  ${k}`)
