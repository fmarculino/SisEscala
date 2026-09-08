import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

async function q(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from+999}` } })
    if (!r.ok) { console.error(path, r.status, await r.text()); return out }
    const p = await r.json()
    out.push(...p)
    if (p.length < 1000) break
  }
  return out
}

const srv = await q(`servidores?select=id,nome,matricula,cpf,pis_pasep,status,unidade_id,setor_id&nome=ilike.*JEOSEANE*`)
console.log('=== SERVIDORES ===')
console.log(JSON.stringify(srv, null, 2))

const SID = '5defd039-5ce4-4e12-8892-5015e7bc3a58'
const ems = await q(`escala_mensal?select=id,mes,ano,unidade_id,setor_id,jornada_id,status&servidor_id=eq.${SID}&ano=eq.2026&mes=eq.9`)
console.log('\n=== ESCALA_MENSAL 09/2026 ===')
const unis = await q(`unidades?select=id,nome,permite_marca_intervalo,tipo_intervalo,fonte_ponto_oficial`)
const un = Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const jors = await q(`jornadas?select=id,nome,horas_totais,intervalo_minutos`)
const jo = Object.fromEntries(jors.map(j=>[j.id,j]))
for (const e of ems) console.log(e.id, un[e.unidade_id], '| jornada:', jo[e.jornada_id]?.nome, '| status:', e.status)

const ids = ems.map(e=>e.id).join(',')
const eds = await q(`escala_diaria?select=*&escala_mensal_id=in.(${ids})&dia=in.(6,7,8)&order=dia`)
console.log('\n=== ESCALA_DIARIA dias 6-8 ===')
for (const d of eds) {
  const em = ems.find(e=>e.id===d.escala_mensal_id)
  console.log(JSON.stringify({dia:d.dia, unidade:un[em.unidade_id], cat:d.categoria, turno:d.dicionario_turnos_id, hora_prev:d.hora_inicio_prevista,
    ent:d.presenca_entrada_em, ent_o:d.presenca_entrada_origem, sai_int:d.presenca_saida_intervalo_em, ret_int:d.presenca_retorno_intervalo_em,
    sai:d.presenca_saida_em, sai_o:d.presenca_saida_origem, recon:d.reconciliado_em, id:d.id}))
}
