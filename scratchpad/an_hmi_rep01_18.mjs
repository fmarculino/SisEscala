import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

async function q(path) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H })
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
  return r.json()
}

const disp = await q('dispositivos_rep?select=id,nome,endereco_ip,unidade_id,ativo,ultimo_contato_em,ultimo_nsr,geracao_atual,ponto_valido_desde,unidades(nome)&order=nome')
const hmi = disp.filter(d => (d.unidades?.nome || '').toUpperCase().includes('HMI'))
console.log('=== DISPOSITIVOS DO HMI ===')
for (const d of hmi) {
  console.log(`${d.nome.padEnd(24)} ip=${String(d.endereco_ip).padEnd(14)} ativo=${d.ativo} ultimo_nsr=${d.ultimo_nsr} ger=${d.geracao_atual} contato=${d.ultimo_contato_em}`)
  console.log(`   id=${d.id}`)
}
