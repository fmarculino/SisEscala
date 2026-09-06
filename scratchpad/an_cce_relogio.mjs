import fs from 'node:fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const U = env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1'
const K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
async function q(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    const t = await r.text()
    if (!r.ok) { console.error('ERRO', path, r.status, t.slice(0,300)); return out }
    const page = JSON.parse(t); out.push(...page)
    if (page.length < 1000) break
  }
  return out
}
const disp = await q('dispositivos_rep?select=id,nome,unidade_id,setor_id,endereco_ip,ativo,ultimo_contato_em,created_at,updated_at,coletor_versao,ponto_valido_desde,ultimo_nsr&order=nome')
const unids = await q('unidades?select=id,nome')
const mapU = Object.fromEntries(unids.map(u => [u.id, u.nome]))
console.log('=== DISPOSITIVOS ===')
for (const d of disp) {
  console.log([d.nome, mapU[d.unidade_id], d.endereco_ip, d.ativo ? 'ativo':'INATIVO', 'ult:'+(d.ultimo_contato_em||'').slice(0,16), 'v'+(d.coletor_versao||'?'), 'nsr:'+d.ultimo_nsr, d.id].join(' | '))
}
