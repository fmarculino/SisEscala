import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }

async function count(q) {
  const r = await fetch(`${U}/rest/v1/${q}`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
  return (r.headers.get('content-range') || '').split('/')[1]
}
const rows = [
  ['abertas (nao promovidas)',            'importacao_rh_pendentes?promovido_em=is.null&select=id'],
  ['  sem unidade resolvida',             'importacao_rh_pendentes?promovido_em=is.null&unidade_id=is.null&select=id'],
  ['  sem unidade E com cpf (cegas)',     'importacao_rh_pendentes?promovido_em=is.null&unidade_id=is.null&cpf_normalizado=not.is.null&select=id'],
  ['  sem cpf nenhum (p_cpf digitado)',   'importacao_rh_pendentes?promovido_em=is.null&cpf_normalizado=is.null&select=id'],
  ['  marcadas vinculo_adicional_de_cpf', 'importacao_rh_pendentes?promovido_em=is.null&vinculo_adicional_de_cpf=is.true&select=id'],
  ['  vinc.adicional E sem unidade',      'importacao_rh_pendentes?promovido_em=is.null&vinculo_adicional_de_cpf=is.true&unidade_id=is.null&select=id'],
]
for (const [label, q] of rows) console.log(String(await count(q)).padStart(5), label)
