import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

const r = await fetch(`${U}/rest/v1/rpc/fn_conflito_pendencia_rh`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ p_pendencia_id: '00000000-0000-0000-0000-000000000000', p_cpf: null }),
})
const txt = await r.text()
console.log('fn_conflito_pendencia_rh em producao:', r.status)
console.log('  ', txt.slice(0, 220))
console.log(r.status === 404 ? '  => NAO existe: a migration foi revertida por inteiro.'
                             : '  => JA existe: a migration foi aplicada (ao menos em parte).')
