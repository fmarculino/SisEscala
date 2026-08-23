/** SO LEITURA. Agosto/2026: hora extra na folha em dias que TEM plantao escalado = dupla contagem. */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
async function page(q) { q += (q.includes('?') ? '&' : '?') + 'order=id'; const out = []; for (let f = 0; ; f += 1000) { const r = await fetch(U + '/rest/v1/' + q, { headers: { ...H, Range: `${f}-${f + 999}` } }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); const p = await r.json(); out.push(...p); if (p.length < 1000) break } return out }
const hm = m => Math.floor(m/60) + 'h' + String(m%60).padStart(2,'0')

;(async () => {
  const em = await page('escala_mensal?select=id,servidor_id&mes=eq.8&ano=eq.2026')
  const emServ = new Map(em.map(e => [e.id, e.servidor_id]))
  const ed = await page('escala_diaria?select=escala_mensal_id,dia,categoria,dicionario_turnos(codigo,horas_computadas)')
  // dias com plantao/extra por servidor
  const plantaoDia = new Map()  // servidor|dia -> [codigos]
  for (const d of ed) {
    if (d.categoria !== 'Plantão') continue
    const s = emServ.get(d.escala_mensal_id); if (!s) continue
    const k = s + '|' + d.dia
    if (!plantaoDia.has(k)) plantaoDia.set(k, [])
    plantaoDia.get(k).push((d.dicionario_turnos?.codigo || '?') + '(' + (d.dicionario_turnos?.horas_computadas ?? '?') + 'h)')
  }
  const regularDia = new Set()
  for (const d of ed) { if (d.categoria === 'Regular') { const s = emServ.get(d.escala_mensal_id); if (s) regularDia.add(s + '|' + d.dia) } }

  const fp = await page('folha_ponto?select=id,servidor_id,registros,status&mes=eq.8&ano=eq.2026')
  console.log('folhas 08/2026: ' + fp.length)
  const servIds = [...new Set(fp.map(f => f.servidor_id))]
  const servs = []
  for (let i = 0; i < servIds.length; i += 100) servs.push(...await page('servidores?select=id,nome,matricula&id=in.(' + servIds.slice(i, i+100).join(',') + ')'))
  const N = new Map(servs.map(s => [s.id, s]))

  let totExtraMin = 0, totExtraDias = 0, dupMin = 0, dupDias = 0
  const porServ = new Map()
  for (const f of fp) {
    for (const r of (f.registros || [])) {
      const min = r.hora_extra_minutos || 0
      if (min <= 0) continue
      totExtraMin += min; totExtraDias++
      const k = f.servidor_id + '|' + r.dia
      if (!plantaoDia.has(k)) continue
      dupMin += min; dupDias++
      if (!porServ.has(f.servidor_id)) porServ.set(f.servidor_id, [])
      porServ.get(f.servidor_id).push({ dia: r.dia, min, ent: r.entrada, sai: r.saida, pl: plantaoDia.get(k).join('+'), temReg: regularDia.has(k), st: f.status })
    }
  }
  console.log('TOTAL hora extra 08/2026: ' + totExtraDias + ' dias, ' + hm(totExtraMin))
  console.log('DESSES, em dia COM plantao escalado: ' + dupDias + ' dias, ' + hm(dupMin) + '  <-- dupla contagem')
  console.log('servidores: ' + porServ.size + '\n')
  for (const [sid, arr] of [...porServ.entries()].sort((a,b) => b[1].reduce((x,y)=>x+y.min,0) - a[1].reduce((x,y)=>x+y.min,0))) {
    const s = N.get(sid)
    console.log((s?.nome || sid).slice(0,38).padEnd(40) + ' mat ' + String(s?.matricula||'-').padEnd(7) + ' ' + hm(arr.reduce((x,y)=>x+y.min,0)).padStart(7) + '  [' + arr[0].st + ']')
    for (const a of arr.sort((x,y)=>x.dia-y.dia)) console.log('     dia ' + String(a.dia).padStart(2) + '  ' + (a.ent||'--:--') + '->' + (a.sai||'--:--') + '  extra ' + hm(a.min).padStart(6) + '  plantao ' + a.pl + (a.temReg ? '' : '  (SEM regular)'))
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
