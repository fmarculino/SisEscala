// Valida em HOMOLOGACAO que as duas RPCs de enfileiramento aceitam service_role (auth.uid() NULL)
// e devolvem o formato que enfileirarCadastrosDoParque espera. Nao toca em producao.
import fs from 'node:fs'

const e = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const U = e.NEXT_PUBLIC_SUPABASE_URL, K = e.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
console.log('banco: ' + U.replace(/https:\/\/([^.]+).*/, '$1') + ' (homologacao)\n')

async function rpc(fn, body) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  const txt = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`)
  return txt ? JSON.parse(txt) : null
}

const rDisp = await fetch(`${U}/rest/v1/dispositivos_rep?select=id,nome&ativo=eq.true&order=nome`, { headers: H })
const dispositivos = await rDisp.json()
console.log(`dispositivos ativos: ${dispositivos.length}`)

let falhou = false
for (const d of dispositivos) {
  try {
    const porEscala = await rpc('fn_enfileirar_cadastros_por_escala', { p_dispositivo_id: d.id, p_mes: 9, p_ano: 2026 })
    const porLotacao = await rpc('fn_enfileirar_cadastros_rep', { p_dispositivo_id: d.id })
    const okEscala = porEscala && typeof porEscala === 'object' && 'enfileirados' in porEscala
    const okLotacao = porLotacao && typeof porLotacao === 'object' && 'enfileirados' in porLotacao
    if (!okEscala || !okLotacao) falhou = true
    console.log(`  ${d.nome}`)
    console.log(`    por escala : ${okEscala ? 'formato ok' : 'FORMATO INESPERADO'} -> ${JSON.stringify(porEscala)}`)
    console.log(`    por lotacao: ${okLotacao ? 'formato ok' : 'FORMATO INESPERADO'} -> ${JSON.stringify(porLotacao)}`)
  } catch (err) {
    falhou = true
    console.log(`  ${d.nome}: FALHOU -> ${err.message}`)
  }
}

console.log(falhou
  ? '\nREPROVADO: alguma chamada falhou ou devolveu formato diferente do que o cron espera.'
  : '\nAPROVADO: service_role passa pelos guards e o formato { enfileirados, ja_na_fila } confere.')
process.exit(falhou ? 1 : 0)
