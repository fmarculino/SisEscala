const fs=require('fs')
const env=fs.readFileSync('.env.production','utf8')
const g=k=>(env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim()
const U=g('NEXT_PUBLIC_SUPABASE_URL'), K=g('SUPABASE_SERVICE_ROLE_KEY')
const H={apikey:K,Authorization:'Bearer '+K}
async function all(path){const out=[];for(let f=0;;f+=1000){const r=await fetch(U+'/rest/v1/'+path,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(r.status+await r.text());const p=await r.json();out.push(...p);if(p.length<1000)break}return out}
;(async()=>{
  const J=Object.fromEntries((await all('jornadas?select=id,nome,horas_totais,intervalo_minutos')).map(j=>[j.id,j]))
  const T=Object.fromEntries((await all('dicionario_turnos?select=id,codigo,horas_computadas')).map(t=>[t.id,t]))
  const Un=Object.fromEntries((await all('unidades?select=id,nome,permite_marca_intervalo')).map(u=>[u.id,u]))
  const EM=Object.fromEntries((await all('escala_mensal?select=id,servidor_id,unidade_id,mes,ano,jornada_id,status')).map(e=>[e.id,e]))
  const temp=await all('servidores_jornadas_temporarias?select=servidor_id,jornada_id,data_inicio,data_fim')
  const ed=await all('escala_diaria?select=escala_mensal_id,dia,categoria,dicionario_turnos_id&categoria=in.(Plantão,Extra)')
  const jd=(s,a,m,d,jm)=>{const k=`${a}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const t=temp.find(x=>x.servidor_id===s&&x.data_inicio<=k&&x.data_fim>=k);return J[t?t.jornada_id:jm]}
  const dist={}
  for(const l of ed){
    const e=EM[l.escala_mensal_id]; if(!e) continue
    const t=T[l.dicionario_turnos_id]; if(!t||!(Number(t.horas_computadas)>6)) continue
    const u=Un[e.unidade_id]; if(!u?.permite_marca_intervalo) continue
    const j=jd(e.servidor_id,e.ano,e.mes,l.dia,e.jornada_id)
    const im=Number(j?.intervalo_minutos ?? 60)
    const key=`${im} min  (jornada ${j?.nome||'?'} / ${j?.horas_totais??'?'}h)  turno ${t.codigo} ${t.horas_computadas}h`
    dist[key]=(dist[key]||0)+1
  }
  const rows=Object.entries(dist).sort((a,b)=>b[1]-a[1])
  console.log('Plantao/Extra >6h em unidade que marca intervalo — intervalo herdado da jornada Regular:')
  for(const [k,v] of rows) console.log(String(v).padStart(4),k)
  const por={}
  for(const [k,v] of rows){const m=k.split(' ')[0]; por[m+' min']=(por[m+' min']||0)+v}
  console.log('\nresumo:',por)
})()
