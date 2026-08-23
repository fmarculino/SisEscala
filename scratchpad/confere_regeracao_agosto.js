/** SO LEITURA. De onde vem o delta de hora extra depois da regeneracao de 08/2026. */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY }
async function page(q, tam = 200) {
  q += (q.includes('?') ? '&' : '?') + 'order=id'
  const out = []
  for (let f = 0; ; f += tam) {
    const r = await fetch(U + '/rest/v1/' + q, { headers: { ...H, Range: f + '-' + (f + tam - 1) } })
    if (!r.ok) throw new Error(r.status + ' ' + await r.text())
    const p = await r.json(); out.push(...p); if (p.length < tam) break
  }
  return out
}
const hm = m => Math.floor(Math.abs(m) / 60) + 'h' + String(Math.round(Math.abs(m) % 60)).padStart(2, '0')

;(async () => {
  const arq = fs.readdirSync(path.join(__dirname)).filter(f => f.startsWith('backup_folhas_')).sort().pop()
  const bk = JSON.parse(fs.readFileSync(path.join(__dirname, arq), 'utf8'))
  const A = new Map(bk.map(f => [f.id, f]))
  const fp = await page('folha_ponto?select=id,servidor_id,status,registros&mes=eq.8&ano=eq.2026')

  const em = await page('escala_mensal?select=id,servidor_id&mes=eq.8&ano=eq.2026', 1000)
  const S = new Map(em.map(e => [e.id, e.servidor_id]))
  const ed = await page('escala_diaria?select=escala_mensal_id,dia,categoria', 1000)
  const temPlantao = new Set(), temExtra = new Set()
  for (const d of ed) {
    const s = S.get(d.escala_mensal_id); if (!s) continue
    if (d.categoria === 'Plantão') temPlantao.add(s + '|' + d.dia)
    if (d.categoria === 'Extra') temExtra.add(s + '|' + d.dia)
  }

  const cat = { extra_escalado: 0, plantao: 0, nenhum: 0 }
  const catDias = { extra_escalado: 0, plantao: 0, nenhum: 0 }
  let subiu = 0, caiu = 0
  const preservados = []
  for (const f of fp) {
    const b = A.get(f.id); if (!b) continue
    const antes = new Map((b.registros || []).map(r => [r.dia, r]))
    for (const r of (f.registros || [])) {
      const a = antes.get(r.dia)
      const d = (r.hora_extra_minutos || 0) - ((a && a.hora_extra_minutos) || 0)
      if (d === 0) continue
      if (d > 0) subiu += d; else caiu += d
      const k = f.servidor_id + '|' + r.dia
      const c = temExtra.has(k) ? 'extra_escalado' : temPlantao.has(k) ? 'plantao' : 'nenhum'
      cat[c] += d; catDias[c]++
    }
    // dias que continuam com extra em dia de plantao E tem campo preservado
    for (const r of (f.registros || [])) {
      if (!(r.hora_extra_minutos > 0)) continue
      if (!temPlantao.has(f.servidor_id + '|' + r.dia)) continue
      const orig = [r.origem_entrada, r.origem_saida].filter(x => x && x !== 'real' && x !== 'pre_assinalado')
      if (orig.length) preservados.push({ sid: f.servidor_id, dia: r.dia, min: r.hora_extra_minutos, orig: orig.join('+'), ent: r.entrada, sai: r.saida })
    }
  }
  console.log('### DELTA DE HORA EXTRA APOS A REGERACAO (08/2026)')
  console.log('  subiu: ' + hm(subiu) + '   caiu: ' + hm(caiu) + '   liquido: ' + (subiu + caiu >= 0 ? '+' : '-') + hm(subiu + caiu))
  console.log('')
  console.log('  por natureza do dia:')
  for (const k of ['extra_escalado', 'plantao', 'nenhum'])
    console.log('    ' + k.padEnd(16) + (cat[k] >= 0 ? '+' : '-') + hm(cat[k]).padStart(7) + '   em ' + catDias[k] + ' dias')

  const sids = [...new Set(preservados.map(p => p.sid))]
  const servs = sids.length ? await page('servidores?select=id,nome,matricula&id=in.(' + sids.join(',') + ')', 1000) : []
  const N = new Map(servs.map(s => [s.id, s]))
  console.log('')
  console.log('### AINDA COM EXTRA EM DIA DE PLANTAO POR CAMPO PRESERVADO (manual/ajuste): ' + preservados.length + ' dias, ' + hm(preservados.reduce((a, b) => a + b.min, 0)))
  console.log('   (preservacao.ts nao regera campo que alguem decidiu — so o coordenador desfaz)')
  for (const p of preservados.sort((a, b) => b.min - a.min)) {
    const s = N.get(p.sid)
    console.log('   ' + String(s && s.nome).slice(0, 30).padEnd(32) + ' mat ' + String(s && s.matricula).padEnd(8) + ' d' + String(p.dia).padStart(2) +
      '  ' + (p.ent || '--:--') + '->' + (p.sai || '--:--') + '  ' + hm(p.min).padStart(6) + '   origem ' + p.orig)
  }
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1) })
