// Por que "Preencher pelas Batidas" nao ve a batida real em alguns dias. LEITURA PURA.
import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: E.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${E.SUPABASE_SERVICE_ROLE_KEY}` }
async function get(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
    const page = await r.json(); out.push(...page); if (page.length < 1000) break
  }
  return out
}
const dia = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

// --- A. Tratamentos desconsiderar/restaurar: qual o ULTIMO por marcacao
const trat = await get('marcacoes_tratamentos?select=marcacao_id,tipo,created_at,justificativa,escala_diaria_id&tipo=in.(desconsiderar,restaurar)')
const ultimo = new Map()
for (const t of trat) {
  const a = ultimo.get(t.marcacao_id)
  if (!a || new Date(t.created_at) > new Date(a.created_at)) ultimo.set(t.marcacao_id, t)
}
const desconsideradas = [...ultimo.values()].filter(t => t.tipo === 'desconsiderar').map(t => t.marcacao_id)
console.log('=== A. TRATAMENTOS desconsiderar/restaurar ===')
console.log(`  ${trat.length} tratamentos | ${ultimo.size} marcacoes | ${desconsideradas.length} DESCONSIDERADAS agora`)
const porJust = {}
for (const t of [...ultimo.values()].filter(t => t.tipo === 'desconsiderar')) {
  const k = (t.justificativa || '(sem justificativa)').slice(0, 60)
  porJust[k] = (porJust[k] || 0) + 1
}
console.log('  por justificativa:')
for (const [k, v] of Object.entries(porJust).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    ${v.toString().padStart(5)}  ${k}`)

// --- B. Dessas, quais sao batida FISICA (rep ou terminal) -- as que somem do "Preencher"
if (desconsideradas.length) {
  const lotes = []
  for (let i = 0; i < desconsideradas.length; i += 150) lotes.push(desconsideradas.slice(i, i + 150))
  const marc = []
  for (const l of lotes) marc.push(...await get(`marcacoes_ponto?select=id,servidor_id,origem,ocorrido_em,sintetica,unidade_id,dispositivo_id&id=in.(${l.join(',')})`))
  const porOrigem = {}
  for (const m of marc) porOrigem[m.origem] = (porOrigem[m.origem] || 0) + 1
  console.log('\n=== B. ORIGEM DAS MARCACOES DESCONSIDERADAS ===')
  for (const [k, v] of Object.entries(porOrigem).sort((a, b) => b[1] - a[1])) console.log(`    ${v.toString().padStart(5)}  ${k}`)

  const fisicas = marc.filter(m => (m.origem === 'rep') || (m.origem === 'terminal' && m.sintetica === false))
  console.log(`\n  BATIDAS FISICAS desconsideradas: ${fisicas.length} (rep + terminal nao-sintetica)`)

  // --- C. Dessas, quantas caem em dia que HOJE tem escala com o passo VAZIO
  const srvIds = [...new Set(fisicas.map(m => m.servidor_id).filter(Boolean))]
  const emL = []
  for (let i = 0; i < srvIds.length; i += 100) emL.push(srvIds.slice(i, i + 100))
  const ems = []
  for (const l of emL) ems.push(...await get(`escala_mensal?select=id,servidor_id,mes,ano,unidade_id,setor_id,status&servidor_id=in.(${l.join(',')})`))
  const emPorSrv = new Map()
  for (const e of ems) { const k = `${e.servidor_id}|${e.mes}|${e.ano}`; if (!emPorSrv.has(k)) emPorSrv.set(k, []); emPorSrv.get(k).push(e) }

  const casos = []
  for (const m of fisicas) {
    if (!m.servidor_id) continue
    const d = dia(m.ocorrido_em); const [ano, mes, ddia] = d.split('-').map(Number)
    const escalas = emPorSrv.get(`${m.servidor_id}|${mes}|${ano}`) || []
    for (const e of escalas) {
      const eds = await get(`escala_diaria?select=id,dia,categoria,presenca_entrada_em,presenca_saida_em&escala_mensal_id=eq.${e.id}&dia=eq.${ddia}`)
      for (const ed of eds) {
        if (ed.categoria === 'Sobreaviso') continue
        const vazio = !ed.presenca_entrada_em || !ed.presenca_saida_em
        if (vazio) casos.push({ srv: m.servidor_id, dia: d, marc: m.id, origem: m.origem, ocorrido: m.ocorrido_em, ed: ed.id, cat: ed.categoria, uniMarc: m.unidade_id, uniEsc: e.unidade_id, just: ultimo.get(m.id)?.justificativa })
      }
    }
  }
  console.log(`\n=== C. BATIDA FISICA DESCONSIDERADA EM DIA QUE HOJE TEM ESCALA COM PASSO VAZIO ===`)
  console.log(`  ${casos.length} caso(s)`)
  const srvNomes = Object.fromEntries((await get(`servidores?select=id,nome,matricula&id=in.(${[...new Set(casos.map(c => c.srv))].slice(0, 200).join(',') || '00000000-0000-0000-0000-000000000000'})`)).map(s => [s.id, s]))
  for (const c of casos.slice(0, 40)) {
    const s = srvNomes[c.srv]
    const outraUni = c.uniMarc && c.uniEsc && c.uniMarc !== c.uniEsc ? '  [OUTRA UNIDADE]' : ''
    console.log(`  mat ${s?.matricula ?? '?'} ${c.dia} ${c.cat} | ${c.origem} ${c.ocorrido} | just: ${(c.just || '-').slice(0, 45)}${outraUni}`)
  }
}
