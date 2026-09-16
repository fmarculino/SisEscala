import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERR',r.status,(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const uni=await q('unidades?select=id,nome');const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const disp=await q('dispositivos_rep?select=id,nome,unidade_id,ativo')
const dn=Object.fromEntries(disp.map(d=>[d.id,d]))
const comRelogio=new Set(disp.filter(d=>d.ativo).map(d=>d.unidade_id))
console.log('unidades com relogio ativo:',comRelogio.size,'de',uni.length)

// 1. Quem JA esta cadastrado num relogio de unidade diferente da lotacao dele
const rud=await q('rep_usuarios_dispositivo?select=dispositivo_id,servidor_id,tem_biometria&servidor_id=not.is.null')
const srv=await q('servidores?select=id,nome,matricula,status,unidade_id,setor_id')
const sv=Object.fromEntries(srv.map(s=>[s.id,s]))
const cruz={}
for(const r of rud){const s=sv[r.servidor_id],d=dn[r.dispositivo_id];if(!s||!d)continue
  if(s.status!=='Ativo')continue
  if(s.unidade_id!==d.unidade_id){const k=`${un[d.unidade_id]} <= ${un[s.unidade_id]}`;(cruz[k]=cruz[k]||{n:0,bio:0});cruz[k].n++;if(r.tem_biometria)cruz[k].bio++}}
console.log('\n=== JA CADASTRADOS EM RELOGIO DE OUTRA UNIDADE (ativos) ===')
const ord=Object.entries(cruz).sort((a,b)=>b[1].n-a[1].n)
console.log(' pares unidade-do-relogio <= unidade-da-lotacao:',ord.length,'| total pessoas-relogio:',ord.reduce((a,[,v])=>a+v.n,0))
for(const [k,v] of ord.slice(0,15)) console.log(`  ${k}: ${v.n} (com biometria ${v.bio})`)

// 2. Batidas ja gravadas em relogio de unidade != escala do servidor
const mc=await q('marcacoes_ponto?select=servidor_id,unidade_id,origem,dispositivo_id,ocorrido_em&origem=eq.rep&servidor_id=not.is.null&ocorrido_em=gte.2026-08-01&order=ocorrido_em.desc')
let divLot=0;const divPor={}
for(const m of mc){const s=sv[m.servidor_id];if(!s)continue;if(s.unidade_id!==m.unidade_id){divLot++;const k=`${un[m.unidade_id]} <= ${un[s.unidade_id]}`;divPor[k]=(divPor[k]||0)+1}}
console.log('\n=== BATIDAS REP desde 08/2026 em relogio de unidade != LOTACAO do servidor ===')
console.log(' total batidas rep com dono:',mc.length,'| divergentes:',divLot)
for(const [k,v] of Object.entries(divPor).sort((a,b)=>b[1]-a[1]).slice(0,12)) console.log(`  ${k}: ${v}`)

// 3. Unidades sem relogio que tem gente escalada
const ems=await q('escala_mensal?select=unidade_id,servidor_id&ano=eq.2026&mes=eq.9')
const semRel={}
for(const e of ems) if(!comRelogio.has(e.unidade_id)) (semRel[un[e.unidade_id]]=semRel[un[e.unidade_id]]||new Set()).add(e.servidor_id)
console.log('\n=== UNIDADES SEM RELOGIO ATIVO COM ESCALA EM 09/2026 ===')
for(const [k,v] of Object.entries(semRel).sort((a,b)=>b[1].size-a[1].size)) console.log(`  ${k}: ${v.size} servidores escalados`)
