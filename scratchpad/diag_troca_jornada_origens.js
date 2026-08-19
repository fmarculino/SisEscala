/** SO LEITURA. Distribuicao de presenca_entrada_origem em 08/2026 (calibra o proxy B). */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY }
const pag = async rec => { const o = []; for (let f = 0; ; f += 1000) { const r = await fetch(U + '/rest/v1/' + rec, { headers: { ...H, Range: f + '-' + (f + 999) } }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); const p = await r.json(); o.push(...p); if (p.length < 1000) break } return o }
const co = (a, f) => { const o = {}; for (const x of a) { const k = f(x) ?? '(null)'; o[k] = (o[k] || 0) + 1 } return o }

;(async () => {
  const em = await pag('escala_mensal?select=id&mes=eq.8&ano=eq.2026')
  const ids = em.map(e => e.id)
  let ed = []
  for (let i = 0; i < ids.length; i += 50)
    ed.push(...await pag(`escala_diaria?select=escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_entrada_origem,presenca_entrada_manual&escala_mensal_id=in.(${ids.slice(i, i + 50).join(',')})`))
  console.log('linhas escala_diaria 08/2026:', ed.length)
  console.log('com presenca_entrada_em:', ed.filter(d => d.presenca_entrada_em).length)
  console.log('origem da entrada:', JSON.stringify(co(ed.filter(d => d.presenca_entrada_em), d => d.presenca_entrada_origem)))
  console.log('entrada_manual:', JSON.stringify(co(ed.filter(d => d.presenca_entrada_em), d => d.presenca_entrada_manual)))
  console.log('categoria:', JSON.stringify(co(ed.filter(d => d.presenca_entrada_em), d => d.categoria)))
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
