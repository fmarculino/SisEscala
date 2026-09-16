import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)return out;const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const SEP=' > '
const uni=await q('unidades?select=id,nome');const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const set=await q('setores?select=id,unidade_id,parent_id,ativo,dicionario_setores(nome)')
const sn=Object.fromEntries(set.map(s=>[s.id,{...s,nome:s.dicionario_setores?.nome||'?'}]))
const cam=id=>{const p=[];let c=sn[id],g=0;while(c&&g++<10){p.unshift(c.nome);c=c.parent_id?sn[c.parent_id]:null}return p.join(SEP)}
const disp=await q('dispositivos_rep?select=id,nome,unidade_id,ativo,atende_toda_unidade&ativo=eq.true')
const dn=Object.fromEntries(disp.map(d=>[d.id,d.nome]))
const ds=await q('dispositivos_rep_setores?select=dispositivo_id,setor_id')
const lista={};for(const r of ds)(lista[r.dispositivo_id]=lista[r.dispositivo_id]||new Set()).add(r.setor_id)
const atende=(d,sid,uid)=>(d.atende_toda_unidade&&d.unidade_id===uid)||(lista[d.id]?.has(sid)??false)
const rel=s=>disp.filter(d=>atende(d,s.id,s.unidade_id))
const anc=id=>{const r=[];let c=sn[id],g=0;while(c?.parent_id&&g++<10){c=sn[c.parent_id];r.push(c)}return r}
const srv=await q('servidores?select=id,nome,setor_id,status&status=eq.Ativo')
const doSetor={};for(const s of srv)(doSetor[s.setor_id]=doSetor[s.setor_id]||[]).push(s.id)
const mc=await q('marcacoes_ponto?select=servidor_id,dispositivo_id&origem=eq.rep&servidor_id=not.is.null&ocorrido_em=gte.2026-07-17')
const bate={};for(const m of mc){if(!m.dispositivo_id)continue;(bate[m.servidor_id]=bate[m.servidor_id]||{})[m.dispositivo_id]=(bate[m.servidor_id]?.[m.dispositivo_id]||0)+1}
const comRel=new Set(disp.map(d=>d.unidade_id))
const orfaos=set.filter(s=>s.ativo!==false&&comRel.has(s.unidade_id)&&rel(s).length===0)

console.log('=== SINAL: ONDE A GENTE DESTE SETOR JA BATE (60 dias) vs PALPITE DA HIERARQUIA ===\n')
for(const s of orfaos){
  const gente=doSetor[s.id]||[]
  const urna={}
  for(const g of gente) for(const [d,n] of Object.entries(bate[g]||{})) urna[d]=(urna[d]||0)+n
  const ranking=Object.entries(urna).sort((a,b)=>b[1]-a[1])
  let h=null; for(const a of anc(s.id)){const r=rel(a);if(r.length){h={a,r};break}}
  console.log(`${cam(s.id)}  (${gente.length} lotados)`)
  console.log(`   evidencia (batidas reais): ${ranking.length? ranking.map(([d,n])=>`${dn[d]} (${n})`).join(', ') : 'NENHUMA - ninguem deste setor bateu em relogio nenhum'}`)
  console.log(`   palpite (hierarquia)     : ${h? h.r.map(d=>d.nome).join(', ')+`  [via "${h.a.dicionario_setores?.nome}"]` : '-'}`)
  console.log()
}
