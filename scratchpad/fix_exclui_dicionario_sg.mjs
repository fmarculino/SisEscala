import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const ERRADO='9e921033-be3c-4ba6-97c8-b866d364d03b'
const q = async p => { const r=await fetch(`${U}/rest/v1/${p}`,{headers:H}); const t=await r.text(); return t?JSON.parse(t):null }

// PRE-CONDICAO: so exclui se ninguem mais aponta para a entrada
const usos = await q(`setores?select=id&dicionario_setor_id=eq.${ERRADO}`)
if (usos.length) { console.error(`ABORTA: ainda ha ${usos.length} setor(es) usando a entrada`); process.exit(1) }
const antes = await q(`dicionario_setores?select=id,nome&id=eq.${ERRADO}`)
console.log('entrada a excluir:', JSON.stringify(antes))

const r = await fetch(`${U}/rest/v1/dicionario_setores?id=eq.${ERRADO}`, { method:'DELETE', headers:{...H, Prefer:'return=representation'} })
console.log('DELETE status', r.status, await r.text())

const depois = await q(`dicionario_setores?select=id&id=eq.${ERRADO}`)
console.log(depois.length === 0 ? 'OK  entrada "SERVIÇOS GERAIS" removida do dicionario' : 'FALHA: entrada ainda existe')
const restantes = await q('dicionario_setores?select=id,nome&nome=ilike.*SERVI*GERAIS*')
console.log('\nentradas que ainda mencionam "SERVIÇOS GERAIS":')
console.table(restantes)
process.exit(depois.length === 0 ? 0 : 1)
