import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERR',r.status,(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const SEP=' > '
const uni=await q('unidades?select=id,nome');const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const set=await q('setores?select=id,unidade_id,parent_id,ativo,created_at,dicionario_setores(nome)')
const sn=Object.fromEntries(set.map(s=>[s.id,{...s,nome:s.dicionario_setores?.nome||'?'}]))
const cam=id=>{const p=[];let c=sn[id],g=0;while(c&&g++<10){p.unshift(c.nome);c=c.parent_id?sn[c.parent_id]:null}return p.join(SEP)}
const disp=await q('dispositivos_rep?select=id,nome,unidade_id,ativo&ativo=eq.true')
const ds=await q('dispositivos_rep_setores?select=dispositivo_id,setor_id')
const setoresDoDisp={};for(const r of ds)(setoresDoDisp[r.dispositivo_id]=setoresDoDisp[r.dispositivo_id]||new Set()).add(r.setor_id)
const dispDaUni={};for(const d of disp)(dispDaUni[d.unidade_id]=dispDaUni[d.unidade_id]||[]).push(d)
// relogio "toda a unidade" = sem linhas (semantica atual)
const cobre=(setor)=>{const ds2=dispDaUni[setor.unidade_id]||[];const r=[]
  for(const d of ds2){const lst=setoresDoDisp[d.id];if(!lst||lst.size===0)r.push(d.nome+'(toda a unidade)');else if(lst.has(setor.id))r.push(d.nome)}
  return r}
const srv=await q('servidores?select=id,setor_id,status&status=eq.Ativo')
const lot={};for(const s of srv)lot[s.setor_id]=(lot[s.setor_id]||0)+1
const ems=await q('escala_mensal?select=setor_id,servidor_id&ano=eq.2026&mes=eq.9')
const esc={};for(const e of ems)(esc[e.setor_id]=esc[e.setor_id]||new Set()).add(e.servidor_id)

console.log('=== UNIDADES CUJOS RELOGIOS TRABALHAM COM LISTA DE SETORES ===')
for(const [u,dl] of Object.entries(dispDaUni)){
  const comLista=dl.filter(d=>(setoresDoDisp[d.id]||new Set()).size>0)
  if(!comLista.length) continue
  const setoresUni=set.filter(s=>s.unidade_id===u&&s.ativo!==false)
  const orfaos=setoresUni.filter(s=>cobre(s).length===0)
  const orfaosComGente=orfaos.filter(s=>(lot[s.id]||0)>0||(esc[s.id]?.size||0)>0)
  console.log(`\n${un[u]}  | relogios: ${dl.map(d=>d.nome+'['+((setoresDoDisp[d.id]||new Set()).size||'toda')+']').join(', ')}`)
  console.log(`  setores ativos: ${setoresUni.length} | SEM relogio nenhum: ${orfaos.length} | desses, com gente: ${orfaosComGente.length}`)
  for(const s of orfaosComGente.sort((a,b)=>((lot[b.id]||0)+(esc[b.id]?.size||0))-((lot[a.id]||0)+(esc[a.id]?.size||0))).slice(0,12))
    console.log(`    ${String(lot[s.id]||0).padStart(3)} lotados / ${String(esc[s.id]?.size||0).padStart(3)} escalados  ${cam(s.id)}   [criado ${String(s.created_at).slice(0,10)}]`)
}
// quando esses setores orfaos foram criados?
console.log('\n=== SETORES ORFAOS: DATA DE CRIACAO (todos, com ou sem gente) ===')
const todosOrfaos=set.filter(s=>s.ativo!==false&&(dispDaUni[s.unidade_id]||[]).length>0&&cobre(s).length===0)
const porMes={};for(const s of todosOrfaos){const k=String(s.created_at).slice(0,7);porMes[k]=(porMes[k]||0)+1}
console.log(' total orfaos em unidade COM relogio:',todosOrfaos.length)
for(const [k,v] of Object.entries(porMes).sort())console.log(`   ${k}: ${v}`)
