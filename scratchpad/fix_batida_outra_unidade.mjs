/**
 * Corrige os passos de escala_diaria que foram preenchidos por batida de OUTRA unidade.
 *
 * RODAR SOMENTE DEPOIS de 20260908140000 e 20260908150000 estarem aplicadas — e' a alocacao
 * nova que produz o resultado correto. Antes delas, reconciliar so' reescreveria o mesmo erro.
 *
 * ⚠️ LISTA FECHADA, COM ENSAIO ANTES/DEPOIS. Reconciliar em massa piora mais do que corrige
 * (medido em 03/09/2026: 4 ganhos contra 43 trocas e 7 perdas). Aqui os pares saem de uma
 * medicao — passo cuja marcacao e' de relogio de unidade diferente da escala — e cada campo e'
 * classificado em ganho / troca / perda antes de qualquer escrita.
 *
 * ⚠️ "Perda" nem sempre e' perda: a mesma batida mudando de passo aparece como perda de um lado
 * e ganho de outro. Leia linha a linha — e' isso que separa corrigir de apagar ponto.
 *
 *   node scratchpad/fix_batida_outra_unidade.mjs            # ensaio, nao escreve nada
 *   node scratchpad/fix_batida_outra_unidade.mjs --aplicar  # escreve
 */
import { env } from './_env.mjs'

const APLICAR = process.argv.includes('--aplicar')
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

// Competencias a tocar. 08/2026 fica de fora de proposito: a escala esta Fechada e os 4 passos
// de la sao testes de relogio do administrador do parque, cujo caminho e' marcacoes_tratamentos
// com `desconsiderar`, nao reconciliacao.
const ANO = 2026
const MESES = [9]

// Excluidos com motivo. Reconciliar contra um previsto errado troca um erro por outro.
const EXCLUIR = {
  68184: 'jornada cadastrada como 07H AS 19H mas cumpre 19H AS 07H no HMI — o previsto do '
       + 'Regular N sai invertido (07:00->19:00). Corrigir a jornada ANTES de reconciliar.',
}

