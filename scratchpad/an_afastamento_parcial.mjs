import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY
if (!U || !K) { console.error('faltam credenciais em .env.production'); process.exit(1) }
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

export async function todos(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`${r.status} ${path}: ${await r.text()}`)
    const page = await r.json()
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}
export { U, K, H }
