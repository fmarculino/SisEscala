import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function count(q) {
  const r = await fetch(`${U}/rest/v1/${q}`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
  return (r.headers.get('content-range') || '').split('/')[1]
}
console.log('abertas ................', await count('importacao_rh_pendentes?promovido_em=is.null&select=id'))
console.log('cpf_normalizado = ""....', await count('importacao_rh_pendentes?promovido_em=is.null&cpf_normalizado=eq.&select=id'))
console.log('cpf com < 11 digitos ...', await count('importacao_rh_pendentes?promovido_em=is.null&cpf_normalizado=not.like.___________&select=id'))
