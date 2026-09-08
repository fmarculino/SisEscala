import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const disp = await fetch(`${U}/rest/v1/dispositivos_rep?select=id,nome&order=nome`, { headers: H }).then(r => r.json())
const linhas = []
for (const d of disp) {
  const t = Date.now()
  const r = await fetch(`${U}/rest/v1/rpc/fn_cobertura_ponto_dispositivo`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ p_dispositivo_id: d.id, p_mes: 9, p_ano: 2026 }),
  })
  const j = await r.json()
  linhas.push({ nome: d.nome, ms: Date.now() - t, n: Array.isArray(j) ? j.length : -1 })
}
linhas.sort((a, b) => b.ms - a.ms)
let tot = 0
for (const l of linhas) { tot += l.ms; console.log(String(l.ms).padStart(6) + 'ms  ' + String(l.n).padStart(5) + ' pessoas  ' + l.nome) }
console.log('TOTAL', tot + 'ms')
