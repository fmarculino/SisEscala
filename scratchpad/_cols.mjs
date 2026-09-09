import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}` }
for (const t of process.argv.slice(2)) {
  const r = await fetch(`${U}/rest/v1/${t}?select=*&limit=1`, {headers:H})
  const j = await r.json()
  console.log(t, ':', j[0] ? Object.keys(j[0]).join(', ') : '(vazia)')
}
