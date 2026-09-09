import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,200));return r.json()}
async function rpc(f,b){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok)throw new Error(t.slice(0,200));return JSON.parse(t)}
const loc=s=>s?new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16):'—'
const t=await q(`logs_tentativas_presenca?select=servidor_id,data_hora_tentativa&mensagem_erro=ilike.*Sem permiss*&data_hora_tentativa=lt.2026-09-08`)
const pares=new Set(); for(const x of t) if(x.servidor_id) pares.add(`${x.servidor_id}|${loc(x.data_hora_tentativa).slice(0,10)}`)
const srvs=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/servidores?select=id,nome,matricula`,{headers:{...H,Range:`${f}-${f+999}`}});const g=await r.json();srvs.push(...g);if(g.length<1000)break};const sn=Object.fromEntries(srvs.map(s=>[s.id,s]))
console.log('=== dias ANTERIORES a 08/09 com batida recusada por permissao ===')
for(const k of [...pares].sort()){
  const [srv,data]=k.split('|')
  const proj=await rpc('fn_projecao_marcacoes_dia',{p_servidor_id:srv,p_data:data})
  for(const p of proj||[]){
    const d=(await q(`escala_diaria?select=presenca_entrada_em,presenca_saida_em,presenca_entrada_origem,presenca_saida_origem&id=eq.${p.escala_diaria_id}`))[0]
    console.log(`${data} ${sn[srv].nome.slice(0,28).padEnd(29)} GRAVADO ent ${loc(d.presenca_entrada_em)}(${d.presenca_entrada_origem||'—'}) sai ${loc(d.presenca_saida_em)}(${d.presenca_saida_origem||'—'})  | PROJ ent ${loc(p.entrada_em)} sai ${loc(p.saida_em)}`)
  }
}
