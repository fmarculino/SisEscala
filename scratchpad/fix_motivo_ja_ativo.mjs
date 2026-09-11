import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const q = async p => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); if(!r.ok) throw new Error(`${p} ${r.status} ${await r.text()}`); return r.json() }

const MOTIVO_JA_ATIVO = 'Encerrado em 11/09/2026: o aviso ja estava ATIVO, a confirmacao deixou de ser necessaria. Linha orfa do periodo em que o despachador esteve parado (cron em formato antigo desde 30/08).'

// So as linhas encerradas AGORA cujo servidor esta ativo. Por id explicito, nunca por criterio amplo.
const alvo = []
for (const f of await q("avisos_ponto_fila?select=id,servidor_id,motivo_falha&tipo=eq.confirmacao_optin&status=eq.falha&processado_em=gte.2026-09-11T22:30:00Z")) {
  const s = (await q(`servidores?select=nome,matricula,aviso_ponto_status&id=eq.${f.servidor_id}`))[0]
  if (s?.aviso_ponto_status === 'ativo') alvo.push({ ...f, nome: s.nome, mat: s.matricula })
}
console.log('linhas a recorrigir:', alvo.map(a => `${a.nome} (${a.mat})`).join(' | ') || '(nenhuma)')

for (const a of alvo) {
  const r = await fetch(`${U}/rest/v1/avisos_ponto_fila?id=eq.${a.id}`, {
    method:'PATCH', headers:{...H, Prefer:'return=representation'}, body: JSON.stringify({ motivo_falha: MOTIVO_JA_ATIVO }) })
  if(!r.ok) throw new Error(await r.text())
  console.log('  ok:', a.nome)
}
