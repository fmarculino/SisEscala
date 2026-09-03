import { get, rpc } from './q.mjs'
const F=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—'
const s = await get(`servidores?nome=ilike.*NEURIAN*&select=id,nome,matricula`)
console.log(s)
const SID=s[0].id
const ems = await get(`escala_mensal?servidor_id=eq.${SID}&ano=eq.2026&mes=in.(8,9)&select=id,mes,jornada_id,status,ativo,setor_id`)
console.log('escalas:', JSON.stringify(ems))
const m = await get(`marcacoes_ponto?servidor_id=eq.${SID}&ocorrido_em=gte.2026-08-31T00:00:00-03:00&ocorrido_em=lt.2026-09-04T00:00:00-03:00&select=id,ocorrido_em,origem&order=ocorrido_em`)
console.log('\nMARCACOES:'); for(const r of m) console.log('  ', F(r.ocorrido_em), r.origem)
for(const em of ems.filter(e=>e.mes===9)){
  const ed = await get(`escala_diaria?escala_mensal_id=eq.${em.id}&dia=in.(1,2)&select=id,dia,categoria,dicionario_turnos_id,presenca_entrada_em,presenca_saida_em,presenca_entrada_origem,presenca_saida_origem,presenca_confirmada`)
  console.log('\nESCALA_DIARIA (setembro):')
  for(const r of ed) console.log(`  dia ${r.dia} ${r.categoria.padEnd(9)} entrada ${F(r.presenca_entrada_em)} (${r.presenca_entrada_origem||'-'}) | saida ${F(r.presenca_saida_em)} (${r.presenca_saida_origem||'-'})`)
  const b = await rpc('fn_blocos_previstos_dia',{p_servidor_id:SID,p_data:'2026-09-01'})
  console.log('\nBLOCO PREVISTO 01/09:', JSON.stringify(b))
  const a = await rpc('fn_alocar_marcacoes_dia',{p_servidor_id:SID,p_data:'2026-09-01'})
  console.log('\nALOCACAO 01/09:'); console.log('  slots:', a.slots)
  for(const x of (a.alocacoes||[])) console.log(`   ${x.passo.padEnd(17)} previsto ${F(x.previsto)} dist ${x.distancia_min}min`)
  for(const p of (a.pendencias||[])) console.log(`   PENDENCIA ${p.tipo} ${p.ocorrido_em?F(p.ocorrido_em):''} ${p.passo||''}`)
}
