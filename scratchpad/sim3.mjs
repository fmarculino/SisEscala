/*
 * Reimplementacao fiel do calculo de start_hour + fusao de blocos de fn_confirmar_presenca,
 * para simular o efeito da ancora ANTES de aplicar a migration.
 *
 * Validacao: roda no modo ATUAL sobre os 527 dias-servidor de producao e compara com o que
 * fn_blocos_previstos_dia devolveu de verdade. Se nao bater 100%, a simulacao nao vale nada
 * e o script aborta.
 */
import fs from 'fs'
const DIR = 'C:/Users/Cliente/AppData/Local/Temp/claude/c--Users-Cliente-Projetos-SisEscala/a2581644-2c8f-4f59-85f1-7d0f31f92075/scratchpad'
const L = n => JSON.parse(fs.readFileSync(`${DIR}/prod_${n}.json`, 'utf8'))
const dt = L('dt'), em = L('em'), ed = L('ed'), jo = L('jo'), sv = L('sv'), un = L('un')
const jtemp = JSON.parse(fs.readFileSync(`${DIR}/prod_jtemp.json`, 'utf8'))
const dtM = new Map(dt.map(x => [x.id, x])), emM = new Map(em.map(x => [x.id, x]))
const joM = new Map(jo.map(x => [x.id, x])), svM = new Map(sv.map(x => [x.id, x])), unM = new Map(un.map(x => [x.id, x]))

// ANCORA (Fase 1) - so os 4 codigos confirmados pelo usuario
const ANCORA = { MT: 7, M: 7, T: 13, N: 19, MN: 19, M2N: 19, M3N: 19, M4N: 19, M5N: 19, M7N: 19, M8N: 19 }

const reInt = s => { const m = /^([0-9]+)/.exec(s || ''); return m ? parseInt(m[1], 10) : null }
const reFim = s => { const m = /(?:ÀS|AS|as|às)\s*([0-9]+)/.exec(s || ''); return m ? parseInt(m[1], 10) : null }

function jornadaDoDia(servidorId, data, jornadaMensalId) {
  const t = jtemp.find(x => x.servidor_id === servidorId && data >= x.data_inicio && data <= x.data_fim)
  return joM.get(t ? t.jornada_id : jornadaMensalId) || null
}

// fn_obter_horario_regular_dia: le a jornada do turno REGULAR do dia
function horarioRegularDia(linhas) {
  const reg = linhas.find(x => x.categoria === 'Regular')
  if (!reg || !reg.jor) return null
  return { start_hour: reInt(reg.jor.nome), end_hour: reFim(reg.jor.nome) }
}

const between = (v, a, b) => v !== null && v !== undefined && !Number.isNaN(v) && v >= a && v <= b

function startHour(r, linhas, comAncora) {
  const dtr = r.dt, j = r.jor
  const hr = horarioRegularDia(linhas)
  const sh = hr ? hr.start_hour : null, eh = hr ? hr.end_hour : null
  const cod = dtr?.codigo || '', slots = dtr?.slots || [], hc = dtr?.horas_computadas ?? 0
  const isT = cod.startsWith('T') || slots[0] === 'T'
  const isN = cod.startsWith('N') || slots[0] === 'N'
  const isM = cod.startsWith('M') || slots[0] === 'M'
  const fallback = () => cod === 'T4' ? 14 : /^[0-9]+$/.test(slots[0] ?? '') ? +slots[0] : slots[0] === 'M' ? 7 : slots[0] === 'T' ? 13 : slots[0] === 'N' ? 19 : 7
  const cascata = () => {
    if (isT && between(eh, 11, 15)) return eh
    if (isN && between(sh, 17, 20)) return sh
    if (isN && between(eh, 17, 20)) return eh
    if (isM && between(sh, 12, 15)) return sh - Math.trunc(hc)
    if (isT && sh !== null && between(sh, 11, 14)) return sh
    return null
  }
  if (r.categoria === 'Regular') {
    const a = j ? reInt(j.nome) : null
    return a ?? cascata() ?? fallback()
  }
  if (r.categoria === 'Plantão') {
    if (comAncora && ANCORA[cod] !== undefined && !linhas.some(x => x.categoria === "Regular")) return ANCORA[cod]
    const c = cascata(); if (c !== null) return c
    const a = j ? reInt(j.nome) : null; if (a !== null) return a
    return fallback()
  }
  // Extra: fim do Regular do dia, senao fim do Plantao do dia
  const reg = linhas.find(x => x.categoria === 'Regular')
  if (reg && reg.jor) { const f = reFim(reg.jor.nome), i = reInt(reg.jor.nome); if (f !== null) return f < i ? f + 24 : f }
  const pl = linhas.find(x => x.categoria === 'Plantão')
  if (pl && pl.dt) {
    const s = pl.dt.slots || [], h = Math.trunc(pl.dt.horas_computadas ?? 0)
    if (s[0] === 'M') return 13
    if (s[0] === 'T') return 19
    if (s[0] === 'N') return 31
    if (/^[0-9]+$/.test(s[0] ?? '')) { const v = +s[0] + h; return v >= 24 ? v : v < +s[0] ? v + 24 : v }
    return 19
  }
  return fallback()
}

