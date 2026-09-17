// Confere em PRODUCAO as quatro migrations de 17/09/2026. So LEITURA e chamadas puras:
// nao escreve tratamento, nao reconcilia, nao toca em escala_diaria.
// Sai com codigo 1 se qualquer asercao falhar.
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l && !l.startsWith('#') && l.includes('='))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

let ok = 0; const falhas = []
const asserta = (nome, real, esp) => {
  if (JSON.stringify(real) === JSON.stringify(esp)) { ok++; console.log(`  OK   ${nome}`) }
  else { falhas.push(`${nome}: esperado ${JSON.stringify(esp)}, obtido ${JSON.stringify(real)}`); console.log(`  XX   ${nome}  -> ${JSON.stringify(real)}`) }
}
const rpc = async (n, b, key = K) => {
  const r = await fetch(`${U}/rest/v1/rpc/${n}`, { method:'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type':'application/json' },
    body: JSON.stringify(b) })
  return [r.status, await r.json().catch(() => null)]
}
const q = async (p) => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); return r.json() }

console.log('\n== 1. fn_pode_corrigir_batida_real (a matriz) ==')
for (const [papel, acao, esp] of [
  ['rh','rearranjar',true], ['rh_unidade','rearranjar',true],
  ['admin','rearranjar',true], ['super_admin','rearranjar',true],
  ['coordenador','rearranjar',false], ['ass_adm','rearranjar',false],
  ['rh','digitar_sobre_real',false], ['rh_unidade','digitar_sobre_real',false],
  ['super_admin','digitar_sobre_real',true], ['admin','digitar_sobre_real',true],
  ['coordenador','preencher_vazio',true], ['ass_adm','preencher_vazio',true],
  ['servidor','preencher_vazio',false], ['inventado','rearranjar',false],
]) {
  const [st, v] = await rpc('fn_pode_corrigir_batida_real', { p_acao: acao, p_role: papel })
  asserta(`${papel} / ${acao}`, st === 200 ? v : `HTTP ${st}`, esp)
}

console.log('\n== 2. fn_marcacao_desconsiderada responde ==')
const umaMarc = await q('marcacoes_ponto?select=id&limit=1')
const [stD, vD] = await rpc('fn_marcacao_desconsiderada', { p_marcacao_id: umaMarc[0].id })
asserta('responde boolean', stD === 200 && typeof vD === 'boolean', true)

console.log('\n== 3. created_at passou a clock_timestamp() ==')
// Prova indireta e sem escrever: dois tratamentos da mesma transacao teriam created_at igual
// com now(). Aqui so confirmamos que a coluna nao tem mais o default antigo, pelo efeito de
// duas linhas novas — nao da para ler o catalogo por PostgREST, entao medimos o historico.
const trat = await q('marcacoes_tratamentos?select=marcacao_id,tipo,created_at&tipo=in.(desconsiderar,restaurar)&order=created_at.desc&limit=1000')
const chaves = new Set(); let empates = 0
for (const t of trat) { const k = t.marcacao_id + '|' + t.created_at; if (chaves.has(k)) empates++; chaves.add(k) }
asserta('sem empate (marcacao, created_at) no historico recente', empates, 0)

console.log('\n== 4. nada mudou retroativamente (o corte do vincular_escala) ==')
const rc = await fetch(`${U}/rest/v1/marcacoes_tratamentos?select=id&tipo=eq.reclassificar_passo`,
  { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
const nRc = (rc.headers.get('content-range') || '').split('/')[1]
asserta('nenhum reclassificar_passo pre-existente virou fixacao', nRc, '0')
const ve = await fetch(`${U}/rest/v1/marcacoes_tratamentos?select=id&tipo=eq.vincular_escala`,
  { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
console.log(`  (vincular_escala em producao: ${(ve.headers.get('content-range')||'').split('/')[1]} — NAO honrados, de proposito)`)

console.log('\n== 5. anon nao alcanca as funcoes novas ==')
for (const [fn, body] of [
  ['fn_pode_corrigir_batida_real', { p_acao: 'rearranjar', p_role: 'super_admin' }],
  ['fn_marcacao_desconsiderada', { p_marcacao_id: umaMarc[0].id }],
  ['fn_corrigir_passos_com_batidas', { p_servidor_id: '00000000-0000-0000-0000-000000000000',
    p_data: '2026-09-12', p_atribuicoes: [], p_desconsiderar: [], p_justificativa: 'sonda de conferencia' }],
]) {
  const [st] = await rpc(fn, body, ANON)
  asserta(`anon recusado em ${fn} (HTTP ${st})`, st === 401 || st === 403, true)
}

console.log('\n== 6. fn_corrigir_passos_com_batidas existe e recusa sessao de maquina ==')
const [stC, vC] = await rpc('fn_corrigir_passos_com_batidas', {
  p_servidor_id: '00000000-0000-0000-0000-000000000000', p_data: '2026-09-12',
  p_atribuicoes: [], p_desconsiderar: [], p_justificativa: 'sonda de conferencia' })
asserta('service_role sem auth.uid() e recusada', stC >= 400 && /Sessao nao identificada|insufficient/i.test(JSON.stringify(vC)), true)

console.log('\n== 7. o caso EUZILENE continua como estava (nada foi corrigido ainda) ==')
const linha = await q('escala_diaria?select=id,categoria,presenca_saida_em,presenca_saida_marcacao_id&id=eq.ed158fe2-309b-46b7-bad7-1a4de0750bb1')
asserta('plantao MT 12/09 ainda com a batida das 18:21',
  linha[0]?.presenca_saida_marcacao_id, '78cdf9ff-a0e2-4da2-a9bd-b145e718a93a')

console.log(`\n${ok} asercoes OK, ${falhas.length} falha(s)`)
if (falhas.length) { falhas.forEach(f => console.error('  REPROVADO: ' + f)); process.exit(1) }
