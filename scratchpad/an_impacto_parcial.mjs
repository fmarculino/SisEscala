import { todos } from './an_afastamento_parcial.mjs'

const evs = await todos('servidores_eventos?select=id,servidor_id,data_inicio,data_fim,slots,periodo_tipo,hora_inicio,tipos_eventos(nome),servidores(nome,matricula)')
const comSlots = evs.filter(e => e.slots?.length && !e.hora_inicio && (e.periodo_tipo || 'integral') !== 'horas')

const porDia = new Map() // servidor|iso -> [ev]
for (const e of comSlots) {
  const d = new Date(e.data_inicio + 'T12:00:00Z'), fim = new Date(e.data_fim + 'T12:00:00Z')
  while (d <= fim) {
    const iso = d.toISOString().slice(0, 10)
    const k = `${e.servidor_id}|${iso}`
    if (!porDia.has(k)) porDia.set(k, [])
    porDia.get(k).push(e)
    d.setUTCDate(d.getUTCDate() + 1)
  }
}

const servidorIds = [...new Set(comSlots.map(e => e.servidor_id))]
const ems = await todos(`escala_mensal?select=id,servidor_id,mes,ano&servidor_id=in.(${servidorIds.join(',')})`)
const emPorChave = new Map(ems.map(e => [`${e.servidor_id}|${e.mes}|${e.ano}`, e]))
const eds = await todos(`escala_diaria?select=escala_mensal_id,dia,categoria,dicionario_turnos(codigo,slots)&escala_mensal_id=in.(${ems.map(e=>e.id).join(',')})`)
const edPorChave = new Map()
for (const ed of eds) {
  const k = `${ed.escala_mensal_id}|${ed.dia}`
  ;(edPorChave.get(k) || edPorChave.set(k, []).get(k)).push(ed)
}

const cont = { semEscala: 0, semLinha: 0, cobre: 0, intersecaoVazia: 0, PARCIAL: 0 }
const parciais = []
for (const [k, lista] of porDia) {
  const [sid, iso] = k.split('|')
  const [ano, mes, dia] = iso.split('-').map(Number)
  const em = emPorChave.get(`${sid}|${mes}|${ano}`)
  if (!em) { cont.semEscala++; continue }
  const linhas = (edPorChave.get(`${em.id}|${dia}`) || []).filter(l => l.categoria === 'Regular')
  if (!linhas.length) { cont.semLinha++; continue }
  const uniao = [...new Set(lista.flatMap(e => e.slots))]
  for (const l of linhas) {
    const ts = l.dicionario_turnos?.slots || []
    if (!ts.length) continue
    const inter = ts.filter(s => uniao.includes(s))
    if (inter.length === 0) cont.intersecaoVazia++
    else if (inter.length === ts.length) cont.cobre++
    else {
      cont.PARCIAL++
      parciais.push(`${iso} ${lista[0].servidores?.nome} turno=${l.dicionario_turnos.codigo} afastado=${JSON.stringify(uniao)} [${lista.map(e=>e.tipos_eventos?.nome).join(' + ')}]`)
    }
  }
}
console.log('Dias-servidor com afastamento por slot:', porDia.size)
console.log(cont)
console.log('\nDias com ESCALA VIVA que mudam de comportamento na folha (parcial estrito):')
console.log(parciais.length ? parciais.join('\n') : '  NENHUM')
