/** LEITURA de producao (autorizada 29/08/2026). Alguem JA gravou justificativa fora do escopo? */
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

const perfis = await todas('profiles?select=id,role,acesso_todas_unidades,acesso_todos_setores,profile_unidades(unidade_id),profile_setores(setor_id)')
const perfilPorId = new Map(perfis.map(p => [p.id, p]))

// Setores com descendentes, para espelhar fn_setores_no_escopo.
const setores = await todas('setores?select=id,unidade_id,parent_id')
const filhos = new Map()
for (const s of setores) if (s.parent_id) (filhos.get(s.parent_id) ?? filhos.set(s.parent_id, []).get(s.parent_id)).push(s.id)
function comDescendentes(ids) {
  const out = new Set(), fila = [...ids]
  while (fila.length) { const id = fila.pop(); if (out.has(id)) continue; out.add(id); for (const f of filhos.get(id) ?? []) fila.push(f) }
  return out
}
const setorUnidade = new Map(setores.map(s => [s.id, s.unidade_id]))

/** Espelha applyAccessFilters: o que a LISTAGEM deixa a pessoa enxergar. */
function enxerga(p, unidadeId, setorId) {
  if (!p) return false
  if (p.role === 'super_admin' || p.role === 'rh') return true
  const unids = new Set((p.profile_unidades ?? []).map(x => x.unidade_id))
  const sets = comDescendentes((p.profile_setores ?? []).map(x => x.setor_id))
  if (p.role === 'rh_unidade') return unids.has(unidadeId)
  if (p.acesso_todas_unidades) return p.acesso_todos_setores ? true : (sets.size ? sets.has(setorId) : true)
  if (unids.size) return p.acesso_todos_setores ? (unids.has(unidadeId) || sets.has(setorId)) : sets.has(setorId)
  return sets.has(setorId)
}

const just = await todas('justificativas_eventos?select=id,unidade_id,setor_id,dia,mes,ano,categoria,registrado_por_id,registrado_por_nome,resultado,created_at')
console.log(`justificativas_eventos: ${just.length}\n`)

const fora = [], semPerfil = [], semUnidade = []
for (const j of just) {
  if (!j.registrado_por_id) continue
  const p = perfilPorId.get(j.registrado_por_id)
  if (!p) { semPerfil.push(j); continue }
  const unid = j.unidade_id ?? setorUnidade.get(j.setor_id)
  if (!unid) { semUnidade.push(j); continue }
  if (!enxerga(p, unid, j.setor_id)) fora.push({ ...j, papel: p.role })
}

console.log('=== Gravacoes FORA do escopo de quem gravou ===')
console.log(`  fora do escopo: ${fora.length}`)
console.log(`  autor sem perfil (conta apagada): ${semPerfil.length}`)
console.log(`  linha sem unidade_id resolvivel:  ${semUnidade.length}\n`)
for (const f of fora.slice(0, 25)) {
  console.log(`  ${String(f.created_at).slice(0,10)}  ${f.papel.padEnd(12)} ${String(f.registrado_por_nome ?? '').slice(0,26).padEnd(26)} ${String(f.dia).padStart(2,'0')}/${f.mes}  ${String(f.categoria).padEnd(11)} resultado=${f.resultado ?? '-'}`)
}

console.log('\n=== Linhas com unidade_id NULO (nao casam com a fila, que filtra por unidade) ===')
console.log(`  ${just.filter(j => !j.unidade_id).length} de ${just.length}`)

console.log('\n=== Coordenadores SEM flag: tem setor vinculado? ===')
const semFlag = perfis.filter(p => p.role === 'coordenador' && !p.acesso_todos_setores && !p.acesso_todas_unidades)
const semFlagSemSetor = semFlag.filter(p => (p.profile_setores?.length ?? 0) === 0)
console.log(`  coordenadores sem flag: ${semFlag.length} | destes, SEM setor vinculado: ${semFlagSemSetor.length}`)
