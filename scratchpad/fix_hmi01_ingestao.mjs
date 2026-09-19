// Recuperacao do lote travado do REP-iDClass-HMI-01 (19/09/2026).
// Ingere as 510 linhas de AFD ja baixadas do equipamento, em lotes PEQUENOS — o tamanho 500
// do coletor e' exatamente o que nao cabe no timeout. lote_id determinístico (mesma convencao
// de loteIDDeterministico do coletor), entao reexecutar e' idempotente.
import fs from 'fs'
import crypto from 'crypto'
import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const D = '19454bce-aa64-45af-865f-df2b18e0a205'
const TAM = Number(process.env.TAM || 50)
const APLICAR = process.argv.includes('--aplicar')

const raw = fs.readFileSync('scratchpad/_afd/hmi01_130690.afd', 'latin1')
const linhas = raw.split(/\r?\n/).filter(l => l.trim().length > 0)
const shaArquivo = crypto.createHash('sha256').update(fs.readFileSync('scratchpad/_afd/hmi01_130690.afd')).digest('hex')

function loteId(trecho) {
  const h = crypto.createHash('sha256'); h.update(D); for (const l of trecho) h.update(l)
  const s = h.digest('hex')
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20,32)}`
}

const rpc = async (fn, b, ms=180000) => {
  const t = Date.now()
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method:'POST', headers:H, body:JSON.stringify(b), signal: AbortSignal.timeout(ms) })
  const txt = await r.text()
  return { ms: Date.now()-t, ok: r.ok, status: r.status, body: txt }
}

const lotes = []
for (let i = 0; i < linhas.length; i += TAM) lotes.push(linhas.slice(i, i + TAM))
console.log(`arquivo: ${linhas.length} linhas | sha=${shaArquivo.slice(0,16)} | ${lotes.length} lote(s) de ate ${TAM}`)
if (!APLICAR) { console.log('\nENSAIO — nada foi enviado. Rode com --aplicar.'); lotes.forEach((t,i)=>console.log(`  lote ${i+1}: ${t.length} linhas nsr ${t[0].slice(0,9)}..${t[t.length-1].slice(0,9)} id=${loteId(t)}`)); process.exit(0) }

let totNovas=0, totMarc=0, totOrfas=0, falhas=0
for (const [i, trecho] of lotes.entries()) {
  const id = loteId(trecho)
  const r = await rpc('fn_ingerir_afd', {
    p_dispositivo_id: D, p_lote_id: id, p_linhas: trecho, p_canal: 'manual_ui',
    p_arquivo_sha256: shaArquivo, p_coletor_versao: 'recuperacao-manual',
    p_coletor_host: 'SMS-NTI', p_ip: null, p_importado_por: null, p_assinatura_ok: null,
  })
  if (!r.ok) { falhas++; console.log(`  lote ${i+1}/${lotes.length} FALHOU (${r.status}, ${r.ms}ms): ${r.body.slice(0,200)}`); continue }
  const d = JSON.parse(r.body)
  totNovas += d.novas||0; totMarc += d.marcacoes||0; totOrfas += d.orfas||0
  console.log(`  lote ${i+1}/${lotes.length} ${String(r.ms).padStart(6)}ms  novas=${d.novas} dup=${d.duplicadas} marcacoes=${d.marcacoes} orfas=${d.orfas} ${d.reenvio?'(reenvio)':''}`)
}
console.log(`\nTOTAL: novas=${totNovas} marcacoes=${totMarc} orfas=${totOrfas} falhas=${falhas}`)
