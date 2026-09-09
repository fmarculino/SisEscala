import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error(r.status,(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const loc=s=>s?new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16):'—'
const t=await q(`logs_tentativas_presenca?select=*&mensagem_erro=ilike.*Sem permiss*&order=data_hora_tentativa.desc`)
console.log('=== TENTATIVAS "Sem permissao..." (base inteira) ===')
console.log('total:', t.length)
if(t.length){
  console.log('colunas do log:', Object.keys(t[0]).join(', '))
  const porDia={}; for(const x of t){const d=loc(x.data_hora_tentativa).slice(0,10); porDia[d]=(porDia[d]||0)+1}
  console.log('\npor dia:'); for(const [d,n] of Object.entries(porDia).sort()) console.log(`  ${d}  ${n}`)
  const srvs=await q('servidores?select=id,nome,matricula,unidade_id,setor_id')
  const sn=Object.fromEntries(srvs.map(s=>[s.id,s]))
  const unis=await q('unidades?select=id,nome'); const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
  const pessoas=new Set(t.map(x=>x.servidor_id).filter(Boolean))
  console.log('\npessoas distintas:', pessoas.size)
  const porSetor={}
  for(const p of pessoas){const s=sn[p]; if(!s)continue; const k=`${un[s.unidade_id]} | setor ${s.setor_id}`; porSetor[k]=(porSetor[k]||0)+1}
  console.log('\npor unidade/setor da PESSOA:')
  for(const [k,n] of Object.entries(porSetor).sort((a,b)=>b[1]-a[1])) console.log(`  ${n}  ${k}`)
  console.log('\n=== amostra (10 mais recentes) ===')
  for(const x of t.slice(0,10)) console.log(`  ${loc(x.data_hora_tentativa)} mat=${x.matricula_digitada} ${sn[x.servidor_id]?.nome||'(sem servidor)'}`)
}
