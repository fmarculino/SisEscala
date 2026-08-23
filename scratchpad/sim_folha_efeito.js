/** SO LEITURA. Efeito de C1+C2 na consolidacao da folha (turnosDaFolha: Regular+Extra) e na hora extra. */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
async function page(q) { q += (q.includes('?') ? '&' : '?') + 'order=id'; const out = []; for (let f = 0; ; f += 1000) { const r = await fetch(U + '/rest/v1/' + q, { headers: { ...H, Range: `${f}-${f + 999}` } }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); const p = await r.json(); out.push(...p); if (p.length < 1000) break } return out }
const rpc = async (f, b) => { const r = await fetch(U + '/rest/v1/rpc/' + f, { method: 'POST', headers: H, body: JSON.stringify(b) }); if (!r.ok) throw new Error(f + ' ' + r.status + ' ' + await r.text()); return r.json() }
const HHMM = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : ' -- '
const minLocal = t => { if (!t) return null; const d = new Date(t).toLocaleString('en-CA', { timeZone: 'America/Sao_Paulo', hour12: false, hour: '2-digit', minute: '2-digit' }); const [h, m] = d.split(':').map(Number); return h * 60 + m }
const hm = m => (m < 0 ? '-' : '') + Math.floor(Math.abs(m) / 60) + 'h' + String(Math.abs(m) % 60).padStart(2, '0')
const PASSOS = ['entrada', 'intervalo_saida', 'intervalo_retorno', 'saida']
const COL = { entrada: 'presenca_entrada_em', intervalo_saida: 'presenca_intervalo_saida_em', intervalo_retorno: 'presenca_intervalo_retorno_em', saida: 'presenca_saida_em' }
const fimJornada = nome => { const m = (nome || '').match(/(?:ÀS|AS|as|às)\s*([0-9]+)/); return m ? Number(m[1]) * 60 : null }

