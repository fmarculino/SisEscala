import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
async function q(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from+999}` } })
    if (!r.ok) { console.error(path, r.status, await r.text()); return out }
    const p = await r.json(); out.push(...p); if (p.length < 1000) break
  }
  return out
}
const SID = '5defd039-5ce4-4e12-8892-5015e7bc3a58'
const disp = await q(`dispositivos_rep?select=id,nome,unidade_id,endereco_ip,ponto_valido_desde`)
const unis = await q(`unidades?select=id,nome`)
const un = Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const dp = Object.fromEntries(disp.map(d=>[d.id,`${d.nome} @ ${un[d.unidade_id]}`]))
const ms = await q(`marcacoes_ponto?select=*&servidor_id=eq.${SID}&ocorrido_em=gte.2026-09-04&ocorrido_em=lt.2026-09-09&order=ocorrido_em`)
console.log('=== MARCACOES (local -3) ===')
const loc = s => new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,19)
for (const m of ms) console.log(loc(m.ocorrido_em), '|', m.origem, '|', dp[m.dispositivo_rep_id] || m.dispositivo_rep_id || '(terminal)', '| setor:', m.setor_id, '| unid:', un[m.unidade_id]||m.unidade_id, '| sint:', m.sintetica, '| id:', m.id)
const turnos = await q(`dicionario_turnos?select=id,codigo,slots,horario_inicio,horas_computadas,categoria`)
const tt = Object.fromEntries(turnos.map(t=>[t.id,t]))
console.log('\n=== TURNOS ===')
for (const id of ['1c9a00b2-081a-4d06-b191-a6245c8cce78','864644f9-504f-40a5-91be-c608939fc434','f4cd224e-19d1-4a07-a9e4-697f7ca5789d'])
  console.log(id, JSON.stringify(tt[id]))
