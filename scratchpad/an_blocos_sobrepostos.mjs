import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error(r.status,(await r.text()).slice(0,150));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
async function rpc(f,b){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok)return null;return JSON.parse(t)}
const ems=await q('escala_mensal?select=id,servidor_id,mes,ano,unidade_id&order=id')
const emById=Object.fromEntries(ems.map(e=>[e.id,e]))
const eds=await q(`escala_diaria?select=id,escala_mensal_id,dia,categoria&categoria=in.(Regular,Plantão,Extra)&order=id`)
const mapa={}
for(const d of eds){const em=emById[d.escala_mensal_id];if(!em)continue
  const k=`${em.servidor_id}|${em.ano}-${String(em.mes).padStart(2,'0')}-${String(d.dia).padStart(2,'0')}`
  ;(mapa[k]=mapa[k]||new Set()).add(em.unidade_id)}
const multi=Object.entries(mapa).filter(([,s])=>s.size>1)
console.log('pares (servidor,dia) com escala em 2+ unidades:',multi.length)
const srvs=await q('servidores?select=id,nome,matricula');const sn=Object.fromEntries(srvs.map(s=>[s.id,s]))
const loc=s=>new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16)
let sobrepostos=0
console.log('\n=== BLOCOS COM PREVISTOS QUE SE SOBREPOEM (o DP monotonico nao casa a virada) ===')
for(const [k] of multi){
  const [srv,data]=k.split('|')
  const b=await rpc('fn_blocos_previstos_dia',{p_servidor_id:srv,p_data:data})
  if(!b||b.length<2) continue
  const ord=[...b].sort((x,y)=>x.inicio_previsto<y.inicio_previsto?-1:1)
  for(let i=0;i+1<ord.length;i++){
    if(new Date(ord[i+1].inicio_previsto) < new Date(ord[i].fim_previsto)){
      sobrepostos++
      const min=Math.round((new Date(ord[i].fim_previsto)-new Date(ord[i+1].inicio_previsto))/60000)
      console.log(` ${data} ${sn[srv].nome} (${sn[srv].matricula}): ${loc(ord[i].inicio_previsto)}->${loc(ord[i].fim_previsto)} e ${loc(ord[i+1].inicio_previsto)}->${loc(ord[i+1].fim_previsto)}  sobrepoem ${min} min`)
    }
  }
}
console.log(`\ntotal de fronteiras sobrepostas: ${sobrepostos}`)
