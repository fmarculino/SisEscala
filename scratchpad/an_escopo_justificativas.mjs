/**
 * LEITURA de producao — autorizada pelo usuario em 29/08/2026.
 * Mede se o OR de `acesso_todos_setores` (alcancaEvento / fn_pode_gerir_justificativa) e
 * problema vivo ou teorico. So SELECT; nada e escrito.
 *
 * A chave vem do ambiente/.env.production e NUNCA e impressa (armadilha 18: repo publico).
 */
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.production', 'utf8')
    .split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY
if (!U || !K) { console.error('Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1) }
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

console.log(`Banco: ${U}\n`)

/** Paginado — PostgREST corta em 1000 em silencio (armadilha 8). */
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

const perfis = await todas('profiles?select=id,role,acesso_todas_unidades,acesso_todos_setores,profile_unidades(unidade_id),profile_setores(setor_id)')
console.log(`profiles: ${perfis.length}\n`)

const PAPEIS_ESCOPADOS = ['admin', 'coordenador', 'ass_adm']

console.log('=== 1. Distribuicao por papel e flags ===')
const porPapel = {}
for (const p of perfis) {
  const k = p.role || '(sem papel)'
  porPapel[k] ??= { total: 0, todasUnid: 0, todosSet: 0, soTodosSet: 0, nenhuma: 0 }
  const g = porPapel[k]
  g.total++
  if (p.acesso_todas_unidades) g.todasUnid++
  if (p.acesso_todos_setores) g.todosSet++
  if (p.acesso_todos_setores && !p.acesso_todas_unidades) g.soTodosSet++
  if (!p.acesso_todos_setores && !p.acesso_todas_unidades) g.nenhuma++
}
console.log('papel'.padEnd(14), 'total'.padStart(6), 'tds_unid'.padStart(9), 'tds_set'.padStart(8), 'SO_tds_set'.padStart(11), 'nenhuma'.padStart(8))
for (const [k, g] of Object.entries(porPapel).sort((a, b) => b[1].total - a[1].total)) {
  console.log(k.padEnd(14), String(g.total).padStart(6), String(g.todasUnid).padStart(9),
    String(g.todosSet).padStart(8), String(g.soTodosSet).padStart(11), String(g.nenhuma).padStart(8))
}

console.log('\n=== 2. A CONDICAO EXATA do buraco (achado 3) ===')
console.log('    papel escopado + acesso_todos_setores + NAO acesso_todas_unidades')
console.log('    -> alcancaEvento devolve true para QUALQUER unidade; a listagem esconde, a gravacao aceita.')
const afetados = perfis.filter(p =>
  PAPEIS_ESCOPADOS.includes(p.role) && p.acesso_todos_setores && !p.acesso_todas_unidades)
console.log(`\n    contas nessa condicao: ${afetados.length}`)
for (const p of afetados) {
  console.log(`      ${p.role.padEnd(12)} unidades=${p.profile_unidades?.length ?? 0} setores=${p.profile_setores?.length ?? 0}  id=${p.id.slice(0, 8)}`)
}

console.log('\n=== 3. Achado 4: coordenador que enxerga a UNIDADE inteira ===')
console.log('    applyAccessFilters caso 2: unidade vinculada + acesso_todos_setores -> .in(unidade_id, ...)')
const coordAmplos = perfis.filter(p =>
  p.role === 'coordenador' && p.acesso_todos_setores && (p.profile_unidades?.length ?? 0) > 0)
console.log(`\n    coordenadores nessa condicao: ${coordAmplos.length} de ${porPapel['coordenador']?.total ?? 0}`)
for (const p of coordAmplos) {
  console.log(`      unidades=${p.profile_unidades.length} setores=${p.profile_setores?.length ?? 0}  id=${p.id.slice(0, 8)}`)
}

console.log('\n=== 4. Quantas unidades um Administrador Geral teria de visitar ===')
const unidades = await todas('unidades?select=id,ativo')
const uAtivas = unidades.filter(u => u.ativo !== false).length
console.log(`    unidades cadastradas: ${unidades.length} (ativas: ${uAtivas})`)

const em = await todas('escala_mensal?select=unidade_id&mes=eq.8&ano=eq.2026')
console.log(`    unidades COM escala em 08/2026: ${new Set(em.map(e => e.unidade_id)).size}`)
