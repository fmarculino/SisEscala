/** SO LEITURA. Marcacoes sinteticas de origem 'terminal' (fabricadas por fn_salvar_saida_bloco). */
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
const D = t => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

;(async () => {
  const meses = [['2026-06-01', '2026-07-01', '06/2026'], ['2026-07-01', '2026-08-01', '07/2026'], ['2026-08-01', '2026-09-01', '08/2026']]
  for (const [ini, fim, rot] of meses) {
    const tot = await page('marcacoes_ponto?select=id,origem,sintetica&ocorrido_em=gte.' + ini + '&ocorrido_em=lt.' + fim)
    const porOrig = {}
    for (const m of tot) {
      const k = m.origem + (m.sintetica ? ' SINTETICA' : '')
      porOrig[k] = (porOrig[k] || 0) + 1
    }
    console.log(rot + ': ' + tot.length + ' marcacoes | ' + JSON.stringify(porOrig))
  }

  // Detalhe 08/2026: sinteticas com origem terminal
  const sint = await page('marcacoes_ponto?select=id,servidor_id,ocorrido_em,origem,sintetica,observacao&sintetica=is.true&origem=eq.terminal&ocorrido_em=gte.2026-08-01&ocorrido_em=lt.2026-09-01')
  console.log('')
  console.log('### 08/2026 — marcacoes SINTETICAS com origem "terminal": ' + sint.length)
  const sids = [...new Set(sint.map(m => m.servidor_id))]
  const servs = []
  for (let i = 0; i < sids.length; i += 100) {
    servs.push(...await page('servidores?select=id,nome,matricula&id=in.(' + sids.slice(i, i + 100).join(',') + ')'))
  }
  const N = new Map(servs.map(s => [s.id, s]))
  const porServ = new Map()
  for (const m of sint) {
    if (!porServ.has(m.servidor_id)) porServ.set(m.servidor_id, [])
    porServ.get(m.servidor_id).push(m)
  }
  console.log('servidores: ' + porServ.size)
  for (const [sid, arr] of [...porServ.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) {
    const s = N.get(sid)
    console.log('  ' + String(s && s.nome).slice(0, 34).padEnd(36) + ' mat ' + String(s && s.matricula).padEnd(7) + String(arr.length).padStart(3) + '  ' +
      arr.map(m => D(m.ocorrido_em)).sort().slice(0, 8).join(' '))
  }

  // Quantas dessas sinteticas estao APONTADAS por escala_diaria (viram horario de folha)?
  const ids = sint.map(m => m.id)
  let apontadas = 0
  for (let i = 0; i < ids.length; i += 60) {
    const lote = ids.slice(i, i + 60).join(',')
    for (const col of ['presenca_entrada_marcacao_id', 'presenca_intervalo_saida_marcacao_id', 'presenca_intervalo_retorno_marcacao_id', 'presenca_saida_marcacao_id']) {
      const r = await page('escala_diaria?select=id&' + col + '=in.(' + lote + ')')
      apontadas += r.length
    }
  }
  console.log('')
  console.log('dessas, JA GRAVADAS como horario de presenca em escala_diaria: ' + apontadas)
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1) })
