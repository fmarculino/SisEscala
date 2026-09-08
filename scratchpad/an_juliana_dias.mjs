import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok)return [];return r.json()}
const s=(await q(`servidores?select=id&matricula=eq.68184`))[0]
const unis=await q(`unidades?select=id,nome`);const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const ems=await q(`escala_mensal?select=id,unidade_id&servidor_id=eq.${s.id}&ano=eq.2026&mes=eq.9`)
const loc=x=>x?new Date(new Date(x).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16):'—'
console.log('=== escala_diaria 09/2026 da JULIANA (presenca gravada) ===')
for(const e of ems){
  const eds=await q(`escala_diaria?select=dia,categoria,presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em&escala_mensal_id=eq.${e.id}&order=dia`)
  console.log(`\n-- ${un[e.unidade_id]}`)
  for(const d of eds) if(d.presenca_entrada_em||d.presenca_saida_em)
    console.log(`  dia ${String(d.dia).padStart(2)} ${d.categoria.padEnd(8)} ent ${loc(d.presenca_entrada_em)} | intS ${loc(d.presenca_intervalo_saida_em)} | intR ${loc(d.presenca_intervalo_retorno_em)} | sai ${loc(d.presenca_saida_em)}`)
}
