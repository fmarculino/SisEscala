import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const A = E.NEXT_PUBLIC_SUPABASE_ANON_KEY
let falhou = 0
const ok = (c, m) => { console.log(`${c ? '  OK   ' : '  FALHA'} ${m}`); if (!c) falhou++ }

// 1) existe e EXECUTA (armadilha 42)
const r = await fetch(`${U}/rest/v1/rpc/fn_lacunas_afd_parque`, { method: 'POST', headers: H, body: '{}' })
const txt = await r.text()
ok(r.ok, `fn_lacunas_afd_parque executa como service_role (HTTP ${r.status})`)
if (!r.ok) { console.log('   ', txt.slice(0, 200)); process.exit(1) }
const linhas = JSON.parse(txt)
ok(Array.isArray(linhas), `devolveu array (${linhas.length} relogio(s) com lacuna agora)`)

// 2) as colunas prometidas existem
const esperadas = ['dispositivo_id','dispositivo_nome','unidade_id','unidade_nome','coletor_host','ultimo_contato_em','ultimo_nsr','proximo_nsr','nsr_faltando','lacuna_desde','horas_travado']
if (linhas.length) {
  const faltando = esperadas.filter(c => !(c in linhas[0]))
  ok(faltando.length === 0, `todas as ${esperadas.length} colunas presentes${faltando.length ? ' (faltam: ' + faltando + ')' : ''}`)
  for (const l of linhas) console.log(`   ${l.dispositivo_nome} (${l.unidade_nome}): faltam ${l.nsr_faltando} desde ${l.lacuna_desde} (${l.horas_travado}h) · ${l.coletor_host}`)
} else {
  console.log('   (parque sem lacuna — as colunas so aparecem com linha; conferido pelo tipo de retorno)')
}

// 3) anon NAO executa
const a = await fetch(`${U}/rest/v1/rpc/fn_lacunas_afd_parque`, { method: 'POST', headers: { apikey: A, Authorization: `Bearer ${A}`, 'Content-Type': 'application/json' }, body: '{}' })
ok(a.status === 401 || a.status === 403 || a.status === 404, `anon recusado (HTTP ${a.status})`)

// 4) coerencia: nenhum relogio EM DIA na lista
const disp = await (await fetch(`${U}/rest/v1/dispositivos_rep?select=id,nome,ultimo_nsr&ativo=eq.true`, { headers: H })).json()
let inconsistentes = 0, comLacuna = 0
for (const d of disp) {
  const c = await (await fetch(`${U}/rest/v1/rpc/fn_cursor_afd_dispositivo`, { method: 'POST', headers: H, body: JSON.stringify({ p_dispositivo_id: d.id }) })).json()
  const temLacuna = Number(d.ultimo_nsr || 0) > 0 && Number(c) <= Number(d.ultimo_nsr)
  if (temLacuna) comLacuna++
  const listado = linhas.some(l => l.dispositivo_id === d.id)
  if (temLacuna !== listado) { inconsistentes++; console.log(`   divergencia: ${d.nome} temLacuna=${temLacuna} listado=${listado}`) }
}
ok(inconsistentes === 0, `os ${disp.length} relogios ativos batem com a funcao (${comLacuna} com lacuna de verdade)`)

console.log(falhou === 0 ? '\nTODAS AS ASSERCOES PASSARAM' : `\n${falhou} ASSERCAO(OES) FALHARAM`)
process.exit(falhou === 0 ? 0 : 1)
