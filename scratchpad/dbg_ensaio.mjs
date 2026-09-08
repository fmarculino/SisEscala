import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,200));return r.json()}
async function rpc(f,b){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok)throw new Error(t.slice(0,300));return JSON.parse(t)}
const SID='5defd039-5ce4-4e12-8892-5015e7bc3a58'
const unis=await q('unidades?select=id,nome');const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const loc=s=>s?new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16):'—'
const proj=await rpc('fn_projecao_marcacoes_dia',{p_servidor_id:SID,p_data:'2026-09-07'})
console.log('linhas devolvidas pela projecao:', proj.length)
for(const p of proj){
  const d=(await q(`escala_diaria?select=id,dia,categoria,escala_mensal_id,presenca_entrada_em,presenca_saida_em&id=eq.${p.escala_diaria_id}`))[0]
  const em=(await q(`escala_mensal?select=unidade_id,mes,ano&id=eq.${d.escala_mensal_id}`))[0]
  console.log(`\nescala_diaria ${p.escala_diaria_id}`)
  console.log(`  BANCO : dia ${d.dia} ${d.categoria} @ ${un[em.unidade_id]} | ent ${loc(d.presenca_entrada_em)} sai ${loc(d.presenca_saida_em)}`)
  console.log(`  PROJ  : ent ${loc(p.entrada_em)} sai ${loc(p.saida_em)}`)
}
