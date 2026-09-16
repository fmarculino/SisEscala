import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERR',r.status,(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const SEP=' > '
const uni=await q('unidades?select=id,nome');const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const set=await q('setores?select=id,unidade_id,parent_id,ativo,created_at,dicionario_setores(nome)')
const sn=Object.fromEntries(set.map(s=>[s.id,{...s,nome:s.dicionario_setores?.nome||'?'}]))
const cam=id=>{const p=[];let c=sn[id],g=0;while(c&&g++<10){p.unshift(c.nome);c=c.parent_id?sn[c.parent_id]:null}return p.join(SEP)}
const disp=await q('dispositivos_rep?select=id,nome,unidade_id,ativo&ativo=eq.true');const dn=Object.fromEntries(disp.map(d=>[d.id,d.nome]))
const ds=await q('dispositivos_rep_setores?select=dispositivo_id,setor_id')
const doDisp={};for(const r of ds)(doDisp[r.dispositivo_id]=doDisp[r.dispositivo_id]||new Set()).add(r.setor_id)
const dispDaUni={};for(const d of disp)(dispDaUni[d.unidade_id]=dispDaUni[d.unidade_id]||[]).push(d)
const rel=(setorId,uniId)=>{const r=[];for(const d of (dispDaUni[uniId]||[])){const l=doDisp[d.id];if(!l||l.size===0)r.push('TODA:'+d.nome);else if(l.has(setorId))r.push(d.nome)}return r}
const srv=await q('servidores?select=id,setor_id,status&status=eq.Ativo')
const lot={};for(const s of srv)(lot[s.setor_id]=lot[s.setor_id]||[]).push(s.id)
const mc=await q('marcacoes_ponto?select=servidor_id&origem=eq.rep&servidor_id=not.is.null&ocorrido_em=gte.2026-09-01')
const bateu=new Set(mc.map(m=>m.servidor_id))

const orfaos=set.filter(s=>s.ativo!==false&&(dispDaUni[s.unidade_id]||[]).length>0&&rel(s.id,s.unidade_id).length===0)
let herdaria=0,semPai=0,paiOrfao=0,pessoas=0,pessoasSemBatida=0
const detalhe=[]
for(const s of orfaos){
  const n=(lot[s.id]||[]).length; pessoas+=n
  pessoasSemBatida+=(lot[s.id]||[]).filter(x=>!bateu.has(x)).length
  if(!s.parent_id){semPai++;detalhe.push(['SEM PAI (raiz)',s,[]]);continue}
  const rp=rel(s.parent_id,s.unidade_id)
  if(rp.length){herdaria++;detalhe.push(['herdaria: '+rp.join(', '),s,rp])}
  else {paiOrfao++;detalhe.push(['pai tambem orfao',s,[]])}
}
console.log('=== 37 SETORES ORFAOS: A HERANCA DO PAI RESOLVERIA? ===')
console.log(` herdaria do pai ............ ${herdaria}`)
console.log(` pai tambem orfao ........... ${paiOrfao}`)
console.log(` setor raiz (sem pai) ....... ${semPai}`)
console.log(` lotados ativos nesses setores: ${pessoas} | deles SEM nenhuma batida em 09/2026: ${pessoasSemBatida}`)
console.log('\n=== DETALHE ===')
for(const [m,s] of detalhe.sort((a,b)=>((lot[b[1].id]||[]).length)-((lot[a[1].id]||[]).length)))
  console.log(` ${String((lot[s.id]||[]).length).padStart(3)}p  ${un[s.unidade_id].slice(0,22).padEnd(22)} ${cam(s.id).slice(0,60).padEnd(60)} -> ${m}`)
// quantos relogios distintos o pai indica (ambiguidade)?
const amb=detalhe.filter(d=>d[2].length>1).length
console.log(`\nsetores cujo pai aponta para MAIS DE UM relogio (ambiguo, mas todos do mesmo sitio): ${amb}`)
