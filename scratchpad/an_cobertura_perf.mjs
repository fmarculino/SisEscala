import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

async function rpc(fn, body) {
  const t = Date.now()
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  const txt = await r.text()
  return { ms: Date.now() - t, status: r.status, txt }
}

const disp = await fetch(`${U}/rest/v1/dispositivos_rep?select=id,nome,ativo,unidade_id&order=nome`, { headers: H }).then(r => r.json())
console.log('dispositivos_rep:', disp.length, '| ativos:', disp.filter(d => d.ativo).length)

const t0 = Date.now()
const res = await rpc('fn_cobertura_ponto_resumo', { p_mes: 9, p_ano: 2026 })
console.log('resumo (service_role, todos):', res.ms + 'ms', 'status', res.status, res.status !== 200 ? res.txt.slice(0, 300) : (JSON.parse(res.txt).length + ' linhas'))
