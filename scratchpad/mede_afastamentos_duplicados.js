/**
 * Quantos pares (servidor, dia) tem MAIS DE UM afastamento — e quantas folhas ja geradas
 * imprimem so o primeiro (armadilha 21).
 *
 * Leitura pura. A chave vem do ambiente ou de .env.production e NUNCA e impressa
 * (armadilha 18: o repositorio e publico).
 *
 *   node scratchpad/mede_afastamentos_duplicados.js [.env.production]
 */
const fs = require('fs')

const envPath = process.argv[2] || '.env.production'
function lerEnv(p) {
  const out = {}
  if (!fs.existsSync(p)) return out
  for (const linha of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^([A-Z_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}
const env = { ...lerEnv(envPath), ...process.env }
const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY
if (!U || !K) {
  console.error(`Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (tentei ${envPath} e o ambiente).`)
  process.exit(1)
}
const H = { apikey: K, Authorization: `Bearer ${K}` }

/** PostgREST corta em 1000 linhas em silencio (armadilha 8). */
async function todas(caminho) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${caminho}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    const page = await r.json()
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

const diasNoMes = (ano, mes) => new Date(ano, mes, 0).getDate()
const dataISO = (a, m, d) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

;(async () => {
  console.log(`banco: ${U}`)

  const eventos = await todas(
    'servidores_eventos?select=id,servidor_id,data_inicio,data_fim,slots,periodo_tipo,hora_inicio,hora_fim,tipo_evento_id,tipos_eventos(nome),servidores(nome,matricula)'
  )
  console.log(`servidores_eventos: ${eventos.length} linhas\n`)

  // Expande cada evento nos dias civis que ele cobre e conta por (servidor, dia).
  const porDia = new Map()
  for (const ev of eventos) {
    if (!ev.data_inicio || !ev.data_fim) continue
    for (let d = new Date(ev.data_inicio + 'T12:00:00'); ; d.setDate(d.getDate() + 1)) {
      const iso = dataISO(d.getFullYear(), d.getMonth() + 1, d.getDate())
      if (iso > ev.data_fim) break
      const chave = `${ev.servidor_id}|${iso}`
      if (!porDia.has(chave)) porDia.set(chave, [])
      porDia.get(chave).push(ev)
    }
  }

  const multiplos = [...porDia.entries()]
    .filter(([, evs]) => evs.length > 1)
    .map(([chave, evs]) => {
      const [servidorId, dia] = chave.split('|')
      return { servidorId, dia, evs }
    })
    .sort((a, b) => a.dia.localeCompare(b.dia))

  console.log(`=== 1. Pares (servidor, dia) com mais de um afastamento: ${multiplos.length} ===`)
  const porCompetencia = new Map()
  for (const m of multiplos) {
    const comp = m.dia.substring(0, 7)
    porCompetencia.set(comp, (porCompetencia.get(comp) || 0) + 1)
  }
  for (const [comp, n] of [...porCompetencia].sort()) console.log(`  ${comp}: ${n}`)

  console.log('\n=== 2. Detalhe de cada par ===')
  for (const m of multiplos) {
    const s = m.evs[0].servidores
    const desc = m.evs.map(e => {
      const nome = e.tipos_eventos?.nome || '(sem tipo)'
      const per = e.hora_inicio
        ? `${String(e.hora_inicio).substring(0, 5)}-${String(e.hora_fim || '').substring(0, 5)}`
        : (e.slots && e.slots.length ? e.slots.join('/') : 'integral')
      return `${nome} [${per}]`
    }).join('  +  ')
    console.log(`  ${m.dia}  ${(s?.nome || m.servidorId).padEnd(38)} ${s?.matricula || ''}`)
    console.log(`             ${desc}`)
  }

  // 3. Quais dessas competencias tem folha gerada — e portanto texto congelado no snapshot.
  const chavesComp = new Set(multiplos.map(m => `${m.servidorId}|${m.dia.substring(0, 7)}`))
  if (chavesComp.size === 0) { console.log('\nNada a sincronizar.'); return }

  const servidorIds = [...new Set(multiplos.map(m => m.servidorId))]
  const escalas = await todas(
    `escala_mensal?select=id,servidor_id,mes,ano,status&servidor_id=in.(${servidorIds.join(',')})`
  )
  const folhas = await todas(
    `folha_ponto?select=id,escala_mensal_id,mes,ano,status,servidor_id&servidor_id=in.(${servidorIds.join(',')})`
  )

  console.log('\n=== 3. Folhas que hoje imprimem so o primeiro evento ===')
  const vistas = new Set()
  let comFolha = 0
  for (const m of multiplos) {
    const [ano, mes] = m.dia.split('-').map(Number)
    const chave = `${m.servidorId}|${ano}-${mes}`
    if (vistas.has(chave)) continue
    vistas.add(chave)
    const f = folhas.filter(x => x.servidor_id === m.servidorId && Number(x.mes) === mes && Number(x.ano) === ano)
    const e = escalas.filter(x => x.servidor_id === m.servidorId && Number(x.mes) === mes && Number(x.ano) === ano)
    const s = m.evs[0].servidores
    if (f.length > 0) {
      comFolha++
      console.log(`  ${String(mes).padStart(2, '0')}/${ano}  ${(s?.nome || m.servidorId).padEnd(38)} folha=${f.map(x => x.status).join(',')} escala=${e.map(x => x.status).join(',') || '-'}`)
      console.log(`             folha_id: ${f.map(x => x.id).join(', ')}`)
    } else {
      console.log(`  ${String(mes).padStart(2, '0')}/${ano}  ${(s?.nome || m.servidorId).padEnd(38)} SEM folha gerada (nada a sincronizar)`)
    }
  }
  console.log(`\n  competencias com folha a sincronizar: ${comFolha}`)
  console.log(`  dias de ${diasNoMes(2026, 8)} em 08/2026 conferidos por expansao civil`)
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1) })
