import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,200));const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
async function rpc(f,b){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok)throw new Error(`${f}: ${r.status} ${t.slice(0,200)}`);return JSON.parse(t)}
const loc=s=>s?new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16):'—'
const srvs=await q('servidores?select=id,nome,matricula');const sn=Object.fromEntries(srvs.map(s=>[s.id,s]))

// as marcacoes criadas pelas tentativas recusadas por permissao
const t=await q(`logs_tentativas_presenca?select=servidor_id,data_hora_tentativa&mensagem_erro=ilike.*Sem permiss*`)
const pares=new Set()
for(const x of t){ if(!x.servidor_id) continue
  pares.add(`${x.servidor_id}|${loc(x.data_hora_tentativa).slice(0,10)}`) }
console.log('pares (servidor, dia) com batida recusada por permissao:', pares.size)

let recup=0, semGanho=0, misto=0, semEscala=0
const detalhe=[]
for(const k of pares){
  const [srv,data]=k.split('|')
  let proj
  try{ proj=await rpc('fn_projecao_marcacoes_dia',{p_servidor_id:srv,p_data:data}) }catch(e){ semEscala++; continue }
  if(!proj||!proj.length){ semEscala++; continue }
  // estado atual
  const ids=proj.map(p=>p.escala_diaria_id)
  const eds=await q(`escala_diaria?select=id,presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em&id=in.(${ids.join(',')})`)
  const cur=Object.fromEntries(eds.map(d=>[d.id,d]))
  let g=0,tr=0,pe=0
  for(const p of proj){ const d=cur[p.escala_diaria_id]; if(!d) continue
    for(const [a,b] of [['presenca_entrada_em','entrada_em'],['presenca_intervalo_saida_em','int_saida_em'],['presenca_intervalo_retorno_em','int_ret_em'],['presenca_saida_em','saida_em']]){
      const antes=d[a], depois=p[b]
      if(antes===depois) continue
      if(!antes&&depois) g++; else if(antes&&!depois) pe++; else tr++ } }
  if(g>0&&tr===0&&pe===0){ recup++; detalhe.push({srv,data,g}) }
  else if(g===0&&tr===0&&pe===0) semGanho++
  else misto++
}
console.log(`\nSO ACRESCENTA (recuperavel com seguranca): ${recup}`)
console.log(`nada muda: ${semGanho}`)
console.log(`tem troca/perda junto: ${misto}`)
console.log(`sem escala/projecao: ${semEscala}`)
console.log('\n=== os recuperaveis ===')
let campos=0
for(const d of detalhe.sort((a,b)=>a.data<b.data?-1:1)){ campos+=d.g
  console.log(`  ${d.data}  ${sn[d.srv].nome} (${sn[d.srv].matricula})  +${d.g} horario(s)`) }
console.log(`\ntotal de horarios a recuperar: ${campos}`)
