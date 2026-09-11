// Confere em PRODUCAO as tres migrations de 11/09/2026 (escopo de gestao para o RH).
//
// EXECUTA as funcoes par a par em vez de so perguntar se elas existem (armadilha 42), e confere
// os DOIS sentidos: o que passou a ser permitido E o que continua recusado. Sai com codigo 1 se
// qualquer assercao falhar.
//
// SO LEITURA. Nao chama nada que escreva: sem gerar token (invalidaria coletor em campo), sem
// mesclar, sem conceder autorizacao.
//
//   node scratchpad/ver_escopo_rh_producao.mjs [.env.production]
import { env } from './_env.mjs'

const E = env(process.argv[2] || '.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const K = E.SUPABASE_SERVICE_ROLE_KEY
const ANON = E.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

console.log(`banco: ${U}\n`)

let falhas = 0
function exigir(cond, rotulo, detalhe = '') {
  if (cond) console.log(`  ok    ${rotulo}${detalhe ? ` — ${detalhe}` : ''}`)
  else { console.error(`  FALHA ${rotulo}${detalhe ? ` — ${detalhe}` : ''}`); falhas++ }
}

const get = async (p) => {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: H })
  if (!r.ok) throw new Error(`${p} -> ${r.status} ${await r.text()}`)
  return r.json()
}
const rpc = async (fn, body = {}, key = K) => {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, corpo: await r.text() }
}

// --- 1. as funcoes novas existem e respondem --------------------------------
console.log('=== 1. funcoes novas ===')
const pred = await rpc('fn_escopo_gestao_alcanca', { p_unidade_id: null })
exigir(pred.status === 200, 'fn_escopo_gestao_alcanca existe e executa', `HTTP ${pred.status}`)
// service_role tem auth.uid() nulo, entao o predicado passa direto (por construcao).
exigir(pred.corpo.trim() === 'true', 'service_role passa pelo predicado (auth.uid() nulo)', pred.corpo.trim())

const conj = await rpc('fn_unidades_de_gestao', {})
exigir(conj.status === 200, 'fn_unidades_de_gestao existe e executa', `HTTP ${conj.status}`)
const unidades = await get('unidades?select=id')
const doConjunto = JSON.parse(conj.corpo)
exigir(
  doConjunto.length === unidades.length,
  'o conjunto derivado devolve TODAS as unidades para service_role',
  `${doConjunto.length} de ${unidades.length}`,
)

// --- 2. anon continua fora (armadilha 24) ----------------------------------
console.log('\n=== 2. anon continua fora ===')
const FECHADAS = [
  ['fn_escopo_gestao_alcanca', { p_unidade_id: null }],
  ['fn_unidades_de_gestao', {}],
  // 🚨 Esta estava ABERTA ao anon ate 11/09/2026 e devolvia HTTP 200 com a chave publica.
  ['fn_documentos_invalidos', {}],
  ['fn_possiveis_duplicidades_servidor', {}],
  ['fn_cadastros_duplicados', {}],
  ['fn_higiene_usuarios_dispositivo', { p_dispositivo_id: '00000000-0000-0000-0000-000000000000' }],
  ['fn_gerar_token_dispositivo_rep', { p_dispositivo_id: '00000000-0000-0000-0000-000000000000' }],
]
for (const [fn, body] of FECHADAS) {
  const r = await rpc(fn, body, ANON)
  exigir(r.status === 401 || r.status === 403, `${fn} recusa anon`, `HTTP ${r.status}`)
}

// --- 3. o predicado responde por PAPEL, com sessao simulada ----------------
// Nao da para logar como outro usuario pelo PostgREST, entao o teste de papel foi feito no
// ensaio em homologacao (8 de 8 / 6 de 6 / 8 de 8). Aqui o que se prova e o EFEITO em producao:
// as funcoes escopadas devolvem o parque inteiro para service_role e nao quebraram.
console.log('\n=== 3. efeito nas funcoes de tela (como service_role) ===')
const dup = await rpc('fn_possiveis_duplicidades_servidor', {})
const cad = await rpc('fn_cadastros_duplicados', {})
const doc = await rpc('fn_documentos_invalidos', {})
exigir(dup.status === 200, 'fn_possiveis_duplicidades_servidor executa', `HTTP ${dup.status}`)
exigir(cad.status === 200, 'fn_cadastros_duplicados executa', `HTTP ${cad.status}`)
exigir(doc.status === 200, 'fn_documentos_invalidos executa', `HTTP ${doc.status}`)

