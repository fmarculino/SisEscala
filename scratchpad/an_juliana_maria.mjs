import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function q(p){ const r=await fetch(`${U}/rest/v1/${p}`,{headers:H}); if(!r.ok){console.error(r.status,(await r.text()).slice(0,200));return []} return r.json() }
const unis=await q(`unidades?select=id,nome`); const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const disp=await q(`dispositivos_rep?select=id,nome,unidade_id`); const dn=Object.fromEntries(disp.map(d=>[d.id,d.nome]))
const loc=s=>new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16)
for (const nome of ['JULIANA DOS SANTOS RODRIGUES','MARIA DA CONCEICAO BRITO MOURA']) {
  const s=(await q(`servidores?select=id,nome,matricula,unidade_id,setor_id&nome=ilike.*${encodeURIComponent(nome)}*`))[0]
  if(!s){console.log('nao achou',nome);continue}
  console.log(`\n===== ${s.nome} (${s.matricula}) — lotacao: ${un[s.unidade_id]}`)
  const ems=await q(`escala_mensal?select=id,mes,ano,unidade_id&servidor_id=eq.${s.id}&ano=eq.2026&mes=eq.9`)
  for(const e of ems) console.log('  escala 09/2026:', un[e.unidade_id])
  const ms=await q(`marcacoes_ponto?select=ocorrido_em,dispositivo_id,unidade_id&servidor_id=eq.${s.id}&ocorrido_em=gte.2026-09-01&ocorrido_em=lt.2026-09-04&order=ocorrido_em`)
  console.log('  batidas 01-03/09:')
  for(const m of ms) console.log('   ',loc(m.ocorrido_em),'|',dn[m.dispositivo_id]||'(terminal)','|',un[m.unidade_id])
  const eds=await q(`escala_diaria?select=escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em&escala_mensal_id=in.(${ems.map(e=>e.id).join(',')})&dia=in.(1,2,3)&order=dia`)
  console.log('  escala_diaria 1-3:')
  for(const d of eds){ const e=ems.find(x=>x.id===d.escala_mensal_id)
    console.log('   dia',d.dia,d.categoria,'@',un[e.unidade_id],'|',loc(d.presenca_entrada_em),'/',loc(d.presenca_intervalo_saida_em),'/',loc(d.presenca_intervalo_retorno_em),'/',loc(d.presenca_saida_em)) }
}
