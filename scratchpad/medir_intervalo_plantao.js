const fs=require('fs')
const env=fs.readFileSync('.env.production','utf8')
const g=k=>(env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim()
const U=g('NEXT_PUBLIC_SUPABASE_URL'), K=g('SUPABASE_SERVICE_ROLE_KEY')
const H={apikey:K,Authorization:'Bearer '+K}

async function all(path){
  const out=[]
  for(let from=0;;from+=1000){
    const r=await fetch(U+'/rest/v1/'+path,{headers:{...H,Range:`${from}-${from+999}`}})
    if(!r.ok){throw new Error(r.status+' '+await r.text())}
    const p=await r.json(); out.push(...p)
    if(p.length<1000) break
  }
  return out
}

;(async()=>{
  const jornadas=await all('jornadas?select=id,nome,horas_totais,intervalo_minutos')
  const J=Object.fromEntries(jornadas.map(j=>[j.id,j]))
  const turnos=await all('dicionario_turnos?select=id,codigo,horas_computadas,tipo,slots')
  const T=Object.fromEntries(turnos.map(t=>[t.id,t]))
  const unidades=await all('unidades?select=id,nome,permite_marca_intervalo,tipo_intervalo')
  const Un=Object.fromEntries(unidades.map(u=>[u.id,u]))
  const em=await all('escala_mensal?select=id,servidor_id,unidade_id,setor_id,mes,ano,jornada_id,status')
  const EM=Object.fromEntries(em.map(e=>[e.id,e]))
  const temp=await all('servidores_jornadas_temporarias?select=servidor_id,jornada_id,data_inicio,data_fim')
  const servidores=await all('servidores?select=id,nome,matricula,intervalo_flexivel,intervalo_inicio_personalizado,intervalo_fim_personalizado')
  const S=Object.fromEntries(servidores.map(s=>[s.id,s]))

  const ed=await all('escala_diaria?select=id,escala_mensal_id,dia,categoria,dicionario_turnos_id,hora_inicio_prevista,presenca_entrada_em,presenca_saida_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em&categoria=in.(Plantão,Extra)')
  console.log('escala_diaria Plantão/Extra:', ed.length)

  const jornadaDoDia=(servidorId,ano,mes,dia,jornadaMes)=>{
    const d=`${ano}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`
    const t=temp.find(x=>x.servidor_id===servidorId && x.data_inicio<=d && x.data_fim>=d)
    return J[t?t.jornada_id:jornadaMes]
  }

  const afetados=[]
  const bench={}
  for(const l of ed){
    const e=EM[l.escala_mensal_id]; if(!e) continue
    const t=T[l.dicionario_turnos_id]; if(!t) continue
    const dur=Number(t.horas_computadas||0)
    if(!(dur>6)) continue
    const u=Un[e.unidade_id]; if(!u?.permite_marca_intervalo) continue
    const j=jornadaDoDia(e.servidor_id,e.ano,e.mes,l.dia,e.jornada_id)
    const im=Number(j?.intervalo_minutos ?? 60)
    const key=`${e.ano}-${String(e.mes).padStart(2,'0')}`
    bench[key]=bench[key]||{total:0,suprimido:0,comPresenca:0,comBatidaIntervalo:0}
    bench[key].total++
    if(im>0) continue
    bench[key].suprimido++
    const temPres=!!(l.presenca_entrada_em||l.presenca_saida_em)
    if(temPres) bench[key].comPresenca++
    if(l.presenca_intervalo_saida_em||l.presenca_intervalo_retorno_em) bench[key].comBatidaIntervalo++
    afetados.push({ano:e.ano,mes:e.mes,dia:l.dia,cat:l.categoria,cod:t.codigo,dur,
      servidor:S[e.servidor_id]?.nome,matricula:S[e.servidor_id]?.matricula,
      jornada:j?.nome,jh:j?.horas_totais,unidade:u.nome,status:e.status,
      entrada:l.presenca_entrada_em,saida:l.presenca_saida_em,
      int_s:l.presenca_intervalo_saida_em,int_r:l.presenca_intervalo_retorno_em})
  }
  console.log('\n=== Plantao/Extra >6h em unidade que marca intervalo, por competencia ===')
  console.table(bench)
  console.log('\nTOTAL suprimido:',afetados.length)
  fs.writeFileSync('scratchpad/prod_afetados.json',JSON.stringify(afetados,null,1))

  // por codigo
  const porCod={}, porJorn={}, porUni={}, porStatus={}
  for(const a of afetados){
    porCod[a.cod]=(porCod[a.cod]||0)+1
    porJorn[a.jornada]=(porJorn[a.jornada]||0)+1
    porUni[a.unidade]=(porUni[a.unidade]||0)+1
    porStatus[a.status]=(porStatus[a.status]||0)+1
  }
  console.log('\npor codigo de turno:',porCod)
  console.log('por jornada do servidor:',porJorn)
  console.log('por unidade:',porUni)
  console.log('por status da escala:',porStatus)
})()
