import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERR',r.status,(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const SEP=' > '
const uni=await q('unidades?select=id,nome');const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const set=await q('setores?select=id,unidade_id,parent_id,ativo,dicionario_setores(nome)')
const sn=Object.fromEntries(set.map(s=>[s.id,{...s,nome:s.dicionario_setores?.nome||'?'}]))
const cam=id=>{const p=[];let c=sn[id],g=0;while(c&&g++<10){p.unshift(c.nome);c=c.parent_id?sn[c.parent_id]:null}return p.join(SEP)}
const disp=await q('dispositivos_rep?select=id,nome,unidade_id,ativo&ativo=eq.true')
const ds=await q('dispositivos_rep_setores?select=dispositivo_id,setor_id')
const doDisp={};for(const r of ds)(doDisp[r.dispositivo_id]=doDisp[r.dispositivo_id]||new Set()).add(r.setor_id)
const dispDaUni={};for(const d of disp)(dispDaUni[d.unidade_id]=dispDaUni[d.unidade_id]||[]).push(d)
const relDireto=(sid,uid)=>{const r=[];for(const d of (dispDaUni[uid]||[])){const l=doDisp[d.id];if(!l||l.size===0)r.push(d);else if(l.has(sid))r.push(d)}return r}
const ancestrais=sid=>{const r=[];let c=sn[sid],g=0;while(c?.parent_id&&g++<10){c=sn[c.parent_id];r.push(c.id)}return r}
const srv=await q('servidores?select=id,setor_id,status&status=eq.Ativo')
const lot={};for(const s of srv)lot[s.setor_id]=(lot[s.setor_id]||0)+1

const orfaos=set.filter(s=>s.ativo!==false&&(dispDaUni[s.unidade_id]||[]).length>0&&relDireto(s.id,s.unidade_id).length===0)
let res=0,nao=0,pessoasRes=0,pessoasNao=0;const naoResolvidos=[]
for(const s of orfaos){
  let achou=null
  for(const a of ancestrais(s.id)){const r=relDireto(a,s.unidade_id);if(r.length){achou={a,r};break}}
  if(achou){res++;pessoasRes+=lot[s.id]||0} else {nao++;pessoasNao+=lot[s.id]||0;naoResolvidos.push(s)}
}
console.log('=== HERANCA PELO ANCESTRAL MAIS PROXIMO (nao so o pai) ===')
console.log(` orfaos: ${orfaos.length} | resolvidos por algum ancestral: ${res} (${pessoasRes} lotados) | sem ancestral com relogio: ${nao} (${pessoasNao} lotados)`)
for(const s of naoResolvidos) console.log(`   nao resolve: ${un[s.unidade_id]} ${SEP} ${cam(s.id)}  (${lot[s.id]||0}p)`)

// RISCO: se a heranca fosse regra VIVA, quantos setores ganhariam relogio A MAIS?
console.log('\n=== RISCO DE HERANCA COMO REGRA VIVA: ABRANGENCIA AMPLIADA EM SILENCIO ===')
let ampl=0;const casos=[]
for(const s of set){
  if(s.ativo===false) continue
  const dir=relDireto(s.id,s.unidade_id); if(!dir.length) continue   // orfao: ganhar e' o objetivo
  const herd=new Set()
  for(const a of ancestrais(s.id)) for(const d of relDireto(a,s.unidade_id)) herd.add(d.id)
  const novos=[...herd].filter(x=>!dir.some(d=>d.id===x))
  if(novos.length){ampl++;casos.push({s,novos})}
}
console.log(` setores que JA tem relogio e ganhariam relogio(s) A MAIS por heranca: ${ampl}`)
const dn=Object.fromEntries(disp.map(d=>[d.id,d.nome]))
for(const c of casos.slice(0,15)) console.log(`   ${un[c.s.unidade_id].slice(0,18).padEnd(18)} ${cam(c.s.id).slice(0,52).padEnd(52)} += ${c.novos.map(x=>dn[x]).join(', ')}`)
if(casos.length>15) console.log(`   ... e mais ${casos.length-15}`)
