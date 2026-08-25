import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('c:/Users/Cliente/Projetos/SisEscala/.env.production', 'utf8')
    .split(/\r?\n/).filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
export const U = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')
const K = env.SUPABASE_SERVICE_ROLE_KEY
if (!U || !K) { console.error('faltam credenciais'); process.exit(1) }
export const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

export async function q(path, { range } = {}) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const h = { ...H, Range: `${from}-${from + 999}` }
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: h })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()} :: ${path}`)
    const page = await r.json()
    out.push(...page)
    if (page.length < 1000 || range === false) break
  }
  return out
}
