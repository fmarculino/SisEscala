// Confere em PRODUCAO que 20260916110000 esta aplicada e que NADA mudou de valor.
//
// EXECUTA as funcoes (CLAUDE.md armadilha 42) — conferir que existem nao serve.
// Sai com codigo 1 se qualquer assercao falhar.
//
// Uso: node scratchpad/ver_regime_apuracao_producao.mjs
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
function t(nome, cond, extra) {
  if (cond) { ok++; console.log(`  ok   ${nome}`); return }
  falhas++; console.error(`  FALHA ${nome}${extra !== undefined ? ' -> ' + extra : ''}`)
}
const rpc = async (fn, body, headers = HJ) => {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: r.status, data: await r.json().catch(() => null) }
}
const get = async q => {
  const r = await fetch(`${U}/rest/v1/${q}`, { headers: H })
  return { status: r.status, data: await r.json().catch(() => null) }
}

console.log('=== 1. as tabelas existem ===')
for (const tb of ['folha_regimes', 'folha_regime_vigencias', 'folha_regime_vigencias_historico']) {
  const r = await get(`${tb}?select=*&limit=1`)
  t(`${tb} acessivel`, r.status === 200, `HTTP ${r.status}`)
}

console.log('\n=== 2. o seed dos regimes ===')
const regs = (await get('folha_regimes?select=id,nome,dia_corte,padrao,ativo&order=padrao.desc')).data
t('2 regimes cadastrados', Array.isArray(regs) && regs.length === 2, JSON.stringify(regs?.length))
const civil = (regs || []).find(r => r.dia_corte === null)
const c20 = (regs || []).find(r => r.dia_corte === 20)
t('Mes civil existe e e o padrao', !!civil && civil.padrao === true, JSON.stringify(civil))
t('corte 20 existe e NAO e padrao', !!c20 && c20.padrao === false, JSON.stringify(c20))
for (const r of regs || []) console.log(`       ${r.nome} | corte ${r.dia_corte ?? '(ultimo dia)'} | padrao ${r.padrao}`)

if (!civil || !c20) { console.error('\nSem o seed nao da para seguir.'); process.exit(1) }

console.log('\n=== 3. a janela (EXECUTANDO fn_periodo_apuracao) ===')
const casos = [
  [c20.id, 9, 2026, '2026-08-21', '2026-09-20', 'o caso que motivou'],
  [c20.id, 1, 2026, '2025-12-21', '2026-01-20', 'virada de ano'],
  [c20.id, 3, 2026, '2026-02-21', '2026-03-20', 'marco (fevereiro atras)'],
  [civil.id, 9, 2026, '2026-09-01', '2026-09-30', 'mes civil'],
  [civil.id, 2, 2026, '2026-02-01', '2026-02-28', 'mes civil fevereiro'],
  [civil.id, 2, 2028, '2028-02-01', '2028-02-29', 'mes civil bissexto'],
]
for (const [id, mes, ano, ini, fim, rotulo] of casos) {
  const { status, data } = await rpc('fn_periodo_apuracao', { p_regime_id: id, p_mes: mes, p_ano: ano })
  const linha = Array.isArray(data) ? data[0] : data
  t(`${rotulo}: ${String(mes).padStart(2, '0')}/${ano} = ${ini} a ${fim}`,
    status === 200 && linha?.inicio === ini && linha?.fim === fim,
    `HTTP ${status} ${JSON.stringify(linha)}`)
}

console.log('\n=== 4. contiguidade dos periodos (12 meses, corte 20) ===')
let contiguos = true, detalhe = ''
let fimAnterior = null
for (let mes = 1; mes <= 12; mes++) {
  const { data } = await rpc('fn_periodo_apuracao', { p_regime_id: c20.id, p_mes: mes, p_ano: 2026 })
  const l = Array.isArray(data) ? data[0] : data
  if (fimAnterior) {
    const d = new Date(fimAnterior + 'T12:00:00')
    d.setDate(d.getDate() + 1)
    const esperado = d.toISOString().slice(0, 10)
    if (l.inicio !== esperado) { contiguos = false; detalhe = `${mes}/2026 comeca ${l.inicio}, esperado ${esperado}` }
  }
  fimAnterior = l.fim
}
t('nenhum dia cai em dois periodos nem em nenhum', contiguos, detalhe)

