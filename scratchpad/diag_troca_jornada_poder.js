/**
 * SO LEITURA. Complemento de diag_troca_jornada.js.
 *
 * 1) PODER DO TESTE: o proxy B so enxerga escalas com muitos dias de batida real. Sem saber
 *    quantas escalas atendem o criterio, "0 quebras" nao distingue "nao acontece" de
 *    "nao da para ver".
 * 2) MESES ANTES DE 08/08/2026: escala_diaria.presenca_*_origem so existe desde a migration
 *    20260808020000, entao junho/julho tem origem NULL e o filtro por origem zera tudo.
 *    Ali a heuristica da armadilha 5 vale: horario com SEGUNDOS != 0 e batida de terminal
 *    (o REP, que tambem grava segundos zerados, so entrou em agosto).
 */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY }
const pag = async rec => { const o = []; for (let f = 0; ; f += 1000) { const r = await fetch(U + '/rest/v1/' + rec, { headers: { ...H, Range: f + '-' + (f + 999) } }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); const p = await r.json(); o.push(...p); if (p.length < 1000) break } return o }
const hm = t => { const d = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t)).split(':'); return (+d[0]) * 60 + (+d[1]) }
const HH = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const temSegundos = t => new Date(t).getUTCSeconds() !== 0 || new Date(t).getUTCMilliseconds() !== 0
const REAL = new Set(['rep', 'terminal'])
const iniJornada = nome => { const m = (nome || '').match(/^([0-9]+)/); return m ? (+m[1]) * 60 : null }

async function analisa(mes, ano, modo) {
  const em = await pag(`escala_mensal?select=id,servidor_id,jornada_id,status,updated_at&mes=eq.${mes}&ano=eq.${ano}`)
  const ids = em.map(e => e.id)
  let ed = []
  for (let i = 0; i < ids.length; i += 50)
    ed.push(...await pag(`escala_diaria?select=escala_mensal_id,dia,presenca_entrada_em,presenca_entrada_origem&escala_mensal_id=in.(${ids.slice(i, i + 50).join(',')})&categoria=eq.Regular`))

  const ehReal = d => d.presenca_entrada_em && (modo === 'origem'
    ? REAL.has(d.presenca_entrada_origem)
    : temSegundos(d.presenca_entrada_em))

  const porEm = new Map()
  for (const d of ed) if (ehReal(d)) (porEm.get(d.escala_mensal_id) || porEm.set(d.escala_mensal_id, []).get(d.escala_mensal_id)).push({ dia: d.dia, min: hm(d.presenca_entrada_em) })

  const dist = { '0': 0, '1-2': 0, '3-5': 0, '6-9': 0, '10-15': 0, '16+': 0 }
  for (const e of em) {
    const n = (porEm.get(e.id) || []).length
    dist[n === 0 ? '0' : n <= 2 ? '1-2' : n <= 5 ? '3-5' : n <= 9 ? '6-9' : n <= 15 ? '10-15' : '16+']++
  }
  const elegiveis = [...porEm.values()].filter(v => v.length >= 6).length

  // maior salto observado em cada escala elegivel, sem exigir limiar
  const saltos = []
  for (const [emId, arr] of porEm) {
    if (arr.length < 6) continue
    const dias = arr.sort((a, b) => a.dia - b.dia)
    let best = null
    for (let k = 3; k <= dias.length - 3; k++) {
      const a = med(dias.slice(0, k).map(x => x.min)), b = med(dias.slice(k).map(x => x.min))
      const delta = Math.abs(a - b)
      if (!best || delta > best.delta) best = { k, a, b, delta, diaCorte: dias[k].dia }
    }
    if (best) saltos.push({ emId, n: dias.length, ...best })
  }
  saltos.sort((x, y) => y.delta - x.delta)
  return { em, dist, elegiveis, saltos }
}

;(async () => {
  const jor = await pag('jornadas?select=id,nome')
  const J = new Map(jor.map(j => [j.id, j]))
  const serv = await pag('servidores?select=id,nome,matricula')
  const S = new Map(serv.map(s => [s.id, s]))

  for (const [mes, ano, modo] of [[8, 2026, 'origem'], [7, 2026, 'segundos'], [6, 2026, 'segundos']]) {
    const { em, dist, elegiveis, saltos } = await analisa(mes, ano, modo)
    const M = new Map(em.map(e => [e.id, e]))
    console.log(`\n##### ${String(mes).padStart(2, '0')}/${ano} (batida real por ${modo}) — ${em.length} escalas #####`)
    console.log('dias com batida real por escala:', JSON.stringify(dist))
    console.log('ELEGIVEIS ao teste de quebra (>=6 dias):', elegiveis, `(${(elegiveis / Math.max(em.length, 1) * 100).toFixed(0)}% das escalas)`)
    if (!saltos.length) { console.log('sem base para medir salto.'); continue }
    console.log('maior salto observado:', saltos[0].delta, 'min | mediana dos maiores saltos:', med(saltos.map(s => s.delta)), 'min')
    console.log('acima de 90min:', saltos.filter(s => s.delta >= 90).length, '| acima de 60min:', saltos.filter(s => s.delta >= 60).length, '| acima de 30min:', saltos.filter(s => s.delta >= 30).length)
    console.log('top 10 saltos:')
    for (const s of saltos.slice(0, 10)) {
      const e = M.get(s.emId), sv = S.get(e?.servidor_id), j = J.get(e?.jornada_id)
      const ini = iniJornada(j?.nome)
      console.log(`  ${(sv?.matricula || '?').padEnd(8)} ${(sv?.nome || '?').slice(0, 28).padEnd(28)} jornada=${(j?.nome || '-').padEnd(13)} n=${String(s.n).padStart(2)} corte=dia ${String(s.diaCorte).padStart(2)} ${HH(s.a)}->${HH(s.b)} = ${String(s.delta).padStart(3)}min${ini != null ? ` | jornada diz ${HH(ini)}` : ''}`)
    }
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
