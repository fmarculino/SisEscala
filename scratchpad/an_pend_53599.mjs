import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }

async function get(path) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H })
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
  return r.json()
}

const pend = await get('importacao_rh_pendentes?matricula=eq.53599&select=id,nome,matricula,cpf_normalizado,unidade_id,departamento_origem,vinculo_adicional_de_cpf,promovido_em,cargo_sugerido')
console.log('--- pendencia matricula 53599 ---')
console.log(JSON.stringify(pend, null, 2))

const serv = await get('servidores?matricula=in.(68182,53599)&select=id,nome,matricula,cpf,status,unidade_id,vinculo_multiplo_confirmado,mesclado_em_servidor_id')
console.log('--- servidores 68182 / 53599 ---')
console.log(JSON.stringify(serv, null, 2))

// quantas pendencias nao promovidas tem CPF e nao tem unidade resolvida (o caso cego)
const semUni = await get('importacao_rh_pendentes?promovido_em=is.null&unidade_id=is.null&cpf_normalizado=not.is.null&select=id&limit=1')
const r = await fetch(`${U}/rest/v1/importacao_rh_pendentes?promovido_em=is.null&unidade_id=is.null&cpf_normalizado=not.is.null&select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
console.log('--- pendencias abertas SEM unidade e COM cpf (invisiveis a coordenador):', r.headers.get('content-range'))
const r2 = await fetch(`${U}/rest/v1/importacao_rh_pendentes?promovido_em=is.null&select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
console.log('--- pendencias abertas no total:', r2.headers.get('content-range'))