function montar(linhas, comAncora) {
  const turnos = linhas.filter(x => ['Regular', 'Plantão', 'Extra'].includes(x.categoria)).map(r => {
    const sh = startHour(r, linhas, comAncora)
    let end = null
    if (r.jor && r.categoria === 'Regular') { const je = reFim(r.jor.nome); if (je !== null) end = (je < sh ? je + 24 : je) * 60 }
    if (end === null) {
      const dur = (r.categoria === 'Regular' && r.jor?.horas_totais > 0) ? r.jor.horas_totais : (r.dt?.horas_computadas ?? 0)
      end = sh * 60 + Math.round(dur * 60)
    }
    return { ...r, ini: sh * 60, fim: end }
  }).sort((a, b) => a.ini - b.ini).slice(0, 3)

  // fusao (espelha exatamente a arvore de v_shifts_count 1/2/3)
  const blocos = []
  if (turnos.length === 0) return blocos
  const funde = (a, b) => b.ini <= a.fim && a.categoria !== 'Sobreaviso' && b.categoria !== 'Sobreaviso'
  const [s1, s2, s3] = turnos
  if (turnos.length === 1) blocos.push({ ini: s1.ini, fim: s1.fim, ids: [s1.id] })
  else if (turnos.length === 2) {
    if (funde(s1, s2)) blocos.push({ ini: s1.ini, fim: Math.max(s1.fim, s2.fim), ids: [s1.id, s2.id] })
    else { blocos.push({ ini: s1.ini, fim: s1.fim, ids: [s1.id] }); blocos.push({ ini: s2.ini, fim: s2.fim, ids: [s2.id] }) }
  } else {
    if (funde(s1, s2)) {
      const b1 = { ini: s1.ini, fim: Math.max(s1.fim, s2.fim), ids: [s1.id, s2.id] }
      if (s3.ini <= b1.fim && s3.categoria !== 'Sobreaviso') { b1.fim = Math.max(b1.fim, s3.fim); b1.ids.push(s3.id); blocos.push(b1) }
      else { blocos.push(b1); blocos.push({ ini: s3.ini, fim: s3.fim, ids: [s3.id] }) }
    } else {
      blocos.push({ ini: s1.ini, fim: s1.fim, ids: [s1.id] })
      if (funde(s2, s3)) blocos.push({ ini: s2.ini, fim: Math.max(s2.fim, s3.fim), ids: [s2.id, s3.id] })
      else { blocos.push({ ini: s2.ini, fim: s2.fim, ids: [s2.id] }); blocos.push({ ini: s3.ini, fim: s3.fim, ids: [s3.id] }) }
    }
  }
  return blocos
}

// ---- monta os dias
const byDay = new Map()
for (const r of ed) {
  const m = emM.get(r.escala_mensal_id); if (!m) continue
  const data = `${m.ano}-${String(m.mes).padStart(2, '0')}-${String(r.dia).padStart(2, '0')}`
  const k = m.servidor_id + '|' + data
  if (!byDay.has(k)) byDay.set(k, [])
  byDay.get(k).push({ ...r, em: m, dt: dtM.get(r.dicionario_turnos_id), jor: jornadaDoDia(m.servidor_id, data, m.jornada_id) })
}

