// Confere em PRODUCAO que 20260916120000 (Fase 3) esta aplicada — EXECUTANDO as funcoes.
// Sai com codigo 1 se qualquer assercao falhar. NAO emite documento nenhum.
//
// Uso: node scratchpad/ver_apuracao_producao.mjs
import fs from 'node:fs'

const env = Object.fromEntries(fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
const HJ = { ...H, 'Content-Type': 'application/json' }

let ok = 0, falhas = 0
const t = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ok    ${nome}`) }
  else { falhas++; console.error(`  FALHA ${nome}${extra !== undefined ? ' -> ' + extra : ''}`) }
}
const rpc = async (fn, body, headers = HJ) => {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: r.status, data: await r.json().catch(() => null) }
}
const get = async q => {
  const r = await fetch(`${U}/rest/v1/${q}`, { headers: H })
  return { status: r.status, data: await r.json().catch(() => null) }
}

console.log('=== 1. a tabela existe e esta vazia (a migration nao emite nada) ===')
const ap = await get('folha_apuracoes?select=id,servidor_id,versao,fingerprint')
t('folha_apuracoes acessivel', ap.status === 200, `HTTP ${ap.status}`)
t('nenhuma apuracao emitida', Array.isArray(ap.data) && ap.data.length === 0, `${ap.data?.length} linha(s)`)

console.log('\n=== 2. fn_apuracao_conferencia EXECUTA e conta certo ===')
const MM = 'a465e8bd-c455-440b-840b-b94483a13d2a'
const srv = (await get(`servidores?select=id,matricula&setor_id=eq.${MM}&order=matricula`)).data
const alvo = srv?.[0]

if (alvo) {
  const c1 = await rpc('fn_apuracao_conferencia', {
    p_servidor_id: alvo.id, p_inicio: '2026-08-21', p_fim: '2026-09-20',
  })
  const l1 = Array.isArray(c1.data) ? c1.data[0] : c1.data
  t('21/08 a 20/09 = 31 dias', c1.status === 200 && l1?.dias_no_periodo === 31,
    `HTTP ${c1.status} ${JSON.stringify(l1)}`)
  t('dias_com_linha e um numero >= 0', typeof l1?.dias_com_linha === 'number' && l1.dias_com_linha >= 0,
    String(l1?.dias_com_linha))
  t('folhas_origem e array', Array.isArray(l1?.folhas), JSON.stringify(l1?.folhas))
  t('competencias traz as DUAS do periodo',
    Array.isArray(l1?.competencias) && l1.competencias.includes('2026-08') && l1.competencias.includes('2026-09'),
    JSON.stringify(l1?.competencias))

  const c2 = await rpc('fn_apuracao_conferencia', {
    p_servidor_id: alvo.id, p_inicio: '2026-09-01', p_fim: '2026-09-30',
  })
  const l2 = Array.isArray(c2.data) ? c2.data[0] : c2.data
  t('mes civil de setembro = 30 dias', l2?.dias_no_periodo === 30, String(l2?.dias_no_periodo))
  t('mes civil traz UMA competencia', l2?.competencias?.length === 1, JSON.stringify(l2?.competencias))

  // Fevereiro: o filtro do dia que nao existe no mes nao pode estourar.
  const c3 = await rpc('fn_apuracao_conferencia', {
    p_servidor_id: alvo.id, p_inicio: '2026-02-01', p_fim: '2026-02-28',
  })
  t('fevereiro nao estoura (dia 31 filtrado)', c3.status === 200, `HTTP ${c3.status}`)

  console.log('\n=== 3. o guard de papel: service_role NAO emite ===')
  const pode = await rpc('fn_pode_emitir_apuracao', { p_servidor_id: alvo.id })
  t('fn_pode_emitir_apuracao = false sem papel', pode.status === 200 && pode.data === false,
    `HTTP ${pode.status} ${JSON.stringify(pode.data)}`)

  const tentaEmitir = await rpc('fn_emitir_apuracao', {
    p_servidor_id: alvo.id, p_mes: 9, p_ano: 2026,
    p_registros: [{ data: '2026-09-01' }], p_totais: { normaisMinutos: 0 },
    p_dias_com_linha: 0, p_fingerprint: 'sonda',
  })
  t('emitir recusado sem papel', tentaEmitir.status >= 400,
    `HTTP ${tentaEmitir.status} ${JSON.stringify(tentaEmitir.data)?.slice(0, 140)}`)

  console.log('\n=== 4. fn_apuracoes_competencia EXECUTA ===')
  const lista = await rpc('fn_apuracoes_competencia', { p_mes: 9, p_ano: 2026, p_unidade_id: null })
  t('listagem responde 200', lista.status === 200, `HTTP ${lista.status} ${JSON.stringify(lista.data)?.slice(0, 160)}`)
  t('listagem vazia (nada emitido)', Array.isArray(lista.data) && lista.data.length === 0,
    `${lista.data?.length} linha(s)`)
}

console.log('\n=== 5. anon NAO executa nenhuma das seis (armadilha 24) ===')
const HANON = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }
const fechadas = [
  ['fn_pode_emitir_apuracao', { p_servidor_id: alvo?.id || null }],
  ['fn_apuracao_conferencia', { p_servidor_id: alvo?.id || null, p_inicio: '2026-09-01', p_fim: '2026-09-30' }],
  ['fn_emitir_apuracao', { p_servidor_id: alvo?.id || null, p_mes: 9, p_ano: 2026, p_registros: [], p_totais: {}, p_dias_com_linha: 0, p_fingerprint: 'x' }],
  ['fn_retificar_apuracao', { p_apuracao_id: '00000000-0000-0000-0000-000000000000', p_registros: [], p_totais: {}, p_dias_com_linha: 0, p_fingerprint: 'x', p_motivo: 'sonda anon 123' }],
  ['fn_revogar_apuracao', { p_apuracao_id: '00000000-0000-0000-0000-000000000000', p_motivo: 'sonda anon 123' }],
  ['fn_apuracoes_competencia', { p_mes: 9, p_ano: 2026 }],
]
for (const [fn, body] of fechadas) {
  const { status } = await rpc(fn, body, HANON)
  t(`anon recusado em ${fn}`, status === 401 || status === 403 || status === 404, `HTTP ${status}`)
}

console.log('\n=== 6. anon nao LE a tabela ===')
const rAnon = await fetch(`${U}/rest/v1/folha_apuracoes?select=id&limit=1`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
const corpo = await rAnon.json().catch(() => null)
t('anon nao le folha_apuracoes',
  rAnon.status >= 400 || (Array.isArray(corpo) && corpo.length === 0),
  `HTTP ${rAnon.status} ${JSON.stringify(corpo)?.slice(0, 120)}`)

console.log('\n=== 7. o append-only NAO e testado aqui, e o motivo importa ===')
/*
  🚨 Testar o append-only por fora exigiria INSERIR uma linha em producao — e ela nao sairia mais:
  o proprio trigger recusa DELETE, e `fn_revogar_apuracao` exige papel (que service_role nao tem).
  A sonda ficaria para sempre numa tabela de documento, indistinguivel de emissao real numa
  listagem futura. Sonda que nao se limpa nao e sonda: e lixo com aparencia de dado.

  Quem garante o append-only e a conferencia DENTRO da migration (secao 8), que aborta se o
  trigger ou a ausencia de policy de escrita nao estiverem no lugar — e ela roda na transacao da
  aplicacao, sem deixar rastro.

  Se um dia isso precisar de teste vivo, o caminho e homologacao com ensaio revertido por
  RAISE EXCEPTION, nunca producao.
*/
console.log('  --    append-only conferido pela propria migration (secao 8), que aborta se faltar.')
console.log('        Testar por fora deixaria uma linha impossivel de apagar em producao.')

console.log(`\n${falhas === 0 ? 'OK' : 'REPROVADO'}: ${ok} assercoes passaram, ${falhas} falharam.`)
process.exit(falhas === 0 ? 0 : 1)
