import { todos } from './an_afastamento_parcial.mjs'

const evs = await todos('servidores_eventos?select=id,servidor_id,data_inicio,data_fim,slots,periodo_tipo,hora_inicio,tipos_eventos(nome),servidores(nome,matricula)')
const comSlots = evs.filter(e => e.slots && e.slots.length > 0 && !e.hora_inicio && (e.periodo_tipo || 'integral') !== 'horas')

// expandir por dia
const dias = []
for (const e of comSlots) {
  const d = new Date(e.data_inicio + 'T12:00:00Z')
  const fim = new Date(e.data_fim + 'T12:00:00Z')
  while (d <= fim) {
    const iso = d.toISOString().slice(0, 10)
    dias.push({ ev: e, iso, ano: +iso.slice(0,4), mes: +iso.slice(5,7), dia: +iso.slice(8,10) })
    d.setUTCDate(d.getUTCDate() + 1)
  }
}
console.log('eventos por slot:', comSlots.length, '| dias-servidor atingidos:', dias.length)

const servidorIds = [...new Set(dias.map(x => x.ev.servidor_id))]
const ems = await todos(`escala_mensal?select=id,servidor_id,mes,ano,jornadas(nome,horas_totais,intervalo_minutos)&servidor_id=in.(${servidorIds.join(',')})`)
const emPorChave = new Map(ems.map(e => [`${e.servidor_id}|${e.mes}|${e.ano}`, e]))
const emIds = ems.map(e => e.id)

const eds = emIds.length ? await todos(`escala_diaria?select=escala_mensal_id,dia,categoria,dicionario_turnos(codigo,slots)&escala_mensal_id=in.(${emIds.join(',')})`) : []
const edPorChave = new Map()
for (const ed of eds) {
  const k = `${ed.escala_mensal_id}|${ed.dia}`
  if (!edPorChave.has(k)) edPorChave.set(k, [])
  edPorChave.get(k).push(ed)
}

let semEscala = 0, comEscalaCoberta = 0, comEscalaParcial = 0, semEscalaMensal = 0
const casos = []
for (const x of dias) {
  const em = emPorChave.get(`${x.ev.servidor_id}|${x.mes}|${x.ano}`)
  if (!em) { semEscalaMensal++; continue }
  const linhas = edPorChave.get(`${em.id}|${x.dia}`) || []
  const regular = linhas.find(l => l.categoria === 'Regular')
  if (!regular) {
    semEscala++
    casos.push({ ...x, nome: x.ev.servidores?.nome, mat: x.ev.servidores?.matricula, jornada: em.jornadas?.nome, situacao: 'SEM ESCALA (apagada)' })
    continue
  }
  const ts = regular.dicionario_turnos?.slots || []
  const cobre = ts.length > 0 && ts.every(s => x.ev.slots.includes(s))
  if (cobre) comEscalaCoberta++
  else { comEscalaParcial++; casos.push({ ...x, nome: x.ev.servidores?.nome, mat: x.ev.servidores?.matricula, jornada: em.jornadas?.nome, turno: regular.dicionario_turnos?.codigo, situacao: 'ESCALA VIVA, TURNO PARCIAL' }) }
}
console.log({ semEscalaMensal, semEscala, comEscalaCoberta, comEscalaParcial })
console.log('\nCASOS:')
for (const c of casos.sort((a,b) => a.iso.localeCompare(b.iso))) {
  console.log(`${c.iso} ${String(c.mat||'').padStart(6)} ${(c.nome||'').slice(0,32).padEnd(32)} slots=${JSON.stringify(c.ev.slots).padEnd(15)} jornada=${(c.jornada||'?').padEnd(12)} turno=${c.turno||'-'} ${c.situacao} [${c.ev.tipos_eventos?.nome}]`)
}
