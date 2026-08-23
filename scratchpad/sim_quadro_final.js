/** SO LEITURA. Dias com hora extra + plantao em 08/2026: folha atual x folha regerada com o escala_diaria de hoje. */
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
const COL = {
  entrada: 'presenca_entrada_em',
  intervalo_saida: 'presenca_intervalo_saida_em',
  intervalo_retorno: 'presenca_intervalo_retorno_em',
  saida: 'presenca_saida_em'
}
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
  const ed = await page('escala_diaria?select=id,escala_mensal_id,dia,categoria,' + Object.values(COL).join(','))
  const grupos = new Map()
  for (const d of ed) {
    const e = byEm.get(d.escala_mensal_id); if (!e) continue
    const k = e.servidor_id + '|' + d.dia
    if (!grupos.has(k)) grupos.set(k, { sid: e.servidor_id, dia: d.dia, jornada: e.jornadas && e.jornadas.nome, linhas: [] })
    grupos.get(k).linhas.push(d)
  }
  const fp = await page('folha_ponto?select=id,servidor_id,registros,status&mes=eq.8&ano=eq.2026')
  const sids = [...new Set(fp.map(f => f.servidor_id))]
  const servs = []
  for (let i = 0; i < sids.length; i += 100) {
    servs.push(...await page('servidores?select=id,nome,matricula&id=in.(' + sids.slice(i, i + 100).join(',') + ')'))
  }
  const N = new Map(servs.map(s => [s.id, s]))

  let A = 0, B = 0
  const out = []
  for (const f of fp) for (const r of (f.registros || [])) {
    if (!(r.hora_extra_minutos > 0)) continue
    const g = grupos.get(f.servidor_id + '|' + r.dia)
    if (!g || !g.linhas.some(l => l.categoria === 'Plantão')) continue

    const uteis = g.linhas.filter(l => l.categoria !== 'Sobreaviso')
    const temReg = uteis.some(l => l.categoria === 'Regular')
    const daFolha = temReg ? uteis.filter(l => l.categoria === 'Regular' || l.categoria === 'Extra') : uteis
    const fim = fimJ(g.jornada), ini = iniJ(g.jornada)
    let e = null, s = null
    for (const l of daFolha) {
      const x = l[COL.entrada], y = l[COL.saida]
      if (x && (!e || new Date(x) < new Date(e))) e = x
      if (y && (!s || new Date(y) > new Date(s))) s = y
    }
    let eB = 0
    if (e && s && fim !== null) {
      let sm = minLocal(s)
      if (ini !== null && sm < ini) sm += 1440
      eB = Math.max(0, sm - fim)
    }
    A += r.hora_extra_minutos; B += eB
    out.push({
      nome: N.get(f.servidor_id) && N.get(f.servidor_id).nome,
      mat: N.get(f.servidor_id) && N.get(f.servidor_id).matricula,
      dia: g.dia, jornada: g.jornada, eA: r.hora_extra_minutos, eB,
      folha: (r.entrada || '--:--') + '->' + (r.saida || '--:--'),
      reg: HHMM(e) + '->' + HHMM(s)
    })
  }
  console.log('')
  console.log('### HORA EXTRA EM DIA COM PLANTAO ESCALADO - 08/2026 (' + out.length + ' dias)')
  console.log('  A) como esta na folha hoje ..................... ' + hm(A))
  console.log('  B) so REGERANDO a folha (codigo atual, sem SQL)  ' + hm(B) + '   cai ' + hm(A - B))
  console.log('')
  for (const o of out.sort((x, y) => (y.eA - y.eB) - (x.eA - x.eB))) {
    const c1 = String(o.nome).slice(0, 28).padEnd(30) + ' mat ' + String(o.mat).padEnd(7) + ' d' + String(o.dia).padStart(2) + ' ' + String(o.jornada || '').padEnd(11)
    const c2 = ' folha ' + o.folha.padEnd(14) + hm(o.eA).padStart(6)
    const c3 = '  |  regerada ' + o.reg.padEnd(14) + hm(o.eB).padStart(6)
    console.log(c1 + c2 + c3 + (o.eA !== o.eB ? '   <<<' : ''))
  }
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1) })
