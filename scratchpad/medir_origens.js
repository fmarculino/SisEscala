const fs=require('fs')
const env=fs.readFileSync('.env.production','utf8')
const g=k=>(env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim()
const U=g('NEXT_PUBLIC_SUPABASE_URL'), K=g('SUPABASE_SERVICE_ROLE_KEY')
const H={apikey:K,Authorization:'Bearer '+K}
async function all(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(U+'/rest/v1/'+p,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(r.status+await r.text());const q=await r.json();o.push(...q);if(q.length<1000)break}return o}
;(async()=>{
  const J=Object.fromEntries((await all('jornadas?select=id,nome,horas_totais,intervalo_minutos')).map(j=>[j.id,j]))
  const T=Object.fromEntries((await all('dicionario_turnos?select=id,codigo,horas_computadas')).map(t=>[t.id,t]))
  const Un=Object.fromEntries((await all('unidades?select=id,nome,permite_marca_intervalo')).map(u=>[u.id,u]))
  const EM=Object.fromEntries((await all('escala_mensal?select=id,servidor_id,unidade_id,mes,ano,jornada_id,status')).map(e=>[e.id,e]))
  const S=Object.fromEntries((await all('servidores?select=id,nome')).map(s=>[s.id,s]))
  const temp=await all('servidores_jornadas_temporarias?select=servidor_id,jornada_id,data_inicio,data_fim')
  const ed=await all('escala_diaria?select=id,escala_mensal_id,dia,categoria,dicionario_turnos_id,presenca_entrada_em,presenca_saida_em,presenca_entrada_origem,presenca_saida_origem&categoria=in.(Plantão,Extra)')
  const jd=(s,a,m,d,jm)=>{const k=`${a}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const t=temp.find(x=>x.servidor_id===s&&x.data_inicio<=k&&x.data_fim>=k);return J[t?t.jornada_id:jm]}
  const orig={}, reais=[]
  for(const l of ed){
    const e=EM[l.escala_mensal_id]; if(!e) continue
    const t=T[l.dicionario_turnos_id]; if(!t||!(Number(t.horas_computadas)>6)) continue
    const u=Un[e.unidade_id]; if(!u?.permite_marca_intervalo) continue
    const j=jd(e.servidor_id,e.ano,e.mes,l.dia,e.jornada_id)
    if(Number(j?.intervalo_minutos ?? 60) > 0) continue
    const oe=l.presenca_entrada_origem||'-', os=l.presenca_saida_origem||'-'
    orig[`entrada:${oe}`]=(orig[`entrada:${oe}`]||0)+1
    orig[`saida:${os}`]=(orig[`saida:${os}`]||0)+1
    if(['rep','terminal'].includes(oe)||['rep','terminal'].includes(os))
      reais.push({comp:`${e.ano}-${String(e.mes).padStart(2,'0')}`,dia:l.dia,st:e.status,cod:t.codigo,serv:(S[e.servidor_id]?.nome||'').slice(0,26),uni:u.nome.slice(0,10),
        ent:l.presenca_entrada_em&&new Date(l.presenca_entrada_em).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo'}),oe,
        sai:l.presenca_saida_em&&new Date(l.presenca_saida_em).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo'}),os})
  }
  console.log('origens dos 106:',orig)
  console.log('\n=== os que tem batida REAL (rep/terminal) num plantao sem passo de intervalo ===')
  console.table(reais.sort((a,b)=>a.comp.localeCompare(b.comp)||a.dia-b.dia))
})()
