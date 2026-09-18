// Dias em que existe batida FISICA desconsiderada e o "Preencher pelas Batidas" diz que
// nao ha nada a fazer. LEITURA PURA.
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
async function rpc(fn, body) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${fn} ${r.status} ${await r.text()}`)
  return r.json()
}
const diaDe = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

const trat = await get('marcacoes_tratamentos?select=marcacao_id,tipo,created_at&tipo=in.(desconsiderar,restaurar)')
const ult = new Map()
for (const t of trat) { const a = ult.get(t.marcacao_id); if (!a || new Date(t.created_at) > new Date(a.created_at)) ult.set(t.marcacao_id, t) }
const desc = [...ult.entries()].filter(([, t]) => t.tipo === 'desconsiderar').map(([id]) => id)

const marc = []
for (let i = 0; i < desc.length; i += 150) marc.push(...await get(`marcacoes_ponto?select=id,servidor_id,origem,ocorrido_em,sintetica&id=in.(${desc.slice(i, i + 150).join(',')})`))
const fis = marc.filter(m => m.servidor_id && (m.origem === 'rep' || (m.origem === 'terminal' && m.sintetica === false)))

const pares = new Map()
for (const m of fis) { const k = `${m.servidor_id}|${diaDe(m.ocorrido_em)}`; if (!pares.has(k)) pares.set(k, []); pares.get(k).push(m) }
console.log(`batidas fisicas desconsideradas: ${fis.length}  |  pares (servidor, dia) distintos: ${pares.size}`)

const srvIds = [...new Set(fis.map(m => m.servidor_id))]
const srv = []
for (let i = 0; i < srvIds.length; i += 100) srv.push(...await get(`servidores?select=id,nome,matricula&id=in.(${srvIds.slice(i, i + 100).join(',')})`))
const S = Object.fromEntries(srv.map(s => [s.id, s]))

let comEscalaVazia = 0, mudo = 0, ofereceAlgo = 0
const lista = []
for (const [k, ms] of pares) {
  const [sid, d] = k.split('|'); const [ano, mes, dd] = d.split('-').map(Number)
  const ems = await get(`escala_mensal?select=id,status,unidade_id&servidor_id=eq.${sid}&mes=eq.${mes}&ano=eq.${ano}`)
  let temVazio = false
  for (const e of ems) {
    const eds = await get(`escala_diaria?select=id,categoria,presenca_entrada_em,presenca_saida_em&escala_mensal_id=eq.${e.id}&dia=eq.${dd}`)
    for (const ed of eds) if (ed.categoria !== 'Sobreaviso' && (!ed.presenca_entrada_em || !ed.presenca_saida_em)) temVazio = true
  }
  if (!temVazio) continue
  comEscalaVazia++
  const diff = await rpc('fn_conferir_reconciliacao', { p_data_inicio: d, p_data_fim: d, p_servidor_id: sid })
  const ganha = diff.filter(x => x.tipo_divergencia === 'ausente_no_atual').length
  if (ganha === 0) { mudo++; lista.push({ mat: S[sid]?.matricula, nome: S[sid]?.nome, dia: d, batidas: ms.length, origem: [...new Set(ms.map(m => m.origem))].join('/') }) }
  else ofereceAlgo++
}
console.log(`\ncom escala HOJE e passo vazio : ${comEscalaVazia}`)
console.log(`  "Preencher" oferece algo     : ${ofereceAlgo}`)
console.log(`  "Preencher" diz NADA A FAZER : ${mudo}   <-- batida real retida, sem aviso`)
console.log('\n--- os casos mudos ---')
for (const l of lista) console.log(`  mat ${l.mat} | ${l.nome?.slice(0, 32)} | ${l.dia} | ${l.batidas} batida(s) ${l.origem}`)