;(async () => {
  const em = await page('escala_mensal?select=id,servidor_id,jornadas(nome)&mes=eq.8&ano=eq.2026')
  const byEm = new Map(em.map(e => [e.id, e]))
  const ed = await page('escala_diaria?select=id,escala_mensal_id,dia,categoria,dicionario_turnos(codigo),presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em')
  const grupos = new Map()
  for (const d of ed) { const e = byEm.get(d.escala_mensal_id); if (!e) continue
    const k = e.servidor_id + '|' + d.dia
    if (!grupos.has(k)) grupos.set(k, { sid: e.servidor_id, dia: d.dia, jornada: e.jornadas?.nome, linhas: [] })
    grupos.get(k).linhas.push(d) }
  const alvo = [...grupos.values()].filter(g => g.linhas.filter(l => l.categoria !== 'Sobreaviso').length >= 2)
  const servIds = [...new Set(alvo.map(a => a.sid))]
  const servs = []
  for (let i = 0; i < servIds.length; i += 100) servs.push(...await page('servidores?select=id,nome,matricula&id=in.(' + servIds.slice(i, i + 100).join(',') + ')'))
  const N = new Map(servs.map(s => [s.id, s]))

  let totAntes = 0, totDepois = 0
  const linhasOut = []
  for (const g of alvo) {
    const data = '2026-08-' + String(g.dia).padStart(2, '0')
    let blocos, aloc
    try { blocos = await rpc('fn_blocos_previstos_dia', { p_servidor_id: g.sid, p_data: data }); aloc = await rpc('fn_alocar_marcacoes_dia', { p_servidor_id: g.sid, p_data: data }) } catch (e) { continue }
    if (!blocos.some(b => (b.escala_diaria_ids || []).length > 1)) continue
    const turnoDe = new Map()
    for (const b of blocos) { const ids = b.escala_diaria_ids || []
      ids.forEach((id, i) => turnoDe.set(id, { ini: b.turnos_inicio?.[i], fim: b.turnos_fim?.[i], primeiro: i === 0, ultimo: i === ids.length - 1 })) }
    const alocs = (aloc.alocacoes || []).slice()
    const fronts = alocs.filter(a => a.fronteira)
    for (const b of blocos) { const ids = b.escala_diaria_ids || []
      for (let i = 0; i < ids.length - 1; i++) {
        const sI = fronts.find(a => a.passo === 'saida' && a.escala_diaria_ids?.[0] === ids[i])
        const eJ = fronts.find(a => a.passo === 'entrada' && a.escala_diaria_ids?.[0] === ids[i + 1])
        if (sI && !eJ) alocs.push({ ...sI, passo: 'entrada', escala_diaria_ids: [ids[i + 1]] })
        else if (eJ && !sI) alocs.push({ ...eJ, passo: 'saida', escala_diaria_ids: [ids[i]] })
      } }
    const marcIds = [...new Set(alocs.map(a => a.marcacao_id))]
    if (!marcIds.length) continue
    const marcs = await page('marcacoes_ponto?select=id,ocorrido_em&id=in.(' + marcIds.join(',') + ')')
    const M = new Map(marcs.map(m => [m.id, m]))
    const proj = new Map()
    for (const a of alocs) { const m = M.get(a.marcacao_id); if (!m) continue
      for (const id of (a.escala_diaria_ids || [])) { const t = turnoDe.get(id)
        if (!a.fronteira && t) {
          if (a.passo === 'entrada' && !t.primeiro) continue
          if (a.passo === 'saida' && !t.ultimo) continue
          if (a.passo.startsWith('intervalo') && t.ini && t.fim) { const p = new Date(a.previsto).getTime()
            if (!(p >= new Date(t.ini).getTime() && p <= new Date(t.fim).getTime())) continue } }
        if (!proj.has(id)) proj.set(id, {})
        const cur = proj.get(id)[a.passo]
        if (!cur || (a.fronteira && !cur.fronteira)) proj.get(id)[a.passo] = { ts: m.ocorrido_em, fronteira: !!a.fronteira } } }

    // consolidacao da folha: turnosDaFolha (Regular+Extra quando ha Regular) + min(entrada)/max(saida)
    const uteis = g.linhas.filter(l => l.categoria !== 'Sobreaviso')
    const temReg = uteis.some(l => l.categoria === 'Regular')
    const daFolha = temReg ? uteis.filter(l => l.categoria === 'Regular' || l.categoria === 'Extra') : uteis
    const cons = (getter) => { let ent = null, sai = null
      for (const l of daFolha) { const e = getter(l, 'entrada'), s = getter(l, 'saida')
        if (e && (ent === null || new Date(e) < new Date(ent))) ent = e
        if (s && (sai === null || new Date(s) > new Date(sai))) sai = s }
      return { ent, sai } }
    const A = cons((l, p) => l[COL[p]])
    const B = cons((l, p) => proj.get(l.id)?.[p]?.ts || null)
    const fim = fimJornada(g.jornada)
    const extra = c => { if (!c.ent || !c.sai || fim === null) return 0; const s = minLocal(c.sai); return Math.max(0, s - fim) }
    const eA = extra(A), eB = extra(B)
    totAntes += eA; totDepois += eB
    if (eA !== eB || A.ent !== B.ent || A.sai !== B.sai) {
      const s = N.get(g.sid)
      linhasOut.push({ nome: s?.nome, mat: s?.matricula, dia: g.dia, jornada: g.jornada, A, B, eA, eB,
        temPlantao: uteis.some(l => l.categoria === 'Plantão') })
    }
  }
  console.log('\n### EFEITO NA FOLHA (consolidacao Regular+Extra)')
  console.log('hora extra somada nos dias de bloco fundido:  antes ' + hm(totAntes) + '   depois ' + hm(totDepois) + '   (delta ' + hm(totDepois - totAntes) + ')')
  console.log('dias em que a folha muda: ' + linhasOut.length + '\n')
  for (const r of linhasOut.sort((a, b) => (b.eA - b.eB) - (a.eA - a.eB))) {
    const l1 = String(r.nome).slice(0, 30).padEnd(32) + ' mat ' + String(r.mat).padEnd(7) + ' dia ' + String(r.dia).padStart(2) + ' ' + String(r.jornada || '').padEnd(12)
    const l2 = ' antes ' + HHMM(r.A.ent) + '->' + HHMM(r.A.sai) + ' extra ' + hm(r.eA).padStart(6)
    const l3 = '  |  depois ' + HHMM(r.B.ent) + '->' + HHMM(r.B.sai) + ' extra ' + hm(r.eB).padStart(6)
    console.log(l1 + l2 + l3 + (r.temPlantao ? '  [tem plantao]' : ''))
  }
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1) })
