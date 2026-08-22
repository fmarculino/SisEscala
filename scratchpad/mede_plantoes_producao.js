// Leitura de PRODUCAO (autorizada pelo usuario em 21/08/2026). Somente SELECT.
// Conta quais codigos de plantao estao realmente em uso, para decidir a decomposicao
// em unidades de pagamento PL12/PL6/PL4. Pagina por Range: o PostgREST corta em 1.000
// linhas em silencio (armadilha 8 do CLAUDE.md) e escala_diaria passa disso todo mes.
const fs = require('fs')
const env = fs.readFileSync('.env.production', 'utf8')
const U = (env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/) || [])[1].trim()
const K = (env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/) || [])[1].trim()
const H = { apikey: K, Authorization: 'Bearer ' + K }

async function paginado(url) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(url, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
    const page = await r.json()
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

;(async () => {
  const url = `${U}/rest/v1/escala_diaria?select=dia,categoria,dicionario_turnos(codigo,horas_computadas),escala_mensal!inner(mes,ano)&categoria=eq.Plant%C3%A3o`
  const linhas = await paginado(url)
  console.log('linhas de Plantao em escala_diaria (todas as competencias):', linhas.length)

  const porCodigo = {}
  const porCompetencia = {}
  for (const l of linhas) {
    const cod = l.dicionario_turnos?.codigo || '(sem turno)'
    const h = Number(l.dicionario_turnos?.horas_computadas ?? 0)
    const comp = `${String(l.escala_mensal?.mes).padStart(2, '0')}/${l.escala_mensal?.ano}`
    porCodigo[cod] = porCodigo[cod] || { cod, h, n: 0, comps: new Set() }
    porCodigo[cod].n++
    porCodigo[cod].comps.add(comp)
    porCompetencia[comp] = (porCompetencia[comp] || 0) + 1
  }

  console.log('\ncompetencias:', Object.entries(porCompetencia).sort().map(([k, v]) => `${k}=${v}`).join('  '))
  console.log('\ncodigo | horas | lancamentos | competencias')
  Object.values(porCodigo).sort((a, b) => b.n - a.n).forEach(x =>
    console.log(`${x.cod.padEnd(7)}|${String(x.h).padStart(5)}h |${String(x.n).padStart(12)} | ${[...x.comps].sort().join(' ')}`))
  fs.writeFileSync('scratchpad/_plantoes_producao.json', JSON.stringify(Object.values(porCodigo).map(x => ({ ...x, comps: [...x.comps] })), null, 1))
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
