// Quantos grupos de duplicidade atravessam unidade? Decide se o RH da Unidade pode ver o grupo
// inteiro ou so' a parte dele. SO LEITURA.
import { env } from './_env.mjs'
const E = env(process.argv[2] || '.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const rpc = async (fn, b = {}) => (await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(b) })).json()

const dups = await rpc('fn_possiveis_duplicidades_servidor')
const cads = await rpc('fn_cadastros_duplicados')

function analisar(nome, grupos, campoMembros) {
  let multi = 0, uni = 0
  const exemplos = []
  const unidadesEnvolvidas = new Map()
  for (const g of grupos) {
    const us = [...new Set((g[campoMembros] || []).map(m => m.unidade || '(sem unidade)'))]
    if (us.length > 1) { multi++; if (exemplos.length < 6) exemplos.push({ chave: g.chave || g.cpf, criterio: g.criterio || 'cpf', us }) }
    else uni++
    for (const u of us) unidadesEnvolvidas.set(u, (unidadesEnvolvidas.get(u) || 0) + 1)
  }
  console.log(`=== ${nome}: ${grupos.length} grupos ===`)
  console.log(`  atravessam unidade: ${multi}   |   numa unidade so: ${uni}`)
  for (const e of exemplos) console.log(`    ex ${e.criterio} ${e.chave}: ${e.us.join('  x  ')}`)
  const top = [...unidadesEnvolvidas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`  unidades mais presentes: ${top.map(([u, n]) => `${u.slice(0, 34)}=${n}`).join(' | ')}`)
  return { multi, uni }
}

const a = analisar('fn_possiveis_duplicidades_servidor', dups, 'servidores')
const b = analisar('fn_cadastros_duplicados (mesclaveis)', cads, 'cadastros')

// Quanto cada RH da Unidade veria, por criterio "grupo tem ao menos um membro na minha unidade"
const perfis = await (await fetch(`${U}/rest/v1/profiles?select=full_name,role,profile_unidades(unidade_id)&role=eq.rh_unidade`, { headers: H })).json()
const unidades = await (await fetch(`${U}/rest/v1/unidades?select=id,nome`, { headers: H })).json()
const nomeUnid = new Map(unidades.map(u => [u.id, u.nome]))
const porUnidade = new Map()
for (const p of perfis) for (const pu of p.profile_unidades || []) porUnidade.set(nomeUnid.get(pu.unidade_id), true)

console.log('\n=== ALCANCE POR UNIDADE DE RH_UNIDADE ===')
for (const un of porUnidade.keys()) {
  const d1 = dups.filter(g => (g.servidores || []).some(m => m.unidade === un))
  const d1cruza = d1.filter(g => new Set((g.servidores || []).map(m => m.unidade)).size > 1)
  const c1 = cads.filter(g => (g.cadastros || []).some(m => m.unidade === un))
  const c1cruza = c1.filter(g => new Set((g.cadastros || []).map(m => m.unidade)).size > 1)
  console.log(`  ${un}`)
  console.log(`     possiveis duplicidades: ${d1.length} grupos (${d1cruza.length} com membro de OUTRA unidade)`)
  console.log(`     mesclaveis:             ${c1.length} grupos (${c1cruza.length} com membro de OUTRA unidade)`)
}

// Peso dos mesclaveis: quantos ja tem ponto/escala/folha
let comPeso = 0
for (const g of cads) if ((g.cadastros || []).some(m => (m.batidas || 0) > 0 || (m.escalas || 0) > 0 || (m.folhas || 0) > 0)) comPeso++
console.log(`\n  mesclaveis com ponto/escala/folha em algum lado: ${comPeso} de ${cads.length}`)
