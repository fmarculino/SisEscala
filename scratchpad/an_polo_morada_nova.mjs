import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERR',r.status,(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const POLO='78f93dde-6960-4a1d-9ff1-1f23b6f5282a'
const set=await q('setores?select=id,unidade_id,parent_id,dicionario_setores(nome)')
const sn=Object.fromEntries(set.map(s=>[s.id,{...s,nome:s.dicionario_setores?.nome||'?'}]))
const filhos=id=>{const r=[id];let f=set.filter(s=>s.parent_id===id);while(f.length){r.push(...f.map(x=>x.id));f=set.filter(s=>f.some(p=>p.id===s.parent_id))}return r}
const alvo=filhos(POLO)
console.log('setores do ramo POLO MORADA NOVA:',alvo.length)

const srv=await q(`servidores?select=id,nome,matricula,status,unidade_id,setor_id,cpf,pis_pasep&setor_id=in.(${alvo.join(',')})`)
console.log('\n=== LOTADOS NO POLO MORADA NOVA ===',srv.length,'(ativos:',srv.filter(s=>s.status==='Ativo').length+')')
for(const s of srv) console.log(` ${s.matricula} ${s.nome} [${s.status}] cpf=${s.cpf?'sim':'NAO'} pis=${s.pis_pasep?'sim':'NAO'}`)

// escalas desses servidores
const ids=srv.map(s=>s.id)
if(ids.length){
  const ems=await q(`escala_mensal?select=id,servidor_id,mes,ano,unidade_id,setor_id,status&servidor_id=in.(${ids.join(',')})&order=ano,mes`)
  console.log('\n=== ESCALAS ===')
  for(const e of ems) console.log(` ${String(e.mes).padStart(2,'0')}/${e.ano} ${srv.find(s=>s.id===e.servidor_id)?.nome} setor=${sn[e.setor_id]?.nome} status=${e.status}`)
  // marcacoes
  const mc=await q(`marcacoes_ponto?select=id,servidor_id,ocorrido_em,origem,unidade_id,setor_id,dispositivo_id&servidor_id=in.(${ids.join(',')})&order=ocorrido_em.desc&limit=1000`)
  const disp=await q('dispositivos_rep?select=id,nome,unidade_id')
  const dn=Object.fromEntries(disp.map(d=>[d.id,d.nome]))
  console.log('\n=== MARCACOES (ultimas 15 de',mc.length,') ===')
  const porOrigem={};for(const m of mc)porOrigem[m.origem]=(porOrigem[m.origem]||0)+1
  console.log(' por origem:',JSON.stringify(porOrigem))
  for(const m of mc.slice(0,15)) console.log(` ${m.ocorrido_em.slice(0,16)} ${m.origem} disp=${dn[m.dispositivo_id]||'-'} ${srv.find(s=>s.id===m.servidor_id)?.nome}`)
}