async function q(p) {
  const out = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${U}/rest/v1/${p}`, { headers: { ...H, Range: `${f}-${f + 999}` } })
    if (!r.ok) throw new Error(`${p.slice(0, 90)} -> ${r.status} ${(await r.text()).slice(0, 200)}`)
    const g = await r.json(); out.push(...g)
    if (g.length < 1000) break
  }
  return out
}
async function rpc(fn, body) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  const t = await r.text()
  if (!r.ok) throw new Error(`${fn} -> ${r.status} ${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : null
}

const loc = s => (s ? new Date(new Date(s).getTime() - 3 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) : '—')
const PASSOS = [
  ['presenca_entrada_em', 'presenca_entrada_marcacao_id', 'entrada_em', 'entrada_marcacao_id', 'entrada'],
  ['presenca_intervalo_saida_em', 'presenca_intervalo_saida_marcacao_id', 'int_saida_em', 'int_saida_marcacao_id', 'int.saida'],
  ['presenca_intervalo_retorno_em', 'presenca_intervalo_retorno_marcacao_id', 'int_ret_em', 'int_ret_marcacao_id', 'int.retorno'],
  ['presenca_saida_em', 'presenca_saida_marcacao_id', 'saida_em', 'saida_marcacao_id', 'saida'],
]

// ---------------------------------------------------------------- levantamento
const unis = await q('unidades?select=id,nome')
const un = Object.fromEntries(unis.map(u => [u.id, u.nome]))
const srvs = await q('servidores?select=id,nome,matricula')
const sn = Object.fromEntries(srvs.map(s => [s.id, s]))

const ems = await q(`escala_mensal?select=id,servidor_id,mes,ano,unidade_id&ano=eq.${ANO}&mes=in.(${MESES.join(',')})`)
const emById = Object.fromEntries(ems.map(e => [e.id, e]))

const colsId = PASSOS.map(p => p[1])
const eds = []
for (let i = 0; i < ems.length; i += 60) {
  const ids = ems.slice(i, i + 60).map(e => e.id).join(',')
  eds.push(...await q(`escala_diaria?select=id,escala_mensal_id,dia,categoria,${PASSOS.map(p => p[0]).join(',')},${colsId.join(',')}&escala_mensal_id=in.(${ids})`))
}

const marcIds = new Set()
for (const d of eds) for (const c of colsId) if (d[c]) marcIds.add(d[c])
const marc = {}
const arr = [...marcIds]
for (let i = 0; i < arr.length; i += 120) {
  for (const m of await q(`marcacoes_ponto?select=id,unidade_id,origem,dispositivo_id,ocorrido_em&id=in.(${arr.slice(i, i + 120).join(',')})`)) marc[m.id] = m
}

const alvos = new Map()
for (const d of eds) {
  const em = emById[d.escala_mensal_id]; if (!em) continue
  for (const [, colId] of PASSOS.map(p => [p[0], p[1]])) {
    const m = marc[d[colId]]
    if (!m || m.origem !== 'rep' || !m.dispositivo_id || !m.unidade_id) continue
    if (m.unidade_id === em.unidade_id) continue
    const dataISO = `${em.ano}-${String(em.mes).padStart(2, '0')}-${String(d.dia).padStart(2, '0')}`
    alvos.set(`${em.servidor_id}|${dataISO}`, { servidor_id: em.servidor_id, data: dataISO })
  }
}

const lista = [...alvos.values()].sort((a, b) => (a.data + sn[a.servidor_id].matricula).localeCompare(b.data + sn[b.servidor_id].matricula))
const excluidos = lista.filter(a => EXCLUIR[sn[a.servidor_id].matricula])
const trabalhar = lista.filter(a => !EXCLUIR[sn[a.servidor_id].matricula])

console.log(`=== ALVOS em ${MESES.map(m => String(m).padStart(2, '0')).join(',')}/${ANO} ===`)
console.log(`pares (servidor, dia) com passo preenchido por batida de outra unidade: ${lista.length}`)
if (excluidos.length) {
  console.log(`\n--- EXCLUIDOS (${excluidos.length}) ---`)
  for (const a of excluidos) {
    console.log(`  ${a.data} ${sn[a.servidor_id].nome} (${sn[a.servidor_id].matricula})`)
    console.log(`     motivo: ${EXCLUIR[sn[a.servidor_id].matricula]}`)
  }
}
console.log(`\n--- A CORRIGIR: ${trabalhar.length} ---`)

// ---------------------------------------------------------------- ensaio
let ganho = 0, troca = 0, perda = 0, igual = 0
const linhasEd = Object.fromEntries(eds.map(d => [d.id, d]))

for (const a of trabalhar) {
  const s = sn[a.servidor_id]
  console.log(`\n### ${a.data} — ${s.nome} (${s.matricula})`)
  const proj = await rpc('fn_projecao_marcacoes_dia', { p_servidor_id: a.servidor_id, p_data: a.data })
  for (const p of proj || []) {
    const d = linhasEd[p.escala_diaria_id]
    if (!d) { console.log(`   (linha ${p.escala_diaria_id} fora da competencia trabalhada — ignorada)`); continue }
    const em = emById[d.escala_mensal_id]
    console.log(`   ${un[em.unidade_id]} · ${d.categoria}`)
    for (const [colEm, colId, projEm, projId, rot] of PASSOS) {
      const antes = d[colEm], depois = p[projEm]
      const mAntes = marc[d[colId]], mDepois = p[projId] ? (marc[p[projId]] || null) : null
      const ondeA = mAntes?.unidade_id ? un[mAntes.unidade_id] : null
      if (!antes && !depois) continue
      let tag
      if (antes === depois) { tag = '  ='; igual++ }
      else if (!antes && depois) { tag = ' ++'; ganho++ }
      else if (antes && !depois) { tag = ' --'; perda++ }
      else { tag = ' ~~'; troca++ }
      console.log(`     ${tag} ${rot.padEnd(11)} ${loc(antes).padEnd(17)}${ondeA ? `[${ondeA.slice(0, 22)}]` : ''}  ->  ${loc(depois)}`)
    }
  }
}

console.log(`\n=== RESUMO DO ENSAIO ===`)
console.log(`ganhos (vazio -> preenchido): ${ganho}`)
console.log(`trocas (valor -> outro valor): ${troca}`)
console.log(`perdas (preenchido -> vazio): ${perda}   <- leia linha a linha antes de aceitar`)
console.log(`iguais: ${igual}`)

if (!APLICAR) {
  console.log('\nENSAIO. Nada foi escrito. Rode com --aplicar depois de ler as linhas acima.')
  process.exit(0)
}

// ---------------------------------------------------------------- aplicacao
console.log('\n=== APLICANDO (lista fechada) ===')
for (const a of trabalhar) {
  const s = sn[a.servidor_id]
  try {
    await rpc('fn_reconciliar_marcacoes_dia', { p_servidor_id: a.servidor_id, p_data: a.data })
    console.log(`  ok  ${a.data} ${s.nome} (${s.matricula})`)
  } catch (e) {
    console.error(`  FALHA ${a.data} ${s.nome}: ${e.message}`)
  }
}

// ---------------------------------------------------------------- conferencia
const eds2 = []
for (let i = 0; i < ems.length; i += 60) {
  const ids = ems.slice(i, i + 60).map(e => e.id).join(',')
  eds2.push(...await q(`escala_diaria?select=id,escala_mensal_id,dia,${colsId.join(',')}&escala_mensal_id=in.(${ids})`))
}
let restam = 0
for (const d of eds2) {
  const em = emById[d.escala_mensal_id]; if (!em) continue
  for (const c of colsId) {
    const m = marc[d[c]]
    if (m && m.origem === 'rep' && m.dispositivo_id && m.unidade_id && m.unidade_id !== em.unidade_id) restam++
  }
}
console.log(`\n=== CONFERENCIA ===`)
console.log(`passos ainda preenchidos por batida de outra unidade em ${MESES.join(',')}/${ANO}: ${restam}`)
console.log(`(esperado: apenas os dos pares EXCLUIDOS acima)`)
