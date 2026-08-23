/** SO LEITURA. Agosto/2026: dias com 2+ turnos no mesmo dia e o estado da batida de fronteira. */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
async function page(q) { q += (q.includes('?') ? '&' : '?') + 'order=id'; const out = []; for (let f = 0; ; f += 1000) { const r = await fetch(U + '/rest/v1/' + q, { headers: { ...H, Range: `${f}-${f + 999}` } }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); const p = await r.json(); out.push(...p); if (p.length < 1000) break } return out }

;(async () => {
  const em = await page('escala_mensal?select=id,servidor_id,unidade_id,jornadas(nome,horas_totais)&mes=eq.8&ano=eq.2026')
  const byEm = new Map(em.map(e => [e.id, e]))
  const ed = await page('escala_diaria?select=id,escala_mensal_id,dia,categoria,dicionario_turnos(codigo,horas_computadas),presenca_entrada_em,presenca_saida_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_entrada_manual,presenca_saida_manual,presenca_entrada_origem,presenca_saida_origem')
  console.log('escala_mensal 08/2026: ' + em.length + ' | escala_diaria: ' + ed.length)

  const grupos = new Map()
  for (const d of ed) {
    const e = byEm.get(d.escala_mensal_id); if (!e) continue
    const k = e.servidor_id + '|' + d.dia
    if (!grupos.has(k)) grupos.set(k, { servidor_id: e.servidor_id, dia: d.dia, unidade_id: e.unidade_id, jornada: e.jornadas?.nome, jornadaH: e.jornadas?.horas_totais, linhas: [] })
    grupos.get(k).linhas.push(d)
  }

  const stats = { total: 0, multi: 0, comPlantao: 0, mesmoPar: 0, parDistinto: 0, semPresenca: 0, parcial: 0 }
  const casos = []
  for (const g of grupos.values()) {
    stats.total++
    const uteis = g.linhas.filter(l => l.categoria !== 'Sobreaviso')
    if (uteis.length < 2) continue
    stats.multi++
    const temReg = uteis.some(l => l.categoria === 'Regular')
    const temPlantao = uteis.some(l => l.categoria === 'Plantão')
    if (!(temReg && temPlantao)) continue
    stats.comPlantao++
    const comPres = uteis.filter(l => l.presenca_entrada_em || l.presenca_saida_em)
    if (comPres.length === 0) { stats.semPresenca++; continue }
    if (comPres.length < uteis.length) { stats.parcial++ }
    const ents = new Set(comPres.map(l => l.presenca_entrada_em || 'null'))
    const sais = new Set(comPres.map(l => l.presenca_saida_em || 'null'))
    const mesmoPar = ents.size === 1 && sais.size === 1 && comPres.length === uteis.length
    if (mesmoPar) { stats.mesmoPar++; casos.push(g) } else stats.parDistinto++
  }
  console.log(JSON.stringify(stats, null, 1))

  // Detalhe dos casos "mesmo par" — os que contaminam a folha
  const servIds = [...new Set(casos.map(c => c.servidor_id))]
  const servs = await page('servidores?select=id,nome,matricula&id=in.(' + servIds.join(',') + ')')
  const N = new Map(servs.map(s => [s.id, s]))
  const unIds = [...new Set(casos.map(c => c.unidade_id))]
  const uns = await page('unidades?select=id,nome,fonte_ponto_oficial&id=in.(' + unIds.join(',') + ')')
  const UN = new Map(uns.map(u => [u.id, u]))
  const porServ = new Map()
  for (const c of casos) {
    const k = c.servidor_id
    if (!porServ.has(k)) porServ.set(k, [])
    porServ.get(k).push(c)
  }
  console.log('\n=== servidores afetados: ' + porServ.size + ' | dias: ' + casos.length + ' ===')
  for (const [sid, arr] of [...porServ.entrees ? [] : porServ.entries()].sort((a,b) => b[1].length - a[1].length)) {
    const s = N.get(sid), u = UN.get(arr[0].unidade_id)
    console.log((s?.nome || sid).padEnd(42) + ' mat ' + String(s?.matricula || '-').padEnd(7) + ' ' + String(u?.nome || '').slice(0, 28).padEnd(30) + ' [' + (u?.fonte_ponto_oficial) + '] ' + arr.length + ' dias: ' + arr.map(a => a.dia).sort((x,y)=>x-y).join(','))
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
