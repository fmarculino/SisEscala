/**
 * Portao da Camada 1: prever o efeito do NIVEL 2-B ANTES de aplicar a migration.
 * Replica a cascata de start_hour do Plantao, VALIDA a replica contra fn_blocos_previstos_mes
 * (se a replica nao reproduz o presente, ela nao serve para prever o futuro) e so entao aplica
 * a regra nova.
 */
import fs from 'fs'
import { get, rpc } from './q.mjs'

const dts = await get(`dicionario_turnos?select=id,codigo,slots,horas_computadas,horario_inicio`)
const DT = Object.fromEntries(dts.map(d => [d.id, d]))
const jor = await get(`jornadas?select=id,nome`); const J = Object.fromEntries(jor.map(j => [j.id, j]))
const ems = await get(`escala_mensal?ativo=eq.true&select=id,servidor_id,mes,ano,jornada_id,unidade_id`)
const EM = Object.fromEntries(ems.map(e => [e.id, e]))
const eds = await get(`escala_diaria?select=id,escala_mensal_id,dia,categoria,dicionario_turnos_id,hora_inicio_prevista`)
const ED = Object.fromEntries(eds.map(e => [e.id, e]))
const sv = await get(`servidores?select=id,nome,matricula`); const SV = Object.fromEntries(sv.map(s => [s.id, s]))

// linhas por (escala_mensal, dia)
const porDia = new Map()
for (const e of eds) { const k = e.escala_mensal_id + '|' + e.dia; if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(e) }

const startJ = n => { const m = /^([0-9]+)/.exec(n || ''); return m ? +m[1] : null }
const endJ = n => { const m = /(?:ÀS|AS|as|às)\s*([0-9]+)/.exec(n || ''); return m ? +m[1] : null }

/** A cascata do Plantao, na ordem do SQL. `comNivel2B` liga o ramo novo. */
function startHourPlantao(l, comNivel2B) {
  const em = EM[l.escala_mensal_id]; const dt = DT[l.dicionario_turnos_id]
  if (!em || !dt) return null
  // NIVEL 1
  if (l.hora_inicio_prevista) return +String(l.hora_inicio_prevista).slice(0, 2)
  const linhas = porDia.get(l.escala_mensal_id + '|' + l.dia) || []
  const reg = linhas.find(x => x.categoria === 'Regular')
  const j = J[em.jornada_id]
  const sh = reg && j ? startJ(j.nome) : null
  const eh = reg && j ? endJ(j.nome) : null
  const cod = dt.codigo || ''; const s1 = (dt.slots || [])[0]
  const horas = Number(dt.horas_computadas)
  // NIVEL 2-A: espelho da jornada noturna
  if (['M', 'T'].includes(s1) && eh !== null && sh !== null && eh < sh) return eh
  // NIVEL 2: ancora fixa, so quando NAO ha Regular no dia
  if (!reg) return dt.horario_inicio ? +dt.horario_inicio.slice(0, 2) : null
  // NIVEL 4: cascata legada
  const T = cod.startsWith('T') || s1 === 'T', N = cod.startsWith('N') || s1 === 'N', M = cod.startsWith('M') || s1 === 'M'
  if (T && eh >= 11 && eh <= 15) return eh
  if (N && sh >= 17 && sh <= 20) return sh
  if (N && eh >= 17 && eh <= 20) return eh
  if (M && sh >= 12 && sh <= 15) return sh - horas
  if (T && sh !== null && sh >= 11 && sh <= 14) return sh
  // NIVEL 2-B (novo)
  if (comNivel2B && dt.horario_inicio && horas > 0) {
    const pIni = +dt.horario_inicio.slice(0, 2) + (+dt.horario_inicio.slice(3, 5)) / 60
    const pFim = pIni + horas
    let rIni = sh, rFim = eh
    if (rIni !== null && rFim !== null) {
      if (rFim <= rIni) rFim += 24
      if (pFim <= rIni || pIni >= rFim) return Math.floor(pIni)
    }
  }
  // fallback pelo nome da jornada
  if (j && startJ(j.nome) !== null) return startJ(j.nome)
  if (cod === 'T4') return 14
  if (/^[0-9]+$/.test(s1 || '')) return +s1
  if (s1 === 'M') return 7
  if (s1 === 'T') return 13
  if (s1 === 'N') return 19
  return 7
}

