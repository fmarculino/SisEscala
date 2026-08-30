// Conferencia por fora da migration 20260830130000 (item 10).
//
// SEGURO: todas as chamadas usam um `fila_id` INEXISTENTE. As duas funcoes fazem
// `SELECT ... WHERE id = p_fila_id AND status = 'pendente'` e, nao achando, dao RETURN sem
// escrever nada (o caminho idempotente que existe para reenvio). Nenhuma fila real e tocada.
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const U = env.NEXT_PUBLIC_SUPABASE_URL
const SR = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
const AN = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }

const ZERO = '00000000-0000-0000-0000-000000000000'
// As duas funcoes sao RETURNS void, entao o PostgREST responde 204 No Content — nao 200.
// Tratar 204 como falha foi um erro do teste na primeira execucao, nao da migration.
const sucesso = (st) => st === 200 || st === 204

const chamar = async (h, fn, args) => {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(args) })
  return { status: r.status, corpo: (await r.text()).slice(0, 130) }
}

const casos = []
const caso = (nome, ok, detalhe) => casos.push({ nome, ok, detalhe })

console.log('Conferindo 20260830130000 em', U, '\n')

// ── 1) A assinatura NOVA existe e aceita p_dispositivo_id
for (const [fn, args] of [
  ['fn_confirmar_cadastro_rep', { p_fila_id: ZERO, p_sucesso: true, p_dispositivo_id: ZERO }],
  ['fn_confirmar_remocao_usuario_dispositivo', { p_fila_id: ZERO, p_sucesso: true, p_dispositivo_id: ZERO }],
]) {
  const r = await chamar(SR, fn, args)
  console.log(`  service_role COM p_dispositivo_id  ${fn.padEnd(42)} HTTP ${r.status}  ${r.corpo}`)
  caso(`${fn}: assinatura nova aceita p_dispositivo_id`, sucesso(r.status), r.corpo)
  // PGRST203 = duas sobrecargas vivas; e o modo de falha que derrubaria o coletor
  caso(`${fn}: sem ambiguidade de sobrecarga (PGRST203)`, !r.corpo.includes('PGRST203'), r.corpo)
}

// ── 2) Compatibilidade: chamador ANTIGO (sem o parametro) continua funcionando.
//    E o que garante que a ordem migration/deploy nao importa.
for (const [fn, args] of [
  ['fn_confirmar_cadastro_rep', { p_fila_id: ZERO, p_sucesso: true }],
  ['fn_confirmar_remocao_usuario_dispositivo', { p_fila_id: ZERO, p_sucesso: true }],
]) {
  const r = await chamar(SR, fn, args)
  console.log(`  service_role SEM p_dispositivo_id  ${fn.padEnd(42)} HTTP ${r.status}  ${r.corpo}`)
  caso(`${fn}: chamador antigo (DEFAULT NULL) segue funcionando`, sucesso(r.status), r.corpo)
}

// ── 3) O outro sentido da armadilha 24: assinatura nova nasce aberta a PUBLIC.
console.log('')
for (const fn of ['fn_confirmar_cadastro_rep', 'fn_confirmar_remocao_usuario_dispositivo']) {
  const r = await chamar(AN, fn, { p_fila_id: ZERO, p_sucesso: true })
  console.log(`  anon                               ${fn.padEnd(42)} HTTP ${r.status}  ${r.corpo}`)
  caso(`${fn}: NAO executavel por anon`, !sucesso(r.status), r.corpo)
}

// ── 4) Some do OpenAPI que a chave anon enxerga
const spec = await (await fetch(`${U}/rest/v1/`, { headers: AN })).json()
const rpcs = new Set(Object.keys(spec.paths || {}).filter(p => p.startsWith('/rpc/')).map(p => p.slice(5)))
console.log(`\n  RPCs visiveis a anon: ${rpcs.size}`)
for (const fn of ['fn_confirmar_cadastro_rep', 'fn_confirmar_remocao_usuario_dispositivo']) {
  caso(`${fn}: fora do OpenAPI de anon`, !rpcs.has(fn), rpcs.has(fn) ? 'AINDA LISTADA' : '')
}

console.log('')
let falhas = 0
for (const c of casos) {
  console.log(`  ${c.ok ? 'ok   ' : 'FALHA'}  ${c.nome}${c.ok ? '' : '   [' + c.detalhe + ']'}`)
  if (!c.ok) falhas++
}
console.log(`\n${casos.length - falhas}/${casos.length} conferencias passaram`)
process.exit(falhas ? 1 : 0)
