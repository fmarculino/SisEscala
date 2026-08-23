/**
 * SO LEITURA. O irmao do problema da AGNA: dia com PLANTAO e SEM turno Regular.
 *
 * turnosDaFolha devolve TUDO quando nao ha Regular no dia (de proposito: plantonista puro 12x36
 * ficaria com a folha em branco). Consequencia: quem tem jornada Regular normal e e escalado num
 * plantao de sabado tem o plantao INTEIRO contado como hora extra na folha — e pago de novo pelo
 * anexo de plantoes.
 */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
async function page(q) {
  q += (q.includes('?') ? '&' : '?') + 'order=id'
  const out = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(U + '/rest/v1/' + q, { headers: { ...H, Range: f + '-' + (f + 999) } })
    if (!r.ok) throw new Error(r.status + ' ' + await r.text())
    const p = await r.json(); out.push(...p); if (p.length < 1000) break
  }
  return out
}
const HHMM = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '--:--'
const minLocal = t => {
  if (!t) return null
  const d = new Date(t).toLocaleString('en-CA', { timeZone: 'America/Sao_Paulo', hour12: false, hour: '2-digit', minute: '2-digit' })
  const [h, m] = d.split(':').map(Number); return h * 60 + m
}
const hm = m => Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0')
const fimJ = n => {
  const m = (n || '').match(/(?:ÀS|AS|as|às)\s*([0-9]+)/), i = (n || '').match(/^([0-9]+)/)
  if (!m || !i) return null
  let f = Number(m[1]) * 60
  if (f <= Number(i[1]) * 60) f += 1440
  return f
}
const iniJ = n => { const i = (n || '').match(/^([0-9]+)/); return i ? Number(i[1]) * 60 : null }

;(async () => {
  const em = await page('escala_mensal?select=id,servidor_id,jornadas(nome)&mes=eq.8&ano=eq.2026')
  const byEm = new Map(em.map(e => [e.id, e]))
  const ed = await page('escala_diaria?select=id,escala_mensal_id,dia,categoria,dicionario_turnos(codigo,horas_computadas),presenca_entrada_em,presenca_saida_em')
  const grupos = new Map()
  for (const d of ed) {
    const e = byEm.get(d.escala_mensal_id); if (!e) continue
    const k = e.servidor_id + '|' + d.dia
    if (!grupos.has(k)) grupos.set(k, { sid: e.servidor_id, dia: d.dia, jornada: e.jornadas && e.jornadas.nome, linhas: [] })
    grupos.get(k).linhas.push(d)
  }
  const sids = [...new Set([...grupos.values()].map(g => g.sid))]
  const servs = []
  for (let i = 0; i < sids.length; i += 100) servs.push(...await page('servidores?select=id,nome,matricula&id=in.(' + sids.slice(i, i + 100).join(',') + ')'))
  const N = new Map(servs.map(s => [s.id, s]))

  let total = 0, dias = 0, horasPlantao = 0
  const porServ = new Map()
  for (const g of grupos.values()) {
    const uteis = g.linhas.filter(l => l.categoria !== 'Sobreaviso')
    const temReg = uteis.some(l => l.categoria === 'Regular')
    const plantoes = uteis.filter(l => l.categoria === 'Plantão')
    if (temReg || plantoes.length === 0) continue          // aqui so o caso "plantao sem Regular"
    if (!g.jornada) continue                                // plantonista puro sem jornada: fora
    let e = null, s = null
    for (const l of uteis) {
      if (l.presenca_entrada_em && (!e || new Date(l.presenca_entrada_em) < new Date(e))) e = l.presenca_entrada_em
      if (l.presenca_saida_em && (!s || new Date(l.presenca_saida_em) > new Date(s))) s = l.presenca_saida_em
    }
    if (!e || !s) continue
    const fim = fimJ(g.jornada), ini = iniJ(g.jornada)
    if (fim === null) continue
    let sm = minLocal(s); if (ini !== null && sm < ini) sm += 1440
    const extra = Math.max(0, sm - fim)
    if (extra <= 0) continue
    dias++; total += extra
    horasPlantao += plantoes.reduce((a, p) => a + Number(p.dicionario_turnos && p.dicionario_turnos.horas_computadas || 0), 0)
    if (!porServ.has(g.sid)) porServ.set(g.sid, [])
    porServ.get(g.sid).push({ dia: g.dia, jornada: g.jornada, e, s, extra, pl: plantoes.map(p => (p.dicionario_turnos && p.dicionario_turnos.codigo) + '(' + (p.dicionario_turnos && p.dicionario_turnos.horas_computadas) + 'h)').join('+') })
  }
  console.log('### DIA COM PLANTAO E SEM REGULAR — 08/2026 (folha REGERADA a partir do escala_diaria de hoje)')
  console.log('  dias: ' + dias + ' | servidores: ' + porServ.size)
  console.log('  hora extra que a folha cobraria: ' + hm(total))
  console.log('  horas ja pagas pelo anexo de plantoes nesses mesmos dias: ' + horasPlantao + 'h')
  console.log('')
  for (const [sid, arr] of [...porServ.entries()].sort((a, b) => b[1].reduce((x, y) => x + y.extra, 0) - a[1].reduce((x, y) => x + y.extra, 0)).slice(0, 20)) {
    const s = N.get(sid)
    console.log('  ' + String(s && s.nome).slice(0, 30).padEnd(32) + ' mat ' + String(s && s.matricula).padEnd(7) + hm(arr.reduce((x, y) => x + y.extra, 0)).padStart(7))
    for (const a of arr.sort((x, y) => x.dia - y.dia))
      console.log('      d' + String(a.dia).padStart(2) + ' ' + String(a.jornada).padEnd(11) + ' ' + HHMM(a.e) + '->' + HHMM(a.s) + '  extra ' + hm(a.extra).padStart(6) + '   plantao ' + a.pl)
  }
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1) })