const nDup = dup.status === 200 ? JSON.parse(dup.corpo).length : -1
const nCad = cad.status === 200 ? JSON.parse(cad.corpo).length : -1
const nDoc = doc.status === 200 ? JSON.parse(doc.corpo).length : -1
console.log(`        duplicidades=${nDup}  mesclaveis=${nCad}  documentos_invalidos=${nDoc}`)

// ⚠️ As contagens tem que bater com a medicao de 10/09/2026 (156 / 62 / 0). Divergencia grande
// para MENOS significa que o recorte vazou para o service_role; para MAIS, que o HAVING sumiu.
// Producao e viva, entao a margem e folgada — o que se pega aqui e' colapso, nao oscilacao.
exigir(nDup > 100, 'duplicidades na ordem de grandeza medida em 10/09 (156)', String(nDup))
exigir(nCad > 40, 'mesclaveis na ordem de grandeza medida em 10/09 (62)', String(nCad))

// O grupo tem que continuar vindo INTEIRO: nenhum grupo pode ter perdido membro para o recorte.
if (nCad > 0) {
  const grupos = JSON.parse(cad.corpo)
  const quebrados = grupos.filter((g) => (g.cadastros || []).length !== Number(g.quantidade))
  exigir(quebrados.length === 0, 'todo grupo vem INTEIRO (quantidade == cadastros)',
    quebrados.length ? `${quebrados.length} grupo(s) recortado(s)` : `${grupos.length} grupos`)
  const cruzados = grupos.filter((g) => new Set((g.cadastros || []).map((c) => c.unidade)).size > 1)
  exigir(cruzados.length > 0, 'grupos que atravessam unidade continuam visiveis', `${cruzados.length} de ${grupos.length}`)
}

// --- 4. o parque nao mudou de tamanho --------------------------------------
console.log('\n=== 4. parque intacto ===')
const disp = await get('dispositivos_rep?select=id,ativo,token_criado_em')
const term = await get('terminais_locais?select=id,ativo')
exigir(disp.length >= 30, 'dispositivos_rep continua com o parque inteiro', `${disp.length}`)
exigir(term.length >= 1, 'terminais_locais intacto', `${term.length}`)
// 🚨 Nenhum token pode ter sido rotacionado pela aplicacao das migrations: token novo derruba o
// coletor daquela unidade ate alguem instalar o pacote (o incidente de 26/08/2026, 2h49 fora).
const hoje = new Date().toISOString().slice(0, 10)
const rotacionadosHoje = disp.filter((d) => (d.token_criado_em || '').slice(0, 10) === hoje)
exigir(rotacionadosHoje.length === 0, 'nenhum token de relogio foi rotacionado hoje',
  rotacionadosHoje.length ? `${rotacionadosHoje.length} rotacionado(s)!` : '0')

// --- 5. perfis alcancados ---------------------------------------------------
console.log('\n=== 5. quem passa a alcancar o que ===')
const perfis = await get('profiles?select=id,full_name,role,profile_unidades(unidade_id)&role=in.(rh,rh_unidade)')
const rh = perfis.filter((p) => p.role === 'rh')
const rhU = perfis.filter((p) => p.role === 'rh_unidade')
exigir(rh.length > 0, 'existem perfis RH Geral', `${rh.length}`)
exigir(rhU.length > 0, 'existem perfis RH da Unidade', `${rhU.length}`)
for (const p of rhU) {
  const us = (p.profile_unidades || []).map((x) => x.unidade_id)
  const n = disp.filter((d) => us.includes(d.unidade_id)).length
  console.log(`        ${String(p.full_name).slice(0, 30).padEnd(30)} ${us.length} unidade(s)`)
}
const nomes = new Map((await get('unidades?select=id,nome')).map((u) => [u.id, u.nome]))
const dispComUnid = await get('dispositivos_rep?select=id,unidade_id')
for (const p of rhU) {
  const us = new Set((p.profile_unidades || []).map((x) => x.unidade_id))
  const n = dispComUnid.filter((d) => us.has(d.unidade_id)).length
  exigir(n > 0, `${String(p.full_name).slice(0, 24)} alcanca ao menos 1 relogio`, `${n}`)
}

console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
