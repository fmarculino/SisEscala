// Conferencia da 20260905100000 nos DOIS bancos. Somente LEITURA.
import fs from 'node:fs'

function env(arquivo) {
  if (!fs.existsSync(arquivo)) return null
  return Object.fromEntries(
    fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
  )
}

const bancos = [
  ['homologacao', env('.env.local')],
  ['producao', env('.env.production')],
].filter(([, e]) => e && e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY)

async function rpc(e, fn, body) {
  const H = { apikey: e.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
  const r = await fetch(`${e.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

for (const [rotulo, e] of bancos) {
  console.log(`\n================ ${rotulo.toUpperCase()} ================`)
  let resumo
  try {
    resumo = await rpc(e, 'fn_cobertura_ponto_resumo', { p_mes: 9, p_ano: 2026 })
  } catch (err) {
    console.log(`  nao consegui chamar o resumo: ${err.message}`)
    continue
  }
  const aplicada = resumo.length > 0 && Object.prototype.hasOwnProperty.call(resumo[0], 'total_pessoas')
  console.log(`  MIGRATION APLICADA: ${aplicada ? 'SIM (total_pessoas presente)' : 'NAO (coluna total_pessoas ausente)'}`)
  if (!aplicada) continue

  // Conferencia 1: universo cresceu, escalados preservado
  const tp = resumo.reduce((s, d) => s + d.total_pessoas, 0)
  const es = resumo.reduce((s, d) => s + d.escalados, 0)
  const nb = resumo.reduce((s, d) => s + d.nao_conseguem_bater, 0)
  const sb = resumo.reduce((s, d) => s + d.sem_biometria, 0)
  console.log(`  1) total_pessoas=${tp}  escalados=${es}  nao_conseguem_bater=${nb}  sem_biometria=${sb}`)
  if (tp < es) console.log('     FALHA: total_pessoas menor que escalados - a uniao esta errada')

  // Conferencia 2: o caso que motivou (USF Jose Manoel)
  const brejo = resumo.find((d) => /JMA-BREJO/i.test(d.dispositivo_nome))
  if (brejo) {
    const det = await rpc(e, 'fn_cobertura_ponto_dispositivo', { p_dispositivo_id: brejo.dispositivo_id, p_mes: 9, p_ano: 2026 })
    console.log(`  2) ${brejo.dispositivo_nome}: ${det.length} pessoa(s) listada(s) (antes: 1)`)
    for (const s of det) {
      console.log(`       - ${s.servidor_nome} | dias=${s.dias_com_escala} | ${s.situacao} | bio=${s.tem_biometria}`)
    }
  }

  // Conferencia 3: Servidor Externo preservado (escalado aqui, lotado noutro lugar)
  let externos = 0, duplicados = 0
  for (const d of resumo) {
    const det = await rpc(e, 'fn_cobertura_ponto_dispositivo', { p_dispositivo_id: d.dispositivo_id, p_mes: 9, p_ano: 2026 })
    externos += det.filter((c) => c.dias_com_escala > 0 && !c.lotacao_compativel).length
    const vistos = new Set()
    for (const c of det) { if (vistos.has(c.servidor_id)) duplicados++; vistos.add(c.servidor_id) }
  }
  console.log(`  3) servidores externos preservados: ${externos} ${externos > 0 ? '(uniao ok)' : '(ATENCAO: zero - conferir se e esperado)'}`)
  console.log(`  4) linhas duplicadas por dispositivo: ${duplicados} ${duplicados === 0 ? '(ok)' : '(FALHA)'}`)
}
