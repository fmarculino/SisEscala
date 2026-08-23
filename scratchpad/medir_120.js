const fs=require('fs')
const env=fs.readFileSync('.env.production','utf8')
const g=k=>(env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim()
const U=g('NEXT_PUBLIC_SUPABASE_URL'), K=g('SUPABASE_SERVICE_ROLE_KEY')
const H={apikey:K,Authorization:'Bearer '+K}
async function all(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(U+'/rest/v1/'+p,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(r.status+await r.text());const q=await r.json();o.push(...q);if(q.length<1000)break}return o}
const L=t=>t?new Date(t).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo'}):null
;(async()=>{
  const J=Object.fromEntries((await all('jornadas?select=id,nome,horas_totais,intervalo_minutos')).map(j=>[j.id,j]))
  const T=Object.fromEntries((await all('dicionario_turnos?select=id,codigo,horas_computadas')).map(t=>[t.id,t]))
  const Un=Object.fromEntries((await all('unidades?select=id,nome,permite_marca_intervalo')).map(u=>[u.id,u]))
  const EM=Object.fromEntries((await all('escala_mensal?select=id,servidor_id,unidade_id,mes,ano,jornada_id,status')).map(e=>[e.id,e]))
  const srv=await all('servidores?select=id,nome,intervalo_flexivel,intervalo_inicio_personalizado,intervalo_fim_personalizado')
  const S=Object.fromEntries(srv.map(s=>[s.id,s]))
  console.log('servidores com intervalo_flexivel=true:', srv.filter(s=>s.intervalo_flexivel).length, '/', srv.length)
  console.log('servidores com intervalo personalizado:', srv.filter(s=>s.intervalo_inicio_personalizado).length)
  const temp=await all('servidores_jornadas_temporarias?select=servidor_id,jornada_id,data_inicio,data_fim')
  const ed=await all('escala_diaria?select=id,escala_mensal_id,dia,categoria,dicionario_turnos_id,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_intervalo_saida_origem,presenca_intervalo_retorno_origem&categoria=in.(Plantão,Extra)')
  const jd=(s,a,m,d,jm)=>{const k=`${a}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const t=temp.find(x=>x.servidor_id===s&&x.data_inicio<=k&&x.data_fim>=k);return J[t?t.jornada_id:jm]}
  const com=[]; let n120=0, comInt=0
  for(const l of ed){
    const e=EM[l.escala_mensal_id]; if(!e) continue
    const t=T[l.dicionario_turnos_id]; if(!t||!(Number(t.horas_computadas)>6)) continue
    const u=Un[e.unidade_id]; if(!u?.permite_marca_intervalo) continue
    const j=jd(e.servidor_id,e.ano,e.mes,l.dia,e.jornada_id)
    const im=Number(j?.intervalo_minutos ?? 60)
    if(l.presenca_intervalo_saida_em||l.presenca_intervalo_retorno_em) comInt++
    if(im!==120) continue
    n120++
    if(l.presenca_intervalo_saida_em||l.presenca_intervalo_retorno_em){
      const a=l.presenca_intervalo_saida_em, b=l.presenca_intervalo_retorno_em
      const dur = a&&b ? Math.round((new Date(b)-new Date(a))/60000) : null
      com.push({comp:`${e.ano}-${String(e.mes).padStart(2,'0')}`,dia:l.dia,st:e.status,cod:t.codigo,serv:(S[e.servidor_id]?.nome||'').slice(0,24),flex:S[e.servidor_id]?.intervalo_flexivel,
        i_s:L(a),o_s:l.presenca_intervalo_saida_origem,i_r:L(b),o_r:l.presenca_intervalo_retorno_origem,dur_min:dur})
    }
  }
  console.log('\nPlantoes >6h com intervalo previsto de 120 min:',n120)
  console.log('Plantoes >6h COM alguma batida de intervalo gravada (todos os grupos):',comInt)
  console.log('\n=== dos 120 min, os que tem batida de intervalo gravada ===')
  console.table(com.sort((a,b)=>a.comp.localeCompare(b.comp)||a.dia-b.dia))
})()
