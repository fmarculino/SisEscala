import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: E.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${E.SUPABASE_SERVICE_ROLE_KEY}` }
const get = async p => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(`${p} -> ${r.status} ${await r.text()}`); return r.json() }
const rpc = async (f, b) => { const r = await fetch(`${U}/rest/v1/rpc/${f}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); return { status: r.status, body: t } }

const srv = await get(`servidores?select=id,nome,matricula,cpf,unidade_id,setor_id,status&nome=ilike.*THAYNA DE MORAES*`)
console.log('=== SERVIDOR ===')
for (const s of srv) console.log(`  mat ${s.matricula} | ${s.nome} | ${s.status} | cpf ${s.cpf} | id ${s.id}`)

for (const s of srv) {
  const ems = await get(`escala_mensal?select=id,mes,ano,unidade_id,setor_id,status,jornada_id&servidor_id=eq.${s.id}&ano=eq.2026&order=mes`)
  for (const em of ems) {
    const eds = await get(`escala_diaria?select=id,dia,categoria,dicionario_turnos_id,hora_inicio_prevista,presenca_entrada_em,presenca_entrada_origem,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em,presenca_saida_origem,reconciliado_em&escala_mensal_id=eq.${em.id}&dia=in.(2,3,4)&order=dia`)
    if (!eds.length) continue
    const j = em.jornada_id ? (await get(`jornadas?select=nome,horas_totais,intervalo_minutos&id=eq.${em.jornada_id}`))[0] : null
    console.log(`\n=== ESCALA ${em.mes}/${em.ano} | status ${em.status} | jornada ${j?.nome ?? '-'} (${j?.horas_totais}h, int ${j?.intervalo_minutos}min) ===`)
    for (const d of eds) {
      const tn = d.dicionario_turnos_id ? (await get(`dicionario_turnos?select=codigo,horario_inicio,horas_computadas,slots&id=eq.${d.dicionario_turnos_id}`))[0] : null
      console.log(`  dia ${d.dia} ${d.categoria} turno ${tn?.codigo ?? '-'} (inicio ${tn?.horario_inicio ?? '-'}, ${tn?.horas_computadas ?? '-'}h) horaPrev ${d.hora_inicio_prevista ?? '-'}`)
      console.log(`     E ${d.presenca_entrada_em ?? '-'} (${d.presenca_entrada_origem ?? '-'}) | IS ${d.presenca_intervalo_saida_em ?? '-'} | IR ${d.presenca_intervalo_retorno_em ?? '-'} | S ${d.presenca_saida_em ?? '-'} (${d.presenca_saida_origem ?? '-'}) | rec ${d.reconciliado_em ?? 'NUNCA'}`)
    }
    // marcacoes do dia 2 a 4
    const mm = await get(`marcacoes_ponto?select=id,origem,ocorrido_em,sintetica,dispositivo_id,unidade_id,nsr&servidor_id=eq.${s.id}&ocorrido_em=gte.2026-${String(em.mes).padStart(2,'0')}-02T00:00:00-03:00&ocorrido_em=lt.2026-${String(em.mes).padStart(2,'0')}-05T00:00:00-03:00&order=ocorrido_em`)
    console.log(`  --- marcacoes (${mm.length}) ---`)
    const ids = mm.map(m => m.id)
    const tr = ids.length ? await get(`marcacoes_tratamentos?select=marcacao_id,tipo,created_at,justificativa&marcacao_id=in.(${ids.join(',')})&order=created_at`) : []
    const ult = new Map()
    for (const t of tr) { const a = ult.get(t.marcacao_id); if (!a || new Date(t.created_at) > new Date(a.created_at)) if (['desconsiderar','restaurar'].includes(t.tipo)) ult.set(t.marcacao_id, t) }
    for (const m of mm) {
      const u = ult.get(m.id)
      const flag = u?.tipo === 'desconsiderar' ? '  <<< DESCONSIDERADA' : ''
      console.log(`     ${m.ocorrido_em} | ${m.origem} | sint ${m.sintetica} | nsr ${m.nsr ?? '-'} | uni ${m.unidade_id}${flag}`)
      if (u) console.log(`         ultimo tratamento: ${u.tipo} em ${u.created_at} -- ${(u.justificativa||'').slice(0,60)}`)
    }
    // o que a projecao diria
    for (const dd of [2, 3, 4]) {
      const r = await rpc('fn_conferir_reconciliacao', { p_data_inicio: `2026-${String(em.mes).padStart(2,'0')}-${String(dd).padStart(2,'0')}`, p_data_fim: `2026-${String(em.mes).padStart(2,'0')}-${String(dd).padStart(2,'0')}`, p_servidor_id: s.id })
      console.log(`  --- diff da projecao dia ${dd}: HTTP ${r.status} ${r.body.slice(0, 700)}`)
    }
  }
}
