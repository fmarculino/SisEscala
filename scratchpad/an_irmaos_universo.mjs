// Universo do duplo vinculo e alcance da correcao. LEITURA PURA.
import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: E.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${E.SUPABASE_SERVICE_ROLE_KEY}` }

async function get(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
    const page = await r.json(); out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

const dig = s => (s || '').replace(/\D/g, '')

// 1. Grupos de cadastros irmaos (mesmo CPF, Ativo, nao mesclado)
const srv = await get('servidores?select=id,nome,matricula,cpf,unidade_id,status,mesclado_em_servidor_id&status=eq.Ativo&mesclado_em_servidor_id=is.null')
const porCpf = new Map()
for (const s of srv) {
  const c = dig(s.cpf).slice(-11)
  if (c.length < 11) continue
  if (!porCpf.has(c)) porCpf.set(c, [])
  porCpf.get(c).push(s)
}
const grupos = [...porCpf.entries()].filter(([, v]) => v.length > 1)
console.log(`=== 1. UNIVERSO ===`)
console.log(`  ${srv.length} servidores Ativos nao mesclados`)
console.log(`  ${grupos.length} CPFs com 2+ cadastros`)
const mesmaUnidade = grupos.filter(([, v]) => new Set(v.map(s => s.unidade_id)).size === 1)
console.log(`  ${mesmaUnidade.length} deles com todos os cadastros na MESMA unidade`)

const idsGrupo = grupos.flatMap(([, v]) => v.map(s => s.id))
const mapS = Object.fromEntries(srv.map(s => [s.id, s]))

// 2. Batidas REP de 09/2026 desses cadastros
const marc = await get(`marcacoes_ponto?select=id,servidor_id,ocorrido_em,dispositivo_id&origem=eq.rep&servidor_id=in.(${idsGrupo.join(',')})&ocorrido_em=gte.2026-09-01T00:00:00-03:00&ocorrido_em=lt.2026-10-01T00:00:00-03:00`)
const diaLocal = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

// pares (servidor que RECEBEU a batida, dia)
const paresBatida = new Set(marc.map(m => `${m.servidor_id}|${diaLocal(m.ocorrido_em)}`))
console.log(`\n=== 2. BATIDAS REP EM 09/2026 (cadastros com irmao) ===`)
console.log(`  ${marc.length} batidas | ${paresBatida.size} pares (cadastro, dia)`)

// 3. Para cada par, os IRMAOS daquele cadastro naquele dia
const cpfDe = id => dig(mapS[id]?.cpf).slice(-11)
const alvos = new Map() // "irmao|dia" -> { irmao, dia, deQuem: Set }
for (const p of paresBatida) {
  const [sid, dia] = p.split('|')
  for (const irm of porCpf.get(cpfDe(sid)) || []) {
    if (irm.id === sid) continue
    const k = `${irm.id}|${dia}`
    if (!alvos.has(k)) alvos.set(k, { irmao: irm, dia, deQuem: new Set() })
    alvos.get(k).deQuem.add(sid)
  }
}
console.log(`\n=== 3. PARES (IRMAO, DIA) QUE A CORRECAO PASSARIA A RECONCILIAR ===`)
console.log(`  ${alvos.size} pares candidatos`)

// 4. Classificar cada um pelo diff da projecao (fn_conferir_reconciliacao nao escreve nada)
async function rpc(fn, body) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${fn} -> ${r.status} ${await r.text()}`)
  return r.json()
}

const res = { ganho: [], troca: [], perda: [], nada: 0, erro: [] }
let n = 0
for (const { irmao, dia, deQuem } of alvos.values()) {
  n++
  try {
    const diff = await rpc('fn_conferir_reconciliacao', { p_data_inicio: dia, p_data_fim: dia, p_servidor_id: irmao.id })
    if (!diff.length) { res.nada++; continue }
    const g = diff.filter(d => d.tipo_divergencia === 'ausente_no_atual')
    const t = diff.filter(d => d.tipo_divergencia === 'horario_diferente' && Number(d.diferenca_min) > 1)
    const p = diff.filter(d => d.tipo_divergencia === 'ausente_na_projecao')
    const linha = { mat: irmao.matricula, nome: irmao.nome, dia, de: [...deQuem].map(x => mapS[x]?.matricula), g: g.length, t: t.length, p: p.length, diff }
    if (p.length) res.perda.push(linha)
    else if (t.length) res.troca.push(linha)
    else if (g.length) res.ganho.push(linha)
    else res.nada++
  } catch (e) { res.erro.push({ mat: irmao.matricula, dia, erro: String(e).slice(0, 160) }) }
}

console.log(`\n=== 4. CLASSIFICACAO (${n} pares avaliados) ===`)
console.log(`  SO ACRESCIMO (ganho puro) : ${res.ganho.length}`)
console.log(`  TROCA de horario ja gravado: ${res.troca.length}`)
console.log(`  PERDA (projecao nao tem)   : ${res.perda.length}`)
console.log(`  sem mudanca                : ${res.nada}`)
console.log(`  erro                       : ${res.erro.length}`)

const campos = res.ganho.reduce((a, l) => a + l.g, 0)
console.log(`\n  horarios que a correcao preencheria (so acrescimo): ${campos}`)

console.log('\n--- GANHO PURO (ate 25) ---')
for (const l of res.ganho.slice(0, 25)) console.log(`  mat ${l.mat} ${l.dia} | +${l.g} campo(s) | batida veio em ${l.de.join(',')}`)
console.log('\n--- TROCA (todas) ---')
for (const l of res.troca) {
  console.log(`  mat ${l.mat} ${l.dia} | ${l.t} troca(s)`)
  for (const d of l.diff.filter(x => x.tipo_divergencia === 'horario_diferente' && Number(x.diferenca_min) > 1)) console.log(`      ${d.campo}: ${d.valor_atual} -> ${d.valor_projetado} (${d.origem_projetada}, ${d.diferenca_min} min)`)
}
console.log('\n--- PERDA (todas) ---')
for (const l of res.perda) {
  console.log(`  mat ${l.mat} ${l.dia} | ${l.p} perda(s)`)
  for (const d of l.diff.filter(x => x.tipo_divergencia === 'ausente_na_projecao')) console.log(`      ${d.campo}: ${d.valor_atual} -> (vazio)`)
}
if (res.erro.length) { console.log('\n--- ERROS ---'); for (const e of res.erro.slice(0, 10)) console.log(' ', JSON.stringify(e)) }