console.log('\n=== 5. NADA mudou: ninguem foi atribuido, todos no mes civil ===')
const vigs = (await get('folha_regime_vigencias?select=id,servidor_id,regime_id,vigencia_inicio,vigencia_fim')).data
t('0 vigencias gravadas', Array.isArray(vigs) && vigs.length === 0, `${vigs?.length} linha(s)`)

const MM = 'a465e8bd-c455-440b-840b-b94483a13d2a'
const srv = (await get(`servidores?select=id,matricula&setor_id=eq.${MM}&order=matricula`)).data
for (const s of srv || []) {
  const { status, data } = await rpc('fn_periodo_apuracao_servidor', {
    p_servidor_id: s.id, p_mes: 9, p_ano: 2026
  })
  const l = Array.isArray(data) ? data[0] : data
  t(`${s.matricula} continua no mes civil (01/09 a 30/09)`,
    status === 200 && l?.inicio === '2026-09-01' && l?.fim === '2026-09-30'
      && l?.regime_id === civil.id && l?.atravessa_mes === false,
    `HTTP ${status} ${JSON.stringify(l)}`)
}

// Uma amostra fora do Mais Medicos: a rede inteira tem de continuar igual.
const amostra = (await get('servidores?select=id,matricula&status=eq.Ativo&limit=5&order=matricula')).data
let redeOk = true, redeDetalhe = ''
for (const s of amostra || []) {
  const { data } = await rpc('fn_regime_apuracao_servidor', { p_servidor_id: s.id, p_data: '2026-09-16' })
  if (data !== civil.id) { redeOk = false; redeDetalhe = `${s.matricula} -> ${data}` }
}
t('amostra de 5 servidores da rede: todos no mes civil', redeOk, redeDetalhe)

console.log('\n=== 6. anon NAO executa nenhuma das cinco (armadilha 24) ===')
const HANON = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }
const fechadas = [
  ['fn_periodo_apuracao', { p_regime_id: c20.id, p_mes: 9, p_ano: 2026 }],
  ['fn_regime_apuracao_servidor', { p_servidor_id: srv?.[0]?.id || null }],
  ['fn_periodo_apuracao_servidor', { p_servidor_id: srv?.[0]?.id || null, p_mes: 9, p_ano: 2026 }],
  ['fn_atribuir_regime_apuracao', { p_servidor_id: null, p_regime_id: c20.id, p_vigencia_inicio: null, p_motivo: 'sonda anon' }],
  ['fn_encerrar_regime_apuracao', { p_vigencia_id: '00000000-0000-0000-0000-000000000000', p_motivo: 'sonda anon' }],
]
for (const [fn, body] of fechadas) {
  const { status } = await rpc(fn, body, HANON)
  t(`anon recusado em ${fn}`, status === 401 || status === 403 || status === 404, `HTTP ${status}`)
}

console.log('\n=== 7. o outro sentido: authenticated ainda alcanca a leitura ===')
// Nao ha JWT de coordenador aqui; o que se pode conferir por fora e que as funcoes de LEITURA
// respondem com service_role e que as de ESCRITA recusam sem papel — que e o comportamento certo:
// quem decide o regime tem de estar logado (a tela usa createClient, nunca admin).
const semPapel = await rpc('fn_atribuir_regime_apuracao', {
  p_servidor_id: null, p_regime_id: c20.id, p_vigencia_inicio: null, p_motivo: 'sonda service_role'
})
t('service_role NAO consegue atribuir regime global (exige papel)',
  semPapel.status >= 400, `HTTP ${semPapel.status} ${JSON.stringify(semPapel.data)?.slice(0, 160)}`)

const vigsDepois = (await get('folha_regime_vigencias?select=id')).data
t('a sonda nao deixou lixo gravado', Array.isArray(vigsDepois) && vigsDepois.length === 0,
  `${vigsDepois?.length} linha(s)`)

console.log(`\n${falhas === 0 ? 'OK' : 'REPROVADO'}: ${ok} assercoes passaram, ${falhas} falharam.`)
process.exit(falhas === 0 ? 0 : 1)
