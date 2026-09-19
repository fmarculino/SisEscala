import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const q = async p => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(p+' '+r.status+' '+await r.text()); return r.json() }
const rpc = async (fn,b) => { const r = await fetch(`${U}/rest/v1/rpc/${fn}`, {method:'POST',headers:H,body:JSON.stringify(b)}); return r.ok ? await r.json() : null }

const disp = await q('dispositivos_rep?select=id,nome,ultimo_nsr,ultimo_contato_em,coletor_host,unidades(nome)&ativo=eq.true&order=nome')
console.log(`dispositivos ativos: ${disp.length}\n`)
console.log('relogio'.padEnd(26), 'unidade'.padEnd(22), 'ult_nsr'.padStart(9), 'cursor'.padStart(9), 'lacuna'.padStart(9), '  ult_contato')
const comLacuna = []
for (const d of disp) {
  const cur = await rpc('fn_cursor_afd_dispositivo', { p_dispositivo_id: d.id })
  const ult = Number(d.ultimo_nsr || 0)
  const lac = cur !== null && ult > 0 ? ult - Number(cur) + 1 : 0
  const horas = d.ultimo_contato_em ? ((Date.now() - new Date(d.ultimo_contato_em)) / 3600000).toFixed(1) : '?'
  const flag = lac > 0 ? (lac >= 500 ? '  <<< TRAVADO' : '  <<< lacuna') : ''
  console.log(d.nome.padEnd(26), String(d.unidades?.nome||'').slice(0,22).padEnd(22), String(ult).padStart(9), String(cur).padStart(9), String(lac).padStart(9), ` ${horas}h${flag}`)
  if (lac > 0) comLacuna.push({ ...d, cursor: cur, lacuna: lac })
}
console.log(`\n=== ${comLacuna.length} dispositivo(s) com lacuna ===`)
for (const d of comLacuna) console.log(`${d.nome} (${d.unidades?.nome}) host=${d.coletor_host} lacuna=${d.lacuna} nsr ${d.cursor}..${d.ultimo_nsr}`)
