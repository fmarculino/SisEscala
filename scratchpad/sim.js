// Simula o motor de blocos ANTES e DEPOIS da migration 20260809000000, sobre os dados reais
// de producao. Substitui o framework de testes que o projeto nao tem: se algum dia-servidor
// mudar alem dos 8 casos medidos, aparece aqui.
//
// Reproduz, em JS: a cadeia de precedencia de start_hour, o calculo de end_min, o guard de
// intervalo (fn_jornada_tem_intervalo), a ordenacao por start_hour e a fusao de blocos.
const { conn } = require('./lib')
const fs = require('fs')
const db = conn('prod')

const MES = 8, ANO = 2026

const hr = t => t ? +String(t).slice(0, 2) : null
const min = t => t ? +String(t).slice(0, 2) * 60 + +String(t).slice(3, 5) : null
const reIni = n => { const m = /^([0-9]+)/.exec(n || ''); return m ? +m[1] : null }
const reFim = n => { const m = /(?:ÀS|AS|as|às)\s*([0-9]+)/.exec(n || ''); return m ? +m[1] : null }

;(async () => {
  const [jornadas, turnos, unidades, servidores, temps] = await Promise.all([
    db.all('jornadas?select=id,nome,horas_totais,intervalo_minutos,intervalo_inicio_padrao,intervalo_fim_padrao'),
    db.all('dicionario_turnos?select=id,codigo,slots,horas_computadas,horario_inicio'),
    db.all('unidades?select=id,nome,permite_marca_intervalo'),
    db.all('servidores?select=id,nome,intervalo_inicio_personalizado,intervalo_fim_personalizado,intervalo_flexivel'),
    db.all('servidores_jornadas_temporarias?select=servidor_id,jornada_id,data_inicio,data_fim')
  ])
  const J = Object.fromEntries(jornadas.map(x => [x.id, x]))
  const T = Object.fromEntries(turnos.map(x => [x.id, x]))
  const U = Object.fromEntries(unidades.map(x => [x.id, x]))
  const S = Object.fromEntries(servidores.map(x => [x.id, x]))

  const em = await db.all(`escala_mensal?mes=eq.${MES}&ano=eq.${ANO}&select=id,servidor_id,unidade_id,jornada_id`)
  const EM = Object.fromEntries(em.map(x => [x.id, x]))
  let ed = []
  for (let i = 0; i < em.length; i += 50) {
    const c = em.slice(i, i + 50)
    ed = ed.concat(await db.all(`escala_diaria?escala_mensal_id=in.(${c.map(x => x.id).join(',')})&select=id,escala_mensal_id,dia,categoria,dicionario_turnos_id,hora_inicio_prevista`))
  }
  console.log(`escala_mensal ${MES}/${ANO}: ${em.length} | escala_diaria: ${ed.length}`)

  // obter_jornada_servidor_data: jornada temporaria vence no intervalo de datas
  const jornadaDoDia = (servidorId, dia, jornadaPadrao) => {
    const d = `${ANO}-${String(MES).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
    const t = temps.find(x => x.servidor_id === servidorId && x.data_inicio <= d && d <= x.data_fim)
    return J[t ? t.jornada_id : jornadaPadrao] || null
  }

  const byDay = {}
  ed.forEach(r => { const k = r.escala_mensal_id + '|' + r.dia; (byDay[k] = byDay[k] || []).push(r) })

  // fn_obter_horario_regular_dia
  const horarioRegular = rows => {
    const reg = rows.find(r => r.categoria === 'Regular')
    if (!reg) return null
    const e = EM[reg.escala_mensal_id]
    const j = jornadaDoDia(e.servidor_id, reg.dia, e.jornada_id)
    if (!j) return null
    return { start_hour: reIni(j.nome), end_hour: reFim(j.nome) }
  }

  function startHour(r, rows, novo) {
    const e = EM[r.escala_mensal_id]
    const dt = T[r.dicionario_turnos_id]
    const j = jornadaDoDia(e.servidor_id, r.dia, e.jornada_id)
    const reg = horarioRegular(rows)
    const nome = j?.nome
    const slot1 = dt?.slots?.[0] ?? ''
    const cod = dt?.codigo ?? ''
    const fbSlots = () => cod === 'T4' ? 14 : /^[0-9]+$/.test(slot1) ? +slot1 : slot1 === 'M' ? 7 : slot1 === 'T' ? 13 : slot1 === 'N' ? 19 : 7

    // cascata comum das duas categorias (o ramo de Plantao tem o arm extra do nome da jornada)
    const bigCase = comJornada => {
      if ((cod.startsWith('T') || slot1 === 'T') && reg?.end_hour >= 11 && reg?.end_hour <= 15) return reg.end_hour
      if ((cod.startsWith('N') || slot1 === 'N') && reg?.start_hour >= 17 && reg?.start_hour <= 20) return reg.start_hour
      if ((cod.startsWith('N') || slot1 === 'N') && reg?.end_hour >= 17 && reg?.end_hour <= 20) return reg.end_hour
      if ((cod.startsWith('M') || slot1 === 'M') && reg?.start_hour >= 12 && reg?.start_hour <= 15) return reg.start_hour - Number(dt.horas_computadas)
      if ((cod.startsWith('T') || slot1 === 'T') && reg?.start_hour >= 11 && reg?.start_hour <= 14) return reg.start_hour
      if (comJornada && reIni(nome) !== null) return reIni(nome)
      return null
    }

    // NIVEL 1
    if (r.categoria !== 'Regular' && r.hora_inicio_prevista) return hr(r.hora_inicio_prevista)
    if (r.categoria === 'Regular') {
      const v = reIni(nome) ?? bigCase(false) ?? fbSlots()
      if (v !== null) return v
    }
    if (r.categoria === 'Plantão') {
      // NIVEL 2-A (NOVO): espelho da jornada noturna
      if (novo && ['M', 'T'].includes(slot1) && reg && reg.end_hour < reg.start_hour) return reg.end_hour
      // NIVEL 2: ancora do dicionario, so quando nao ha Regular no dia
      if (!reg && dt?.horario_inicio) return hr(dt.horario_inicio)
      const v = bigCase(true) ?? fbSlots()
      if (v !== null) return v
    }
    // NIVEL 4: Extra ancora no fim do Regular, senao no fim do Plantao
    if (reg) { const f = reFim(nome); if (f !== null) return f < reIni(nome) ? f + 24 : f }
    const pl = rows.find(x => x.categoria === 'Plantão')
    if (pl) {
      const p = T[pl.dicionario_turnos_id], s = p?.slots?.[0]
      if (s === 'M') return 13
      if (s === 'T') return 19
      if (s === 'N') return 31
      if (/^[0-9]+$/.test(s)) { const v = +s + Number(p.horas_computadas); return v < +s ? v + 24 : v }
      return 19
    }
    return fbSlots()
  }

  function turno(r, rows, novo) {
    const e = EM[r.escala_mensal_id]
    const dt = T[r.dicionario_turnos_id]
    const j = jornadaDoDia(e.servidor_id, r.dia, e.jornada_id)
    const sv = S[e.servidor_id], un = U[e.unidade_id]
    const sh = startHour(r, rows, novo)
    const startMin = sh * 60
    let endMin = null
    if (j?.nome && r.categoria === 'Regular' && reFim(j.nome) !== null) {
      const f = reFim(j.nome)
      endMin = (f < sh ? f + 24 : f) * 60
    } else {
      const dur = r.categoria === 'Regular' && j?.horas_totais > 0 ? Number(j.horas_totais) : Number(dt?.horas_computadas || 0)
      endMin = startMin + dur * 60
    }
    const intMin = j?.intervalo_minutos ?? 60
    const permiteInt = !!un?.permite_marca_intervalo && (endMin - startMin) > 360 && intMin > 0
    let intIni = null, intFim = null
    if (permiteInt) {
      intIni = min(sv?.intervalo_inicio_personalizado) ?? min(j?.intervalo_inicio_padrao) ?? startMin + 240
      intFim = min(sv?.intervalo_fim_personalizado) ?? min(j?.intervalo_fim_padrao) ?? intIni + intMin
    }
    const reg = horarioRegular(rows)
    const dobra = novo && r.categoria === 'Plantão' && ['M', 'T'].includes(dt?.slots?.[0] ?? '')
      && reg && reg.end_hour < reg.start_hour
    return { id: r.id, cat: r.categoria, cod: dt?.codigo, ini: startMin, fim: endMin, intIni, intFim, permiteInt, dobra: !!dobra }
  }

  // fusao, na mesma forma da funcao: no maximo 3 turnos, no maximo 3 blocos
  function blocos(rows, novo) {
    const cats = ['Regular', 'Plantão', 'Extra'] // Sobreaviso fora (armadilha 6)
    const sh = rows.filter(r => cats.includes(r.categoria)).map(r => turno(r, rows, novo))
      .sort((a, b) => a.ini - b.ini || a.cat.localeCompare(b.cat)).slice(0, 3)
    if (!sh.length) return []
    const funde = (a, b) => b.ini <= a.fim && a.cat !== 'Sobreaviso' && b.cat !== 'Sobreaviso' && !a.dobra && !b.dobra
    const mk = (...t) => ({ ini: t[0].ini, fim: Math.max(...t.map(x => x.fim)), n: t.length,
      intIni: t.map(x => x.intIni).find(x => x != null) ?? null,
      intFim: t.map(x => x.intFim).find(x => x != null) ?? null,
      ids: t.map(x => `${x.cat}:${x.cod}`).join('+') })
    const [s1, s2, s3] = sh
    if (sh.length === 1) return [mk(s1)]
    if (sh.length === 2) return funde(s1, s2) ? [mk(s1, s2)] : [mk(s1), mk(s2)]
    if (funde(s1, s2)) {
      const b1 = mk(s1, s2)
      return (s3.ini <= b1.fim && !s3.dobra) ? [mk(s1, s2, s3)] : [b1, mk(s3)]
    }
    return funde(s2, s3) ? [mk(s1), mk(s2, s3)] : [mk(s1), mk(s2), mk(s3)]
  }

  const fmt = b => `${String(Math.floor(b.ini / 60)).padStart(2, '0')}:${String(b.ini % 60).padStart(2, '0')}->` +
    `${String(Math.floor(b.fim / 60)).padStart(2, '0')}:${String(b.fim % 60).padStart(2, '0')}` +
    (b.intIni != null ? ` int ${String(Math.floor(b.intIni / 60)).padStart(2, '0')}:${String(b.intIni % 60).padStart(2, '0')}-${String(Math.floor(b.intFim / 60)).padStart(2, '0')}:${String(b.intFim % 60).padStart(2, '0')}` : ' sem int')
    + ` [${b.ids}]`

  let iguais = 0
  const mudou = []
  for (const [k, rows] of Object.entries(byDay)) {
    const a = blocos(rows, false).map(fmt).join(' | ')
    const b = blocos(rows, true).map(fmt).join(' | ')
    if (a === b) { iguais++; continue }
    const e = EM[rows[0].escala_mensal_id]
    mudou.push({ servidor: S[e.servidor_id]?.nome?.trim(), unidade: U[e.unidade_id]?.nome, dia: rows[0].dia, antes: a, depois: b })
  }

  console.log(`\ndias-servidor avaliados: ${iguais + mudou.length}`)
  console.log(`  inalterados: ${iguais}`)
  console.log(`  ALTERADOS:   ${mudou.length}`)
  mudou.sort((x, y) => x.dia - y.dia).forEach(m => {
    console.log(`\n  ${m.servidor} | ${m.unidade} | dia ${m.dia}`)
    console.log(`    antes : ${m.antes}`)
    console.log(`    depois: ${m.depois}`)
  })
  fs.writeFileSync(__dirname + '/sim.json', JSON.stringify(mudou, null, 1))
})().catch(e => console.error('ERRO', e))
