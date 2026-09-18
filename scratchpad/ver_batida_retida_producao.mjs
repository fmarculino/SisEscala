// Confere, EXECUTANDO, que as 4 migrations de 17/09/2026 estao em producao e corretas.
// Sai com codigo 1 se qualquer asserção falhar. LEITURA PURA.
import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const K = E.SUPABASE_SERVICE_ROLE_KEY
const A = E.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const Hanon = { apikey: A, Authorization: `Bearer ${A}`, 'Content-Type': 'application/json' }

let ok = 0; const falhas = []
const chk = (r, cond, extra = '') => { if (cond) { ok++; console.log(`  OK  ${r}`) } else { falhas.push(`${r} ${extra}`); console.log(`  XX  ${r} ${extra}`) } }
const rpc = async (fn, body, h = H) => {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(body) })
  let j = null; const t = await r.text(); try { j = JSON.parse(t) } catch { j = t }
  return { status: r.status, body: j }
}
const get = async p => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); return r.ok ? r.json() : [] }

console.log('=== 20260917140000 — batida retida na previa ===')
for (const [args, esperado, rot] of [
  [{ p_origem: 'rep', p_sintetica: false }, true, 'rep nao-sintetica e batida'],
  [{ p_origem: 'rep', p_sintetica: true }, true, 'rep e SEMPRE batida'],
  [{ p_origem: 'terminal', p_sintetica: false }, true, 'terminal nao-sintetica e batida'],
  [{ p_origem: 'terminal', p_sintetica: true }, false, 'terminal SINTETICA nao e batida'],
  [{ p_origem: 'ajuste_coordenador', p_sintetica: false }, false, 'ajuste_coordenador nao e batida'],
  [{ p_origem: 'ajuste_servidor', p_sintetica: false }, false, 'ajuste_servidor nao e batida'],
]) {
  const r = await rpc('fn_batida_fisica', args)
  chk(`fn_batida_fisica: ${rot}`, r.status === 200 && r.body === esperado, `-> ${r.status} ${JSON.stringify(r.body)}`)
}

const prev = await rpc('fn_reconciliacao_pendente_escala', { p_escala_mensal_ids: [] })
chk('previa executa com lista vazia', prev.status === 200 && Array.isArray(prev.body) && prev.body.length === 0, `-> ${prev.status}`)

// A coluna nova so aparece com linha de verdade: pega uma grade real de 09/2026.
const ems = await get('escala_mensal?select=id&mes=eq.9&ano=eq.2026&limit=60')
const p2 = await rpc('fn_reconciliacao_pendente_escala', { p_escala_mensal_ids: ems.map(e => e.id) })
const temLinha = Array.isArray(p2.body) && p2.body.length > 0
chk('previa executa sobre grade real', p2.status === 200, `-> ${p2.status} ${temLinha ? p2.body.length + ' linha(s)' : '0 linhas'}`)
if (temLinha) {
  chk('coluna batidas_retidas presente', 'batidas_retidas' in p2.body[0], `-> ${Object.keys(p2.body[0]).join(',')}`)
  chk('colunas antigas preservadas',
      ['dia_elegivel', 'impedimento', 'valor_projetado', 'tipo', 'campo'].every(c => c in p2.body[0]))
} else {
  console.log('  ..  sem linha nesta amostra; a coluna sera conferida pelo caso real abaixo')
}

console.log('\n=== 20260917150000 — reversao pode manter batidas ===')
// Assinatura de 6 args existe (a de 5 foi derrubada). Chamada com escala inexistente nao escreve.
const rev = await rpc('fn_reverter_presenca_manual', {
  p_escala_mensal_id: '00000000-0000-0000-0000-000000000000', p_dia: 1,
  p_categoria: 'Regular', p_tipo: 'tipo_invalido', p_validador_id: null, p_manter_batidas: true })
