import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.production', import.meta.url), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
export const U = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')
const K = env.SUPABASE_SERVICE_ROLE_KEY
if (!U || !K) { console.error('faltam credenciais'); process.exit(1) }
export const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
export async function q(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()} :: ${path}`)
    const page = await r.json(); out.push(...page)
    if (page.length < 1000) break
  }
  return out
}
export async function rpc(fn, body) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body || {}) })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()} :: rpc/${fn}`)
  return r.json()
}
