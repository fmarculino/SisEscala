import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l && !l.startsWith('#') && l.includes('='))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
const q = async (p) => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j }

const servs = await q(`servidores?select=id,nome,matricula,status,unidade_id,setor_id&nome=ilike.*EUZILENE*`)
console.log('SERVIDORES:', JSON.stringify(servs, null, 1))
for (const s of servs) {
  const ems = await q(`escala_mensal?select=id,mes,ano,status,unidade_id,setor_id,jornada_id,jornadas(nome,horas_totais,intervalo_minutos)&servidor_id=eq.${s.id}&mes=eq.9&ano=eq.2026`)
  console.log('\n== ESCALAS 09/2026 de', s.nome, s.matricula, JSON.stringify(ems, null, 1))
  for (const em of ems) {
    const eds = await q(`escala_diaria?select=id,dia,categoria,dicionario_turnos_id,hora_inicio_prevista,presenca_entrada_em,presenca_entrada_origem,presenca_entrada_marcacao_id,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em,presenca_saida_origem,presenca_saida_marcacao_id,presenca_confirmada,justificativa_manual,reconciliado_em,dicionario_turnos(codigo,horas_computadas,horario_inicio)&escala_mensal_id=eq.${em.id}&dia=gte.11&dia=lte.13&order=dia,categoria`)
    console.log('  DIAS 11-13:', JSON.stringify(eds, null, 1))
  }
  const mp = await q(`marcacoes_ponto?select=id,ocorrido_em,origem,dispositivo_id,unidade_id,setor_id,sintetica,nsr&servidor_id=eq.${s.id}&ocorrido_em=gte.2026-09-11T00:00:00-03:00&ocorrido_em=lt.2026-09-14T00:00:00-03:00&order=ocorrido_em`)
  console.log('  MARCACOES 11-13/09:', JSON.stringify(mp, null, 1))
}
