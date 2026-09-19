import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const A = E.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
let falhou = 0
const ok = (c, m) => { console.log(`${c ? '  OK   ' : '  FALHA'} ${m}`); if (!c) falhou++ }
const rpc = async (fn, b, hdr = H) => { const t = Date.now(); const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: hdr, body: JSON.stringify(b) }); return { ms: Date.now() - t, s: r.status, t: await r.text() } }

// ---- desempenho, que foi o que travou 5 rodadas
const SRV = '0e6b03ca-2c54-47f6-af2e-977d2787580d'
for (const [rot, ini, fim] of [['8 dias','2026-09-12','2026-09-19'], ['30 dias','2026-08-21','2026-09-19'], ['62 dias','2026-07-20','2026-09-19']]) {
  const r = await rpc('fn_auditoria_ponto_servidor', { p_servidor_id: SRV, p_inicio: ini, p_fim: fim })
  ok(r.s === 200 && r.ms < 3000, `${rot}: HTTP ${r.s} em ${r.ms}ms (era 5243ms em 8 dias)`)
}

// ---- o teto de 62 dias recusa
const teto = await rpc('fn_auditoria_ponto_servidor', { p_servidor_id: SRV, p_inicio: '2026-01-01', p_fim: '2026-12-31' })
ok(teto.s !== 200 && teto.t.includes('62'), `periodo de 1 ano recusado (HTTP ${teto.s})`)

// ---- anon nao executa
const an = await rpc('fn_auditoria_ponto_servidor', { p_servidor_id: SRV, p_inicio: '2026-09-18', p_fim: '2026-09-19' },
  { apikey: A, Authorization: `Bearer ${A}`, 'Content-Type': 'application/json' })
ok(an.s === 401 || an.s === 403 || an.s === 404, `anon recusado (HTTP ${an.s})`)

// ---- CASO REAL 1: THAYNA, 03/09/2026 — batidas retidas por reversao (v2.73.0)
const th = await (await fetch(`${U}/rest/v1/servidores?select=id,nome&matricula=eq.69051`, { headers: H })).json()
if (th[0]) {
  const r = await rpc('fn_auditoria_ponto_servidor', { p_servidor_id: th[0].id, p_inicio: '2026-09-01', p_fim: '2026-09-10' })
  const dias = r.s === 200 ? JSON.parse(r.t) : []
  const d3 = dias.find(d => d.data === '2026-09-03')
  ok(!!d3, `THAYNA 03/09 aparece na trilha (${r.ms}ms)`)
  if (d3) {
    console.log(`         diagnostico="${d3.diagnostico}" retidas=${d3.batidas_retidas} batidas=${(d3.batidas||[]).length}`)
    ok(d3.diagnostico === 'retida' || d3.batidas_retidas > 0, `detectou a batida fora de circulacao`)
  }
}

// ---- CASO REAL 2: alguem da CME do HMI no dia 18/09 (as 509 batidas recuperadas)
const cme = await (await fetch(`${U}/rest/v1/marcacoes_ponto?select=servidor_id&dispositivo_id=eq.19454bce-aa64-45af-865f-df2b18e0a205&ocorrido_em=gte.2026-09-18T03:00:00Z&ocorrido_em=lt.2026-09-19T03:00:00Z&servidor_id=not.is.null&limit=1`, { headers: H })).json()
if (cme[0]) {
  const r = await rpc('fn_auditoria_ponto_servidor', { p_servidor_id: cme[0].servidor_id, p_inicio: '2026-09-15', p_fim: '2026-09-19' })
  const dias = r.s === 200 ? JSON.parse(r.t) : []
  const d18 = dias.find(d => d.data === '2026-09-18')
  ok(!!d18 && (d18.batidas || []).length > 0, `HMI 18/09: a trilha mostra as batidas recuperadas (${(d18?.batidas||[]).length} batidas, ${r.ms}ms)`)
  if (d18) console.log(`         diagnostico="${d18.diagnostico}"`)
}

// ---- a vigilancia continua de pe
const v = await rpc('fn_vigilancia_coleta_parque', {})
ok(v.s === 200 && v.ms < 2000, `fn_vigilancia_coleta_parque: HTTP ${v.s} em ${v.ms}ms`)
if (v.s === 200) {
  const l = JSON.parse(v.t)
  const sev2 = l.filter(x => x.severidade === 2).length
  console.log(`         ${l.length} relogio(s), ${sev2} com ponto parado`)
}

console.log(falhou === 0 ? '\nTODAS AS ASSERCOES PASSARAM' : `\n${falhou} FALHARAM`)
process.exit(falhou === 0 ? 0 : 1)
