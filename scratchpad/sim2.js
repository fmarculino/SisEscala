// Checa, nos 8 dias de dobra, se o dia ANTERIOR tem turno que atravessa a meia-noite.
// Se tiver, o cursor de "ontem" consome a batida das 06:00 como saida do turno anterior e a
// entrada do MT fica sem batida.
const { conn } = require('./lib')
const db = conn('prod')
const MES = 8, ANO = 2026
const reIni = n => { const m = /^([0-9]+)/.exec(n || ''); return m ? +m[1] : null }
const reFim = n => { const m = /(?:ÀS|AS|as|às)\s*([0-9]+)/.exec(n || ''); return m ? +m[1] : null }

;(async () => {
  const jornadas = await db.all('jornadas?select=id,nome')
  const J = Object.fromEntries(jornadas.map(x => [x.id, x]))
  const turnos = await db.all('dicionario_turnos?select=id,codigo,slots,horas_computadas')
  const T = Object.fromEntries(turnos.map(x => [x.id, x]))
  const servidores = await db.all('servidores?select=id,nome')
  const S = Object.fromEntries(servidores.map(x => [x.id, x]))

  const noturnas = jornadas.filter(j => reFim(j.nome) < reIni(j.nome)).map(j => j.id)
  const em = await db.all(`escala_mensal?mes=eq.${MES}&ano=eq.${ANO}&jornada_id=in.(${noturnas.join(',')})&select=id,servidor_id,jornada_id`)
  let ed = []
  for (const e of em) ed = ed.concat(await db.all(`escala_diaria?escala_mensal_id=eq.${e.id}&select=escala_mensal_id,dia,categoria,dicionario_turnos_id`))

  const byDay = {}
  ed.forEach(r => { const k = r.escala_mensal_id + '|' + r.dia; (byDay[k] = byDay[k] || []).push(r) })

  for (const e of em) {
    const jor = J[e.jornada_id].nome
    for (let dia = 1; dia <= 31; dia++) {
      const rows = byDay[e.id + '|' + dia] || []
      const temMT = rows.some(r => r.categoria === 'Plantão' && ['M', 'T'].includes(T[r.dicionario_turnos_id]?.slots?.[0]))
      if (!temMT) continue
      const ontem = byDay[e.id + '|' + (dia - 1)] || []
      const desc = ontem.map(r => `${r.categoria}:${T[r.dicionario_turnos_id]?.codigo}`).join('+') || '(vazio)'
      const cruza = ontem.some(r => r.categoria === 'Regular') // jornada noturna: Regular sempre cruza
      console.log(`${S[e.servidor_id].nome.trim()} | dia ${String(dia).padStart(2)} (MT) | ontem = ${desc}` +
        (cruza ? '  <<< CONFLITO: turno de ontem termina 06:00' : '  ok'))
    }
  }
})().catch(e => console.error('ERRO', e))
