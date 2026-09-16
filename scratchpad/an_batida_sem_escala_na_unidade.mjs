import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERR',r.status,(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const SEP=' > '
const uni=await q('unidades?select=id,nome');const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const set=await q('setores?select=id,unidade_id,parent_id,dicionario_setores(nome)')
const sn=Object.fromEntries(set.map(s=>[s.id,{...s,nome:s.dicionario_setores?.nome||'?'}]))
const cam=id=>{const p=[];let c=sn[id],g=0;while(c&&g++<10){p.unshift(c.nome);c=c.parent_id?sn[c.parent_id]:null}return p.join(SEP)}
const srv=await q('servidores?select=id,nome,matricula,unidade_id');const sv=Object.fromEntries(srv.map(s=>[s.id,s]))
const disp=await q('dispositivos_rep?select=id,nome,unidade_id');const dn=Object.fromEntries(disp.map(d=>[d.id,d]))
const ems=await q('escala_mensal?select=id,servidor_id,mes,ano,unidade_id,setor_id')
const esc={};for(const e of ems){const k=`${e.servidor_id}|${e.ano}-${e.mes}`;(esc[k]=esc[k]||[]).push(e)}
const mc=await q('marcacoes_ponto?select=servidor_id,unidade_id,dispositivo_id,ocorrido_em&origem=eq.rep&servidor_id=not.is.null&ocorrido_em=gte.2026-08-01')
let semEscalaNaUnidade=0, semEscalaNenhuma=0
const casos={}
for(const m of mc){
  const d=dn[m.dispositivo_id];if(!d)continue
  const dt=new Date(new Date(m.ocorrido_em).getTime()-3*3600e3)
  const k=`${m.servidor_id}|${dt.getUTCFullYear()}-${dt.getUTCMonth()+1}`
  const es=esc[k]||[]
  if(!es.length){semEscalaNenhuma++;continue}
  if(es.some(e=>e.unidade_id===d.unidade_id)) continue
  semEscalaNaUnidade++
  const setores=[...new Set(es.map(e=>cam(e.setor_id)))].join(' + ')
  const kk=`${d.nome} [${un[d.unidade_id]}]  <=  ${sv[m.servidor_id]?.matricula} ${sv[m.servidor_id]?.nome} :: ${un[es[0].unidade_id]} ${SEP} ${setores}`
  casos[kk]=(casos[kk]||0)+1
}
console.log('=== BATIDAS REP (08+09/2026) EM RELOGIO ONDE A PESSOA NAO TEM ESCALA ===')
console.log('batidas rep com dono:',mc.length,'| sem escala no mes:',semEscalaNenhuma,'| com escala mas NAO na unidade do relogio:',semEscalaNaUnidade)
console.log('pares (pessoa, relogio) distintos:',Object.keys(casos).length,'\n')
for(const [k,v] of Object.entries(casos).sort((a,b)=>b[1]-a[1])) console.log(` ${String(v).padStart(4)}x  ${k}`)
