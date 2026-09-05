// Confere, contra producao, exatamente a consulta e a conta que o painel passa a fazer.
// Nao basta o portao unitario: o embed aninhado escala_mensal!inner(jornadas(...)) so se prova
// executando (armadilha 8b — FK ambigua nao quebra tsc nem build, so a chamada real).
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY, H = { apikey: K, Authorization: `Bearer ${K}` }

const { horasDaLinhaEscala, horasProntidaoSobreaviso } = await import('./_sim/escala/horasLinha.js')
  .catch(async () => await import('./_sim/escala/horasLinha.cjs'))

const SELECT = 'id,categoria,dicionario_turnos(codigo,horas_computadas),escala_mensal!inner(mes,ano,status,unidade_id,setor_id,jornadas(horas_totais,intervalo_minutos))'

async function paginar(mes, ano) {
  const out = []
  for (let f = 0; ; f += 1000) {
    const url = `${U}/rest/v1/escala_diaria?select=${encodeURIComponent(SELECT)}&escala_mensal.mes=eq.${mes}&escala_mensal.ano=eq.${ano}&order=id`
    const r = await fetch(url, { headers: { ...H, Range: `${f}-${f + 999}` } })
    if (!r.ok) { console.error('ERRO', r.status, (await r.text()).slice(0, 400)); process.exit(1) }
    const g = await r.json()
    out.push(...g)
    if (g.length < 1000) break
  }
  return out
}

console.log('embed escala_mensal!inner(jornadas(...)): testando contra producao...\n')
console.log('mes      Regular    Plantao  Sobreaviso  Extra   | Regular ANTES (vao bruto)   diferenca')
for (const [mes, ano] of [[7, 2026], [8, 2026], [9, 2026]]) {
  const linhas = await paginar(mes, ano)
  let regular = 0, plantao = 0, sobreaviso = 0, extra = 0, bruto = 0, semJornada = 0
  for (const d of linhas) {
    const t = d.dicionario_turnos
    const j = d.escala_mensal?.jornadas
    const cat = d.categoria
    if (cat === 'Regular' && !j) semJornada++
    if (cat === 'Sobreaviso') { sobreaviso += horasProntidaoSobreaviso(t?.horas_computadas, t?.codigo); continue }
    const h = horasDaLinhaEscala(cat, t?.horas_computadas, j)
    if (cat === 'Regular') { regular += h; bruto += Number(t?.horas_computadas) || 0 }
    else if (cat === 'Plantão') plantao += h
    else if (cat === 'Extra') extra += h
  }
  const R = (x) => String(Math.round(x)).padStart(8)
  console.log(`${mes}/${ano} ${R(regular)} ${R(plantao)} ${R(sobreaviso)} ${R(extra)}   | ${R(bruto)}${String(Math.round(bruto - regular)).padStart(20)}h` +
    (semJornada ? `   (${semJornada} linhas Regular sem jornada resolvivel)` : ''))
}
