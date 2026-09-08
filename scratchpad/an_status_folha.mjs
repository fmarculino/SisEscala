import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok){console.error(r.status,(await r.text()).slice(0,200));return []}return r.json()}
const unis=await q(`unidades?select=id,nome`);const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
for(const mat of ['69497','68184','1272','67689']){
  const s=(await q(`servidores?select=id,nome,matricula&matricula=eq.${mat}`))[0]
  const ems=await q(`escala_mensal?select=id,mes,ano,unidade_id,status&servidor_id=eq.${s.id}&ano=eq.2026&mes=in.(8,9)`)
  console.log(`\n${s.nome} (${mat})`)
  for(const e of ems){
    const f=await q(`folha_ponto?select=id,status,total_horas_normais,total_horas_extras&escala_mensal_id=eq.${e.id}`)
    console.log(`  ${String(e.mes).padStart(2,'0')}/2026 ${un[e.unidade_id].slice(0,40).padEnd(42)} escala:${e.status.padEnd(10)} folha:${f[0]?`${f[0].status} (norm ${f[0].total_horas_normais}h, extra ${f[0].total_horas_extras}h)`:'(nao gerada)'}`)
  }
}
const cfg=await q(`competencias_encerradas?select=*&limit=5`).catch(()=>[])
console.log('\ncompetencias_encerradas:',JSON.stringify(cfg))
