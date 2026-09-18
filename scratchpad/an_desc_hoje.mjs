import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: E.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${E.SUPABASE_SERVICE_ROLE_KEY}` }
async function get(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
    const p = await r.json(); out.push(...p); if (p.length < 1000) break
  }
  return out
}
const trat = await get('marcacoes_tratamentos?select=marcacao_id,tipo,created_at&tipo=eq.desconsiderar&order=created_at')
const porDia = {}
for (const t of trat) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t.created_at))
  porDia[d] = (porDia[d] || 0) + 1
}
console.log('=== desconsiderar POR DIA (ultimos 12 dias com movimento) ===')
for (const [d, n] of Object.entries(porDia).sort().slice(-12)) console.log(`  ${d}  ${String(n).padStart(5)}`)

const hoje = trat.filter(t => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t.created_at)) === '2026-09-17')
console.log(`\n=== HOJE (17/09): ${hoje.length} desconsiderar ===`)
if (hoje.length) {
  const ids = hoje.map(t => t.marcacao_id)
  const m = []
  for (let i = 0; i < ids.length; i += 150) m.push(...await get(`marcacoes_ponto?select=id,servidor_id,origem,ocorrido_em,sintetica&id=in.(${ids.slice(i, i + 150).join(',')})`))
  const cnt = {}
  for (const x of m) { const k = x.origem + (x.sintetica ? ' (sintetica)' : ''); cnt[k] = (cnt[k] || 0) + 1 }
  for (const [k, v] of Object.entries(cnt).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`)
  const fis = m.filter(x => x.origem === 'rep' || (x.origem === 'terminal' && x.sintetica === false))
  console.log(`\n  BATIDAS FISICAS retiradas de circulacao HOJE: ${fis.length}`)
  const srvIds = [...new Set(fis.map(x => x.servidor_id).filter(Boolean))]
  const srv = srvIds.length ? await get(`servidores?select=id,matricula,nome&id=in.(${srvIds.join(',')})`) : []
  const S = Object.fromEntries(srv.map(s => [s.id, s]))
  const porSrv = {}
  for (const x of fis) { const k = x.servidor_id; porSrv[k] = (porSrv[k] || 0) + 1 }
  console.log('  por servidor:')
  for (const [k, v] of Object.entries(porSrv).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(3)}  mat ${S[k]?.matricula ?? '?'}  ${S[k]?.nome?.slice(0, 38) ?? ''}`)
}
