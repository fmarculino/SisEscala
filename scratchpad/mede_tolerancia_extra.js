/**
 * SO LEITURA. Impacto da tolerancia do Art. 58 §1º da CLT sobre a hora extra de 08/2026.
 *
 * Duas leituras possiveis, e elas dao numeros diferentes:
 *   LIMIAR  (Sumula 366 do TST) — dentro do limite, ZERA; passou do limite, computa TUDO.
 *   FRANQUIA (leitura ingenua)  — desconta sempre os N minutos, pague o resto.
 */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY }
async function page(q, tam = 200) {
  q += (q.includes('?') ? '&' : '?') + 'order=id'
  const out = []
  for (let f = 0; ; f += tam) {
    const r = await fetch(U + '/rest/v1/' + q, { headers: { ...H, Range: f + '-' + (f + tam - 1) } })
    if (!r.ok) throw new Error(r.status + ' ' + await r.text())
    const p = await r.json(); out.push(...p); if (p.length < tam) break
  }
  return out
}
const hm = m => Math.floor(m / 60) + 'h' + String(Math.round(m % 60)).padStart(2, '0')

const POR_MARCACAO = 5
const DIARIA = 10

const minDe = t => { if (!t || !t.includes(':')) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m }
const jorn = n => {
  const a = (n || '').match(/^([0-9]+)/), b = (n || '').match(/(?:ÀS|AS|as|às)\s*([0-9]+)/)
  if (!a || !b) return null
  let ini = Number(a[1]) * 60, fim = Number(b[1]) * 60
  if (fim <= ini) fim += 1440
  return { ini, fim }
}

;(async () => {
  const fp = await page('folha_ponto?select=id,servidor_id,registros&mes=eq.8&ano=eq.2026')
  let total = 0, dias = 0
  let limiar = 0, franquia = 0, diasLimiar = 0, diasFranquia = 0
  const faixas = { '1-5': 0, '6-10': 0, '11-30': 0, '31-60': 0, '>60': 0 }
  const faixaMin = { '1-5': 0, '6-10': 0, '11-30': 0, '31-60': 0, '>60': 0 }

  for (const f of fp) for (const r of (f.registros || [])) {
    const m = r.hora_extra_minutos || 0
    if (m <= 0) continue
    total += m; dias++
    const k = m <= 5 ? '1-5' : m <= 10 ? '6-10' : m <= 30 ? '11-30' : m <= 60 ? '31-60' : '>60'
    faixas[k]++; faixaMin[k] += m

    // LIMIAR: o excedente da saida e uma variacao so. Dentro de POR_MARCACAO e de DIARIA, zera.
    const dentro = m <= POR_MARCACAO && m <= DIARIA
    const vLimiar = dentro ? 0 : m
    limiar += vLimiar; if (vLimiar > 0) diasLimiar++

    // FRANQUIA: desconta sempre.
    const vFranq = Math.max(0, m - DIARIA)
    franquia += vFranq; if (vFranq > 0) diasFranquia++
  }

  console.log('### HORA EXTRA EM 08/2026 (depois da regeracao)')
  console.log('  hoje, sem tolerancia nenhuma: ' + dias + ' dias, ' + hm(total))
  console.log('')
  console.log('  distribuicao por tamanho do excedente:')
  for (const k of Object.keys(faixas))
    console.log('    ' + k.padEnd(7) + ' min  ' + String(faixas[k]).padStart(4) + ' dias   ' + hm(faixaMin[k]).padStart(8))
  console.log('')
  console.log('### COM TOLERANCIA ' + POR_MARCACAO + ' min por marcacao / ' + DIARIA + ' min diaria')
  console.log('  LIMIAR (Sumula 366 — passou do limite, computa TUDO):')
  console.log('     ' + diasLimiar + ' dias, ' + hm(limiar) + '   (deixa de pagar ' + hm(total - limiar) + ')')
  console.log('  FRANQUIA (desconta sempre os ' + DIARIA + ' min):')
  console.log('     ' + diasFranquia + ' dias, ' + hm(franquia) + '   (deixa de pagar ' + hm(total - franquia) + ')')
  // REGRA COMPLETA: as duas variacoes do dia (entrada antecipada + saida atrasada), cada uma
  // contra o limite POR MARCACAO e a soma contra o limite DIARIO. Zera so quando tudo cabe.
  let completa = 0, diasCompleta = 0, semJornada = 0
  for (const f of fp) for (const r of (f.registros || [])) {
    const m = r.hora_extra_minutos || 0
    if (m <= 0) continue
    const j = jorn(r.jornada_nome)
    if (!j) { completa += m; diasCompleta++; semJornada++; continue }
    const ent = minDe(r.entrada)
    const varEntrada = ent === null ? 0 : Math.max(0, j.ini - ent)   // chegou ANTES = a disposicao
    const varSaida = m                                              // o excedente que o sistema paga
    const cabe = varEntrada <= POR_MARCACAO && varSaida <= POR_MARCACAO &&
                 (varEntrada + varSaida) <= DIARIA
    if (!cabe) { completa += m; diasCompleta++ }
  }
  console.log('  REGRA COMPLETA (entrada antecipada + saida atrasada, ' + POR_MARCACAO + ' cada / ' + DIARIA + ' no dia):')
  console.log('     ' + diasCompleta + ' dias, ' + hm(completa) + '   (deixa de pagar ' + hm(total - completa) + ')')
  if (semJornada) console.log('     (' + semJornada + ' dias sem jornada parseavel foram mantidos integralmente)')
  console.log('')
  console.log('  diferenca LIMIAR x FRANQUIA: ' + hm(Math.abs(limiar - franquia)))
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