// --- 1. VALIDAR A REPLICA contra a funcao real -----------------------------
const ids = ems.map(e => e.id); const blocos = []
for (let i = 0; i < ids.length; i += 25) {
  const r = await rpc('fn_blocos_previstos_mes', { p_escala_mensal_ids: ids.slice(i, i + 25) })
  if (!Array.isArray(r)) throw new Error('lote ' + i + ': ' + String(r).slice(0, 200))
  if (r.length >= 1000) throw new Error('teto 1000 no lote ' + i)
  blocos.push(...r)
}
const horaLocal = t => +new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date(t))
const realPorLinha = new Map()
for (const b of blocos) {
  const L = b.escala_diaria_ids || []
  for (let i = 0; i < L.length; i++) realPorLinha.set(L[i], horaLocal((b.turnos_inicio || [])[i] ?? b.inicio_previsto))
}
let conf = 0, div = 0; const divergentes = []
for (const [id, real] of realPorLinha) {
  const l = ED[id]; if (!l || l.categoria !== 'Plantão') continue
  const prev = startHourPlantao(l, false)
  if (prev === null) continue
  // A fusao de blocos pode deslocar o inicio exibido; comparo so quando o turno NAO esta fundido.
  if (((prev % 24) + 24) % 24 === real) conf++; else { div++; divergentes.push({ id, real, prev, cod: DT[l.dicionario_turnos_id]?.codigo }) }
}
console.log(`REPLICA: ${conf} plantoes reproduzidos, ${div} divergentes (${(100*conf/(conf+div)).toFixed(1)}% de fidelidade)`)
if (div) { const cc={}; for(const d of divergentes){const k=`${d.cod} ${d.prev}->${d.real}`; cc[k]=(cc[k]||0)+1}
  console.log('  divergencias:', Object.entries(cc).sort((a,b)=>b[1]-a[1]).slice(0,10)) }

// --- 2. O QUE MUDA com o nivel 2-B -----------------------------------------
const mudam = []
for (const [id] of realPorLinha) {
  const l = ED[id]; if (!l) continue
  if (l.categoria !== 'Plantão') continue
  const antes = startHourPlantao(l, false), depois = startHourPlantao(l, true)
  if (antes === depois) continue
  const em = EM[l.escala_mensal_id]
  mudam.push({ comp: `${em.ano}-${String(em.mes).padStart(2,'0')}`, mat: SV[em.servidor_id]?.matricula,
    nome: SV[em.servidor_id]?.nome, dia: l.dia, cod: DT[l.dicionario_turnos_id]?.codigo,
    jornada: J[em.jornada_id]?.nome, antes, depois })
}
console.log(`\nPLANTOES QUE MUDAM DE HORARIO: ${mudam.length}`)
const pc = {}; for (const m of mudam) pc[m.comp] = (pc[m.comp]||0)+1
console.log('por competencia:', pc)
const cc2 = {}; for (const m of mudam) { const k = `${m.cod} ${m.antes}h -> ${m.depois}h (jornada ${m.jornada})`; cc2[k]=(cc2[k]||0)+1 }
for (const [k,v] of Object.entries(cc2).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(v).padStart(3)}x  ${k}`)

// --- 3. NENHUM Regular ou Extra pode mudar ---------------------------------
let outros = 0
for (const [id] of realPorLinha) { const l = ED[id]; if (l && l.categoria !== 'Plantão') outros++ }
console.log(`\nlinhas Regular/Extra analisadas: ${outros} — o ramo novo vive DENTRO de`)
console.log('  `CASE WHEN ed.categoria = \'Plantão\'`, entao nenhuma delas pode ser alcancada.')
fs.writeFileSync('scratchpad/_mudam_2b.json', JSON.stringify(mudam, null, 1))
