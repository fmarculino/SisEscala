/**
 * SO LEITURA. Para os dias que eu reconciliei: compara a folha ATUAL (snapshot velho) com o que
 * a regeneracao produziria a partir do escala_diaria de AGORA. Procura PIORA, nao so melhora.
 *
 * Piora = a folha perder entrada/saida que tinha, ou ganhar hora extra.
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
const COL = { entrada: 'presenca_entrada_em', saida: 'presenca_saida_em' }
const fimJ = n => {
  const m = (n || '').match(/(?:ÀS|AS|as|às)\s*([0-9]+)/), i = (n || '').match(/^([0-9]+)/)
  if (!m || !i) return null
  let f = Number(m[1]) * 60
  if (f <= Number(i[1]) * 60) f += 1440
  return f
}
const iniJ = n => { const i = (n || '').match(/^([0-9]+)/); return i ? Number(i[1]) * 60 : null }

;(async () => {
  const TODAS = process.argv.includes('--todas')
  const lista = JSON.parse(fs.readFileSync(path.join(__dirname, 'reconciliar_agosto.json'), 'utf8'))
  const alvo = new Set(lista.map(l => l.servidor_id + '|' + l.dia))
  const em = await page('escala_mensal?select=id,servidor_id,jornadas(nome)&mes=eq.8&ano=eq.2026')
  const byEm = new Map(em.map(e => [e.id, e]))
  const ed = await page('escala_diaria?select=id,escala_mensal_id,dia,categoria,' + Object.values(COL).join(','))
  const grupos = new Map()
  for (const d of ed) {
    const e = byEm.get(d.escala_mensal_id); if (!e) continue
    const k = e.servidor_id + '|' + d.dia
    if (!grupos.has(k)) grupos.set(k, { jornada: e.jornadas && e.jornadas.nome, linhas: [] })
    grupos.get(k).linhas.push(d)
  }
  const fp = await page('folha_ponto?select=servidor_id,registros&mes=eq.8&ano=eq.2026')
  const sids = [...new Set(TODAS ? fp.map(f => f.servidor_id) : lista.map(l => l.servidor_id))]
  const servs = []
  for (let i = 0; i < sids.length; i += 100) servs.push(...await page('servidores?select=id,nome,matricula&id=in.(' + sids.slice(i, i + 100).join(',') + ')'))
  const N = new Map(servs.map(s => [s.id, s]))

  let melhora = 0, piora = 0, igual = 0, dExtra = 0
  const piores = []
  for (const f of fp) for (const r of (f.registros || [])) {
    const k = f.servidor_id + '|' + r.dia
    if (!TODAS && !alvo.has(k)) continue
    const g = grupos.get(k); if (!g) continue
    const uteis = g.linhas.filter(l => l.categoria !== 'Sobreaviso')
    const temReg = uteis.some(l => l.categoria === 'Regular')
    // executeGerarFolhaPonto: `else if (!shift)` -> dia SEM turno Regular cai como
    // SABADO/DOMINGO/FOLGA e nao recebe horario NEM hora extra. Nao simular isso inflava a conta.
    if (!temReg) continue
    const daFolha = uteis.filter(l => l.categoria === 'Regular' || l.categoria === 'Extra')
    let e = null, s = null
    for (const l of daFolha) {
      const x = l[COL.entrada], y = l[COL.saida]
      if (x && (!e || new Date(x) < new Date(e))) e = x
      if (y && (!s || new Date(y) > new Date(s))) s = y
    }
    const fim = fimJ(g.jornada), ini = iniJ(g.jornada)
    let eB = 0
    if (e && s && fim !== null) { let sm = minLocal(s); if (ini !== null && sm < ini) sm += 1440; eB = Math.max(0, sm - fim) }
    const eA = r.hora_extra_minutos || 0
    dExtra += (eB - eA)

    const perdeuEnt = !!r.entrada && !e
    const perdeuSai = !!r.saida && !s
    const ganhouExtra = eB > eA
    if (perdeuEnt || perdeuSai || ganhouExtra) {
      piora++
      piores.push({ nome: N.get(f.servidor_id) && N.get(f.servidor_id).nome, mat: N.get(f.servidor_id) && N.get(f.servidor_id).matricula,
        dia: r.dia, jornada: g.jornada, antes: (r.entrada || '--:--') + '->' + (r.saida || '--:--'), eA,
        depois: HHMM(e) + '->' + HHMM(s), eB,
        motivo: [perdeuEnt && 'perdeu ENTRADA', perdeuSai && 'perdeu SAIDA', ganhouExtra && 'ganhou EXTRA'].filter(Boolean).join(' + ') })
    } else if (eB < eA || (r.entrada || '') !== HHMM(e) || (r.saida || '') !== HHMM(s)) melhora++
    else igual++
  }
  console.log('### FOLHA ATUAL x FOLHA REGERADA — ' + (TODAS ? 'TODAS as folhas de 08/2026' : lista.length + ' dias reconciliados'))
  console.log('  delta de hora extra: ' + hm(Math.abs(dExtra)) + (dExtra < 0 ? ' A MENOS' : ' A MAIS'))
  console.log('  dias que melhoram/mudam: ' + melhora + ' | iguais: ' + igual + ' | POSSIVEL PIORA: ' + piora)
  console.log('')
  for (const p of piores.sort((a, b) => (b.eB - b.eA) - (a.eB - a.eA)))
    console.log('  ' + String(p.nome).slice(0, 28).padEnd(30) + ' mat ' + String(p.mat).padEnd(7) + ' d' + String(p.dia).padStart(2) + ' ' + String(p.jornada || '').padEnd(11) +
      ' ' + p.antes.padEnd(14) + hm(p.eA).padStart(6) + '  ->  ' + p.depois.padEnd(14) + hm(p.eB).padStart(6) + '   ' + p.motivo)
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1) })
