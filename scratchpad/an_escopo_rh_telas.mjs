// Mede o alcance de abrir /marcacoes e /servidores/pendencias para RH Geral e RH da Unidade.
// SO LEITURA.
//   node scratchpad/an_escopo_rh_telas.mjs [.env.production]
import { env } from './_env.mjs'

const E = env(process.argv[2] || '.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

console.log(`banco: ${U}\n`)

async function get(path) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H })
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
  return r.json()
}
async function rpc(fn, body = {}) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  if (!r.ok) return { erro: `${r.status} ${(await r.text()).slice(0, 200)}` }
  return { dados: await r.json() }
}

// --- 1. perfis de RH -------------------------------------------------------
const perfis = await get('profiles?select=id,full_name,role,acesso_todas_unidades,acesso_todos_setores,profile_unidades(unidade_id),profile_setores(setor_id)&role=in.(rh,rh_unidade,admin)&order=role,full_name')
const unidades = await get('unidades?select=id,nome,ativo&order=nome')
const nomeUnid = new Map(unidades.map(u => [u.id, u.nome]))

console.log('=== 1. PERFIS DE RH / DIRETOR ===')
for (const p of perfis) {
  const us = (p.profile_unidades || []).map(x => nomeUnid.get(x.unidade_id) || x.unidade_id)
  console.log(`  ${p.role.padEnd(11)} ${String(p.full_name).slice(0, 28).padEnd(28)} todasUnid=${String(p.acesso_todas_unidades).padEnd(5)} todosSet=${String(p.acesso_todos_setores).padEnd(5)} unidades(${us.length}): ${us.join(' | ') || '(nenhuma)'} setores=${(p.profile_setores || []).length}`)
}
const porRole = {}
for (const p of perfis) porRole[p.role] = (porRole[p.role] || 0) + 1
console.log(`  totais: ${JSON.stringify(porRole)}   unidades no cadastro: ${unidades.length} (${unidades.filter(u => u.ativo === false).length} inativas)\n`)

// --- 2. parque de relogios/terminais por unidade ---------------------------
const disp = await get('dispositivos_rep?select=id,nome,unidade_id,ativo&order=nome')
const term = await get('terminais_locais?select=id,nome,unidade_id,ativo&order=nome')
console.log('=== 2. PARQUE ===')
console.log(`  dispositivos_rep: ${disp.length} (${disp.filter(d => d.ativo).length} ativos) em ${new Set(disp.map(d => d.unidade_id)).size} unidades`)
console.log(`  terminais_locais: ${term.length} (${term.filter(t => t.ativo).length} ativos) em ${new Set(term.map(t => t.unidade_id)).size} unidades`)
for (const p of perfis.filter(x => x.role === 'rh_unidade')) {
  const us = new Set((p.profile_unidades || []).map(x => x.unidade_id))
  console.log(`    -> ${String(p.full_name).slice(0, 24).padEnd(24)} alcancaria ${disp.filter(d => us.has(d.unidade_id)).length} relogio(s) e ${term.filter(t => us.has(t.unidade_id)).length} terminal(is)`)
}
console.log()

// --- 3. pendencias de cadastro --------------------------------------------
console.log('=== 3. PENDENCIAS DE CADASTRO (RPCs) ===')
const docs = await rpc('fn_documentos_invalidos')
const dups = await rpc('fn_possiveis_duplicidades_servidor')
const cads = await rpc('fn_cadastros_duplicados')
console.log(`  fn_documentos_invalidos      -> ${docs.erro || `${docs.dados.length} linha(s)`}`)
if (docs.dados) {
  const porTab = {}
  for (const d of docs.dados) porTab[`${d.tabela}.${d.campo}`] = (porTab[`${d.tabela}.${d.campo}`] || 0) + 1
  console.log(`     por campo: ${JSON.stringify(porTab)}`)
}
console.log(`  fn_possiveis_duplicidades    -> ${dups.erro || `${dups.dados.length} grupo(s)`}`)
console.log(`  fn_cadastros_duplicados      -> ${cads.erro || `${cads.dados.length} grupo(s)`}`)
if (dups.dados?.length) console.log(`     chaves do grupo: ${Object.keys(dups.dados[0]).join(', ')}`)
if (cads.dados?.length) console.log(`     chaves do grupo: ${Object.keys(cads.dados[0]).join(', ')}`)
console.log()

// --- 4. duplicidade atravessa unidade? ------------------------------------
console.log('=== 4. GRUPOS QUE ATRAVESSAM UNIDADE ===')
function unidadesDoGrupo(g) {
  const s = new Set()
  for (const k of ['servidores', 'cadastros', 'membros', 'itens']) {
    if (Array.isArray(g[k])) for (const m of g[k]) { if (m.unidade_nome) s.add(m.unidade_nome); else if (m.unidade_id) s.add(m.unidade_id) }
  }
  return s
}
for (const [nome, res] of [['possiveis_duplicidades', dups], ['cadastros_duplicados', cads]]) {
  if (!res.dados?.length) { console.log(`  ${nome}: sem dados`); continue }
  let multi = 0, uni = 0, indef = 0
  for (const g of res.dados) {
    const s = unidadesDoGrupo(g)
    if (s.size === 0) indef++
    else if (s.size > 1) multi++
    else uni++
  }
  console.log(`  ${nome}: ${multi} atravessam unidade | ${uni} numa unidade so | ${indef} indeterminado (estrutura nao reconhecida)`)
  if (indef === res.dados.length) console.log(`     AMOSTRA: ${JSON.stringify(res.dados[0]).slice(0, 500)}`)
}
console.log()

// --- 5. servidores sem CPF / sem PIS --------------------------------------
console.log('=== 5. SERVIDORES ===')
const semCpf = await get('servidores?select=id,nome,matricula,status,unidade_id&cpf=is.null&order=nome')
const porUnid = {}
for (const s of semCpf) { const n = nomeUnid.get(s.unidade_id) || '(sem unidade)'; porUnid[n] = (porUnid[n] || 0) + 1 }
console.log(`  sem CPF: ${semCpf.length} -> ${JSON.stringify(porUnid)}`)
