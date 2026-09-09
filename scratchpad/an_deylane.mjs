import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,300));return r.json()}
const loc=s=>s?new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,19):'—'
const unis=await q('unidades?select=id,nome');const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const s=(await q(`servidores?select=id,nome,matricula,unidade_id,setor_id,status&nome=ilike.*DEYLANE*`))[0]
console.log('SERVIDORA:', s.nome, s.matricula, '| status', s.status)
console.log('  lotacao:', un[s.unidade_id], '| setor_id:', s.setor_id)
console.log('\n=== TENTATIVAS RECUSADAS (07-09/09) ===')
const t=await q(`logs_tentativas_presenca?select=*&servidor_id=eq.${s.id}&data_hora_tentativa=gte.2026-09-07&order=data_hora_tentativa`)
for(const x of t) console.log(` ${loc(x.data_hora_tentativa)} | "${x.mensagem_erro}" | mat_digitada=${x.matricula_digitada} | prev ${x.escala_prevista_inicio}-${x.escala_prevista_fim}`)
console.log('\n=== MARCACOES (07-09/09) ===')
const m=await q(`marcacoes_ponto?select=id,ocorrido_em,origem,unidade_id,setor_id,dispositivo_id,observacao&servidor_id=eq.${s.id}&ocorrido_em=gte.2026-09-07&order=ocorrido_em`)
for(const x of m) console.log(` ${loc(x.ocorrido_em)} | ${x.origem} | ${un[x.unidade_id]||'?'} | setor=${x.setor_id||'—'} | ${x.observacao||''}`)
console.log('\n=== ESCALA 09/2026 ===')
const ems=await q(`escala_mensal?select=id,unidade_id,setor_id,jornada_id,status&servidor_id=eq.${s.id}&ano=eq.2026&mes=eq.9`)
for(const e of ems){
  const j=(await q(`jornadas?select=nome&id=eq.${e.jornada_id}`))[0]
  console.log(` ${un[e.unidade_id]} | setor=${e.setor_id} | jornada ${j?.nome} | ${e.status}`)
  const d=await q(`escala_diaria?select=dia,categoria,presenca_entrada_em,presenca_saida_em,presenca_entrada_origem&escala_mensal_id=eq.${e.id}&dia=in.(7,8,9)&order=dia`)
  for(const x of d) console.log(`   dia ${x.dia} ${x.categoria} ent=${loc(x.presenca_entrada_em)} (${x.presenca_entrada_origem||'—'}) sai=${loc(x.presenca_saida_em)}`)
}
