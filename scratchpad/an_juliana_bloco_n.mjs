import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok)return [];return r.json()}
async function rpc(fn,b){const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok){console.error(fn,r.status,t.slice(0,200));return null}return JSON.parse(t)}
const s=(await q(`servidores?select=id&matricula=eq.68184`))[0]
const unis=await q(`unidades?select=id,nome`);const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const ems=await q(`escala_mensal?select=id,unidade_id&servidor_id=eq.${s.id}&ano=eq.2026&mes=eq.9`)
const emU=Object.fromEntries(ems.map(e=>[e.id,un[e.unidade_id]]))
const loc=x=>x?new Date(new Date(x).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16):'—'
for(const dia of ['2026-09-05','2026-09-07','2026-09-19','2026-09-01']){
  console.log(`\n### ${dia}`)
  const b=await rpc('fn_blocos_previstos_dia',{p_servidor_id:s.id,p_data:dia})
  for(const bl of b){
    const us=[];for(const id of bl.escala_diaria_ids){const d=(await q(`escala_diaria?select=escala_mensal_id&id=eq.${id}`))[0];us.push(emU[d.escala_mensal_id])}
    console.log(`  bloco ${bl.bloco_ordem} ${bl.categoria} @ ${us.join('+')} : ${loc(bl.inicio_previsto)} -> ${loc(bl.fim_previsto)}`)
  }
}
