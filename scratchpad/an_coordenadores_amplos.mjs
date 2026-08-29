/** LEITURA de producao (autorizada 29/08/2026). Quem sao os coordenadores "unidade inteira". */
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function todas(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from+999}` } })
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
    const p = await r.json(); out.push(...p); if (p.length < 1000) break
  }
  return out
}

const perfis   = await todas('profiles?select=id,full_name,role,acesso_todas_unidades,acesso_todos_setores,profile_unidades(unidade_id),profile_setores(setor_id)')
const unidades = await todas('unidades?select=id,nome')
const setores  = await todas('setores?select=id,unidade_id,ativo,dicionario_setores(nome)')
const em       = await todas('escala_mensal?select=unidade_id,setor_id&mes=eq.8&ano=eq.2026')

const nomeUnid = new Map(unidades.map(u => [u.id, u.nome]))
const setoresPorUnid = new Map()
for (const s of setores) {
  if (s.ativo === false) continue
  ;(setoresPorUnid.get(s.unidade_id) ?? setoresPorUnid.set(s.unidade_id, []).get(s.unidade_id)).push(s)
}
const setoresComEscala = new Map()
for (const e of em) {
  if (!e.setor_id) continue
  ;(setoresComEscala.get(e.unidade_id) ?? setoresComEscala.set(e.unidade_id, new Set()).get(e.unidade_id)).add(e.setor_id)
}

const alvos = perfis.filter(p =>
  p.role === 'coordenador' && p.acesso_todos_setores && !p.acesso_todas_unidades &&
  (p.profile_unidades?.length ?? 0) > 0)

console.log(`\nCoordenadores com "unidade inteira + 0 setores vinculados": ${alvos.length}\n`)
console.log('#   COORDENADOR'.padEnd(36) + 'UNIDADE'.padEnd(42) + 'SET.ATIVOS'.padStart(11) + 'C/ESCALA 08'.padStart(12))
console.log('-'.repeat(101))

alvos.sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''))
alvos.forEach((p, i) => {
  const us = (p.profile_unidades ?? []).map(x => x.unidade_id)
  us.forEach((uid, k) => {
    const nAtivos = (setoresPorUnid.get(uid) ?? []).length
    const nEscala = (setoresComEscala.get(uid) ?? new Set()).size
    const rotulo = k === 0 ? `${String(i + 1).padStart(2)}. ${(p.full_name ?? '(sem nome)').slice(0, 30)}` : ''
    console.log(rotulo.padEnd(36) + String(nomeUnid.get(uid) ?? uid).slice(0, 40).padEnd(42) +
      String(nAtivos).padStart(11) + String(nEscala).padStart(12))
  })
  if ((p.profile_setores?.length ?? 0) > 0) console.log('     (tem setor vinculado tambem)')
})

console.log('\n--- Os outros 4 papeis escopados na mesma condicao (achado 3) ---')
for (const p of perfis.filter(x => ['ass_adm','admin'].includes(x.role) && x.acesso_todos_setores && !x.acesso_todas_unidades)) {
  const us = (p.profile_unidades ?? []).map(x => nomeUnid.get(x.unidade_id) ?? '?')
  console.log(`  ${p.role.padEnd(9)} ${(p.full_name ?? '(sem nome)').slice(0,30).padEnd(32)} unidades: ${us.length ? us.join(', ').slice(0,60) : '(NENHUMA)'}`)
}
