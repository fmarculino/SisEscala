import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERR',r.status,(await r.text()).slice(0,150));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const SEP=' > '
const uni=await q('unidades?select=id,nome');const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const set=await q('setores?select=id,unidade_id,parent_id,ativo,created_at,dicionario_setores(nome)')
const sn=Object.fromEntries(set.map(s=>[s.id,{...s,nome:s.dicionario_setores?.nome||'?'}]))
const cam=id=>{const p=[];let c=sn[id],g=0;while(c&&g++<10){p.unshift(c.nome);c=c.parent_id?sn[c.parent_id]:null}return p.join(SEP)}
const disp=await q('dispositivos_rep?select=id,nome,unidade_id,ativo,atende_toda_unidade&ativo=eq.true')
const ds=await q('dispositivos_rep_setores?select=dispositivo_id,setor_id')
const lista={};for(const r of ds)(lista[r.dispositivo_id]=lista[r.dispositivo_id]||new Set()).add(r.setor_id)
// PREDICADO NOVO (espelha fn_dispositivo_atende_setor)
const atende=(d,setorId,uniId)=> (d.atende_toda_unidade && d.unidade_id===uniId) || (lista[d.id]?.has(setorId)??false)
const relogiosDoSetor=s=>disp.filter(d=>atende(d,s.id,s.unidade_id))
const anc=id=>{const r=[];let c=sn[id],g=0;while(c?.parent_id&&g++<10){c=sn[c.parent_id];r.push(c)}return r}
const srv=await q('servidores?select=id,setor_id,status&status=eq.Ativo')
const lot={};for(const s of srv)lot[s.setor_id]=(lot[s.setor_id]||0)+1
const ems=await q('escala_mensal?select=setor_id,servidor_id&ano=eq.2026&mes=eq.9')
const esc={};for(const e of ems)(esc[e.setor_id]=esc[e.setor_id]||new Set()).add(e.servidor_id)
const comRel=new Set(disp.map(d=>d.unidade_id))

const orfaos=set.filter(s=>s.ativo!==false&&comRel.has(s.unidade_id)&&relogiosDoSetor(s).length===0)
console.log('=== ORFAOS (com o predicado NOVO), em unidade que tem relogio ===')
console.log(' total:',orfaos.length,'| com gente:',orfaos.filter(s=>(lot[s.id]||0)+(esc[s.id]?.size||0)>0).length,
            '| lotados:',orfaos.reduce((a,s)=>a+(lot[s.id]||0),0))
let res=0,nao=0
const porUni={}
for(const s of orfaos){
  let achou=null
  for(const a of anc(s.id)){const r=relogiosDoSetor(a);if(r.length){achou={a,r};break}}
  if(achou)res++;else nao++
  porUni[un[s.unidade_id]]=(porUni[un[s.unidade_id]]||0)+1
}
console.log(' resolvidos pelo ancestral mais proximo:',res,'| sem ancestral com relogio:',nao)
console.log(' por unidade:',JSON.stringify(porUni))
// risco da heranca automatica, remedido
let ampl=0
for(const s of set){
  if(s.ativo===false)continue
  const dir=relogiosDoSetor(s); if(!dir.length)continue
  const h=new Set()
  for(const a of anc(s.id)) for(const d of relogiosDoSetor(a)) h.add(d.id)
  if([...h].some(x=>!dir.some(d=>d.id===x))) ampl++
}
console.log(' setores que a heranca AUTOMATICA ampliaria em silencio:',ampl)

console.log('\n=== OS ORFAOS, UM A UM, COM A SUGESTAO ===')
for(const s of orfaos){
  let achou=null
  for(const a of anc(s.id)){const r=relogiosDoSetor(a);if(r.length){achou={a,r};break}}
  console.log(` ${String(lot[s.id]||0).padStart(3)} lotados | ${un[s.unidade_id]}`)
  console.log(`     ${cam(s.id)}   [criado ${String(s.created_at).slice(0,10)}]`)
  console.log(`     -> ${achou? `herdaria de "${achou.a.dicionario_setores?.nome||'?'}": ${achou.r.map(d=>d.nome).join(', ')}` : 'SEM ancestral com relogio'}`)
}