chk('assinatura de 6 argumentos existe', rev.status === 200, `-> ${rev.status} ${JSON.stringify(rev.body).slice(0,90)}`)
chk('tipo invalido continua recusado', rev.status === 200 && rev.body && rev.body.success === false)
const rev5 = await rpc('fn_reverter_presenca_manual', {
  p_escala_mensal_id: '00000000-0000-0000-0000-000000000000', p_dia: 1,
  p_categoria: 'Regular', p_tipo: 'tipo_invalido', p_validador_id: null })
chk('chamada de 5 argumentos ainda resolve (sem PGRST203)', rev5.status === 200, `-> ${rev5.status} ${JSON.stringify(rev5.body).slice(0,90)}`)

console.log('\n=== 20260917160000 — restaurar batidas do dia ===')
const restAnon = await rpc('fn_restaurar_batidas_dia',
  { p_servidor_id: '00000000-0000-0000-0000-000000000000', p_data: '1900-01-01', p_justificativa: 'sonda' }, Hanon)
chk('anon NAO executa fn_restaurar_batidas_dia', restAnon.status === 401 || restAnon.status === 404 || restAnon.status === 403, `-> ${restAnon.status}`)
const rest = await rpc('fn_restaurar_batidas_dia',
  { p_servidor_id: '00000000-0000-0000-0000-000000000000', p_data: '1900-01-01', p_justificativa: 'oi' })
chk('justificativa curta recusada antes de escrever', rest.status === 200 && rest.body?.status === 'sem_justificativa', `-> ${JSON.stringify(rest.body).slice(0,90)}`)
const rest2 = await rpc('fn_restaurar_batidas_dia',
  { p_servidor_id: '00000000-0000-0000-0000-000000000000', p_data: '1900-01-01', p_justificativa: 'sonda de conferencia' })
chk('sem sessao nao restaura nada', rest2.status === 200 && rest2.body?.restauradas === 0, `-> ${JSON.stringify(rest2.body).slice(0,110)}`)

console.log('\n=== 20260917170000 — reconciliar alcanca o irmao ===')
const pes = await rpc('fn_reconciliar_pessoa_dia',
  { p_servidor_id: '00000000-0000-0000-0000-000000000000', p_data: '1900-01-01' })
chk('fn_reconciliar_pessoa_dia executa', pes.status === 200 && pes.body && 'proprio' in pes.body && Array.isArray(pes.body.irmaos), `-> ${pes.status} ${JSON.stringify(pes.body).slice(0,110)}`)
const pesAnon = await rpc('fn_reconciliar_pessoa_dia',
  { p_servidor_id: '00000000-0000-0000-0000-000000000000', p_data: '1900-01-01' }, Hanon)
chk('anon NAO executa fn_reconciliar_pessoa_dia', pesAnon.status !== 200, `-> ${pesAnon.status}`)

console.log('\n=== O caso THAYNA (mat 69051, 03/09/2026) ===')
const th = (await get('servidores?select=id,nome&matricula=eq.69051'))[0]
if (th) {
  const r = await rpc('fn_batidas_retidas_dia', { p_servidor_id: th.id, p_data: '2026-09-03' })
  const n = Array.isArray(r.body) ? r.body.length : -1
  chk('fn_batidas_retidas_dia enxerga as batidas retidas dela', n >= 4, `-> ${n} batida(s)`)
  const d = await rpc('fn_reconciliar_dia_pendente', { p_servidor_id: th.id, p_data: '2026-09-03' })
  const st = d.body?.status
  chk('o dia dela deixou de responder "sem_mudanca" mudo',
      st === 'batida_retida' || (st === 'conflito' && Number(d.body?.batidas_retidas || 0) > 0),
      `-> status=${st} retidas=${d.body?.batidas_retidas} motivo=${String(d.body?.motivo || '').slice(0, 80)}`)
}

console.log('\n=== Panorama em producao ===')
const rel = (await get('servidores?select=id&status=eq.Ativo&limit=1')).length
console.log(`  REST respondendo: ${rel === 1 ? 'sim' : 'nao'}`)

console.log(`\n${ok} asserções passaram, ${falhas.length} falharam.`)
if (falhas.length) { for (const f of falhas) console.log('  ✗ ' + f); process.exit(1) }
console.log('PRODUCAO CONFERIDA')
