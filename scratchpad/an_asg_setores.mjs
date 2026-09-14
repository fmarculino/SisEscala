import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function pag(url) {
  const out = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(url, { headers: { ...H, Range: `${f}-${f+999}` } })
    const p = await r.json()
    if (!Array.isArray(p)) { console.error('ERRO', JSON.stringify(p).slice(0,300)); break }
    out.push(...p); if (p.length < 1000) break
  }
  return out
}
const ERRADO = '9e921033-be3c-4ba6-97c8-b866d364d03b' // SERVICOS GERAIS
const CERTO  = '78bab353-7c0f-41e8-9472-36a44d9645fa' // ASG AGENTE DE SERVICOS GERAIS
const ASG    = '707881c5-0aa0-40b4-861b-6ef54a09204e' // ASG

const setores = await pag(`${U}/rest/v1/setores?select=*&order=id`)
console.log('total de setores:', setores.length, '| colunas:', Object.keys(setores[0]||{}).join(', '))
const unid = Object.fromEntries((await pag(`${U}/rest/v1/unidades?select=id,nome`)).map(u => [u.id, u.nome]))

const alvo = setores.filter(s => [ERRADO, CERTO, ASG].includes(s.dicionario_setor_id))
const rot = { [ERRADO]: 'SERVICOS GERAIS', [CERTO]: 'ASG AGENTE...', [ASG]: 'ASG' }

// por unidade
const porUni = new Map()
for (const s of alvo) {
  const k = s.unidade_id
  if (!porUni.has(k)) porUni.set(k, [])
  porUni.get(k).push(s)
}
console.log('\n=== setores por unidade ===')
const linhas = []
for (const [uid, lista] of porUni) {
  const l = { unidade: (unid[uid]||'?').slice(0,32) }
  for (const s of lista) {
    const tag = rot[s.dicionario_setor_id]
    l[tag] = (l[tag] ? l[tag] + ' + ' : '') + (s.ativo === false ? 'INATIVO' : 'sim') + (s.parent_id ? ' (sub)' : '')
  }
  linhas.push(l)
}
console.table(linhas.sort((a,b)=>a.unidade.localeCompare(b.unidade)))
console.log('\ncontagem: errado=%d certo=%d asg=%d',
  alvo.filter(s=>s.dicionario_setor_id===ERRADO).length,
  alvo.filter(s=>s.dicionario_setor_id===CERTO).length,
  alvo.filter(s=>s.dicionario_setor_id===ASG).length)
fs.writeFileSync('scratchpad/_asg_alvo.json', JSON.stringify({ alvo, unid }, null, 1))