// ---- VALIDACAO: modo atual tem que bater com o RPC
const rpc = L('blocos')
let ok = 0, ko = 0
const falhas = []
for (const r of rpc) {
  const linhas = byDay.get(r.sid + '|' + r.data)
  const b = montar(linhas, false)
  const bl = b.find(x => x.ids.includes(linhas.find(y => y.categoria === 'Plantão').id))
  const h = bl ? Math.floor(bl.ini / 60) : null
  if (h === r.iniH && (bl ? bl.ids.length : 0) === r.idsNoBloco) ok++
  else { ko++; if (falhas.length < 12) falhas.push(`${r.data} ${r.nome} ${r.cod}: rpc=${r.iniH}h/${r.idsNoBloco}ids  sim=${h}h/${bl ? bl.ids.length : 0}ids`) }
}
console.log(`VALIDACAO da simulacao contra fn_blocos_previstos_dia: ${ok} ok / ${ko} divergentes (de ${rpc.length})`)
if (ko) { console.log(falhas.join('\n')); if (ko / rpc.length > 0.02) { console.error('\nSimulacao infiel demais - NAO USAR.'); process.exit(1) } }

// ---- EFEITO DA ANCORA
console.log('\n=== EFEITO DA ANCORA (MT=07 M=07 T=13 N=19) sobre os 527 dias-servidor com Plantao\n')
const mudou = [], igual = []
for (const r of rpc) {
  const linhas = byDay.get(r.sid + '|' + r.data)
  const pid = linhas.find(y => y.categoria === 'Plantão').id
  const A = montar(linhas, false), B = montar(linhas, true)
  const ba = A.find(x => x.ids.includes(pid)), bb = B.find(x => x.ids.includes(pid))
  const key = a => a ? `${Math.floor(a.ini / 60)}:${a.fim}:${a.ids.length}` : 'nil'
  if (key(ba) === key(bb)) igual.push(r)
  else mudou.push({ r, ba, bb })
}
const hm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
console.log(`  INALTERADOS: ${igual.length}`)
console.log(`  ALTERADOS  : ${mudou.length}`)
const agr = {}
for (const x of mudou) {
  const k = `${x.r.cod.padEnd(3)} jor=${String(x.r.jor || x.r.jorServ || '-').padEnd(12)} ${x.r.reg ? '+Reg ' + x.r.reg : 'semReg '} : ${hm(x.ba.ini)}-${hm(x.ba.fim)} (${x.ba.ids.length}t) => ${hm(x.bb.ini)}-${hm(x.bb.fim)} (${x.bb.ids.length}t)`
  agr[k] = (agr[k] || 0) + 1
}
console.log('\n' + Object.entries(agr).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${String(v).padStart(4)}x  ${k}`).join('\n'))

// alertas: mudou o numero de turnos no bloco (fusao alterada)
const fus = mudou.filter(x => x.ba.ids.length !== x.bb.ids.length)
console.log(`\n  >>> mudaram a FUSAO de blocos (merecem conferencia individual): ${fus.length}`)
for (const x of fus) console.log(`      ${x.r.data} ${String(x.r.nome).padEnd(36)} ${x.r.cod} +Reg${x.r.reg || '-'} : ${x.ba.ids.length}t => ${x.bb.ids.length}t`)

// alertas: dia ja com presenca gravada que muda de janela
const comP = mudou.filter(x => x.r.entrada)
console.log(`\n  >>> dias ALTERADOS que JA tem entrada gravada: ${comP.length} (janela muda, o timestamp gravado NAO e tocado)`)
const ago = mudou.filter(x => x.r.data.startsWith('2026-08'))
console.log(`  >>> dias ALTERADOS em agosto (competencia aberta): ${ago.length}`)
const fech = mudou.filter(x => !x.r.data.startsWith('2026-08'))
console.log(`  >>> dias ALTERADOS em jun/jul (competencia FECHADA): ${fech.length}`)
