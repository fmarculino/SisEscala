import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,300));break}const g=await r.json();o.push(...g);if(g.length<1000)break}return o}

const em=await qAll('escala_mensal?select=id,servidor_id,unidade_id,setor_id,mes,ano,status,jornada_id,ativo')
const dt=await qAll('dicionario_turnos?select=id,codigo,horas_computadas')
const jo=await qAll('jornadas?select=id,nome,horas_totais,intervalo_minutos')
const ed=await qAll('escala_diaria?select=id,dia,escala_mensal_id,categoria,dicionario_turnos_id&order=id')
const T=new Map(dt.map(t=>[t.id,t])),J=new Map(jo.map(j=>[j.id,j])),EM=new Map(em.map(e=>[e.id,e]))
console.log('escala_mensal total',em.length,'| escala_diaria total',ed.length)

const porMes=new Map()
for(const l of ed){
  const e=EM.get(l.escala_mensal_id); if(!e) continue
  const k=`${e.mes}/${e.ano}`
  if(!porMes.has(k))porMes.set(k,{acc:{},cnt:{},liq:{},dup:new Map(),ems:new Set(),semTurno:0})
  const m=porMes.get(k)
  m.ems.add(e.id)
  const t=T.get(l.dicionario_turnos_id)
  if(!t) m.semTurno++
  const bruto=Number(t?.horas_computadas)||0
  const c=l.categoria
  m.acc[c]=(m.acc[c]||0)+bruto; m.cnt[c]=(m.cnt[c]||0)+1
  let h=bruto
  if(c==='Regular'){const j=J.get(e.jornada_id); if(j){const liq=Number(j.horas_totais)-Number(j.intervalo_minutos||0)/60; h=Math.min(bruto,liq)}}
  m.liq[c]=(m.liq[c]||0)+h
  const dk=`${e.servidor_id}|${l.dia}|${c}`
  m.dup.set(dk,(m.dup.get(dk)||0)+1)
}
for(const k of [...porMes.keys()].sort()){
  const m=porMes.get(k)
  const dups=[...m.dup.values()].filter(v=>v>1).length
  console.log(`\n=== ${k} === escalas_mensais=${m.ems.size} linhas=${[...Object.values(m.cnt)].reduce((a,b)=>a+b,0)} sem_turno=${m.semTurno}`)
  for(const c of ['Regular','Plantão','Sobreaviso','Extra']){
    console.log(`  ${c.padEnd(10)} linhas=${String(m.cnt[c]||0).padStart(6)}  dashboard=${Math.round(m.acc[c]||0).toString().padStart(7)}h  liquido=${Math.round(m.liq[c]||0).toString().padStart(7)}h`)
  }
  console.log(`  pares (servidor,dia,categoria) com >1 linha: ${dups}`)
}
