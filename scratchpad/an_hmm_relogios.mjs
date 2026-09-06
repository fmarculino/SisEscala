// Leitura de producao: estado dos relogios do HMM (06/09/2026)
import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
if (!K) { console.error('sem service role key'); process.exit(1) }
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

async function todas(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
    const p = await r.json()
    out.push(...p)
    if (p.length < 1000) break
  }
  return out
}

const disp = await todas('dispositivos_rep?select=*&order=nome')
console.log('=== colunas de dispositivos_rep ===')
console.log(Object.keys(disp[0] || {}).join(', '))
const unidades = await todas('unidades?select=id,nome')
const nomeUni = Object.fromEntries(unidades.map(u => [u.id, u.nome]))
const hmm = disp.filter(d => (nomeUni[d.unidade_id] || '').toUpperCase().includes('HMM')
  || (d.nome || '').toUpperCase().includes('HMM') || (d.nome || '').toUpperCase().includes('CCE'))
console.log('\n=== relogios do HMM ===')
for (const d of hmm) {
  console.log(JSON.stringify({
    nome: d.nome, id: d.id, unidade: nomeUni[d.unidade_id], ativo: d.ativo,
    endereco_ip: d.endereco_ip, coletor_ip: d.coletor_ip, coletor_hostname: d.coletor_hostname,
    versao_coletor: d.versao_coletor, ultimo_contato_em: d.ultimo_contato_em,
    ponto_valido_desde: d.ponto_valido_desde, updated_at: d.updated_at,
  }, null, 1))
}
fs.writeFileSync('scratchpad/_hmm_disp.json', JSON.stringify(hmm, null, 2))
