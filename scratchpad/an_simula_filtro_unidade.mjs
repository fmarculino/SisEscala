import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type':'application/json' }
async function q(p){ const r=await fetch(`${U}/rest/v1/${p}`,{headers:H}); if(!r.ok){console.error(r.status,(await r.text()).slice(0,200));return []} return r.json() }
async function rpc(fn,b){ const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)}); const t=await r.text(); if(!r.ok){console.error(fn,r.status,t.slice(0,200));return null} return JSON.parse(t) }
const unis=await q(`unidades?select=id,nome`); const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const loc=s=>s?new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16):'—'
// os 8 pares afetados
const CASOS=[
 ['FERNANDO','69497','2026-08-15'],['FERNANDO','69497','2026-08-24'],
 ['JULIANA','68184','2026-09-01'],['JULIANA','68184','2026-09-03'],
 ['MARIA DA CONCEICAO','1272','2026-09-01'],['MARIA DA CONCEICAO','1272','2026-09-03'],['MARIA DA CONCEICAO','1272','2026-09-08'],
 ['JEOSEANE','67689','2026-09-07']]
for(const [nome,mat,data] of CASOS){
  const s=(await q(`servidores?select=id,nome,matricula&matricula=eq.${mat}`))[0]
  console.log(`\n########## ${s.nome} — ${data}`)
  const blocos=await rpc('fn_blocos_previstos_dia',{p_servidor_id:s.id,p_data:data})
  const eds=[...new Set(blocos.flatMap(b=>b.escala_diaria_ids))]
  const edMap={}
  for(const id of eds){ const d=(await q(`escala_diaria?select=id,dia,categoria,escala_mensal_id&id=eq.${id}`))[0]
    const em=(await q(`escala_mensal?select=unidade_id&id=eq.${d.escala_mensal_id}`))[0]; edMap[id]={...d,unidade:un[em.unidade_id]} }
  for(const b of blocos) console.log(`  BLOCO ${b.bloco_ordem} ${b.categoria} @ ${b.escala_diaria_ids.map(i=>edMap[i].unidade).join('/')} : ${loc(b.inicio_previsto)} -> ${loc(b.fim_previsto)} | int ${loc(b.intervalo_inicio_previsto)}-${loc(b.intervalo_fim_previsto)}`)
  const d0=new Date(data+'T00:00:00Z'); const ini=new Date(d0.getTime()-18*3600e3).toISOString(), fim=new Date(d0.getTime()+42*3600e3).toISOString()
  const ms=await q(`marcacoes_ponto?select=id,ocorrido_em,unidade_id,origem,dispositivo_id&servidor_id=eq.${s.id}&ocorrido_em=gte.${ini}&ocorrido_em=lte.${fim}&order=ocorrido_em`)
  console.log('  batidas na janela:')
  for(const m of ms) console.log(`    ${loc(m.ocorrido_em)} | ${m.origem} | ${un[m.unidade_id]||'(sem unidade)'}`)
  const proj=await rpc('fn_projecao_marcacoes_dia',{p_servidor_id:s.id,p_data:data})
  console.log('  projecao ATUAL:')
  for(const p of proj||[]){ const e=edMap[p.escala_diaria_id]
    const mid=[p.entrada_marcacao_id,p.int_saida_marcacao_id,p.int_ret_marcacao_id,p.saida_marcacao_id]
    const uu=mid.map(i=>{const m=ms.find(x=>x.id===i); return m?un[m.unidade_id]:null})
    console.log(`    ${(e?e.unidade+' '+e.categoria:'?').padEnd(60)} ent ${loc(p.entrada_em)}[${uu[0]||''}] intS ${loc(p.int_saida_em)}[${uu[1]||''}] intR ${loc(p.int_ret_em)}[${uu[2]||''}] sai ${loc(p.saida_em)}[${uu[3]||''}]`) }
}
