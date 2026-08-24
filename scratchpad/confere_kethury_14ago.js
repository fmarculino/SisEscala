/**
 * Antes/depois do dia 14/08/2026 da KETHURY: o que a folha guarda hoje e o que a leitura
 * corrigida (afastamentosDoDia) produziria. Leitura pura — nada e gravado.
 *
 *   npx tsc src/utils/folha/afastamentosDia.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *   node scratchpad/confere_kethury_14ago.js
 */
const fs = require('fs')
const { afastamentosDoDia, descreverAfastamentos, isShiftOverlappingAfastamento } = require('./_sim/afastamentosDia.js')

function lerEnv(p) {
  const out = {}
  if (!fs.existsSync(p)) return out
  for (const linha of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^([A-Z_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}
const env = { ...lerEnv('.env.production'), ...process.env }
const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY
if (!U || !K) { console.error('Faltam URL / SERVICE_ROLE_KEY no ambiente.'); process.exit(1) }
const H = { apikey: K, Authorization: `Bearer ${K}` }

const get = async (c) => {
  const r = await fetch(`${U}/rest/v1/${c}`, { headers: H })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

const FOLHA = '3d70d28c-417a-4293-bf68-b4973519c5f5'

;(async () => {
  const [folha] = await get(`folha_ponto?select=id,servidor_id,escala_mensal_id,mes,ano,status,registros&id=eq.${FOLHA}`)
  const sid = folha.servidor_id
  console.log(`folha ${folha.mes}/${folha.ano} status=${folha.status}\n`)

  const eventos = await get(
    `servidores_eventos?select=data_inicio,data_fim,slots,periodo_tipo,hora_inicio,hora_fim,minutos_afastamento,regime_abono,observacao,tipos_eventos(nome)` +
    `&servidor_id=eq.${sid}&data_inicio=lte.2026-08-31&data_fim=gte.2026-08-01&order=data_inicio`
  )
  console.log(`=== eventos de 08/2026 (${eventos.length}) ===`)
  for (const e of eventos) {
    const per = e.hora_inicio ? `${String(e.hora_inicio).substring(0,5)}-${String(e.hora_fim||'').substring(0,5)}`
                              : (e.slots && e.slots.length ? e.slots.join('/') : 'integral')
    console.log(`  ${e.data_inicio}..${e.data_fim}  ${(e.tipos_eventos?.nome || '?').padEnd(32)} [${per}] tipo=${e.periodo_tipo}`)
  }

  const diarias = await get(
    `escala_diaria?select=dia,categoria,dicionario_turnos(codigo,slots)&escala_mensal_id=eq.${folha.escala_mensal_id}&order=dia`
  )

  console.log('\n=== dias com mais de um evento: antes x depois ===')
  const registros = folha.registros || []
  for (let dia = 1; dia <= 31; dia++) {
    const dateStr = `2026-08-${String(dia).padStart(2, '0')}`
    const doDia = afastamentosDoDia(eventos, dateStr)
    if (doDia.length < 2) continue
    const shift = diarias.find(d => d.dia === dia && d.categoria === 'Regular') || null
    const anulantes = doDia.filter(a => isShiftOverlappingAfastamento(a, shift))
    const r = registros.find(x => Number(x.dia) === dia) || {}
    console.log(`  dia ${dia}: turno Regular = ${shift?.dicionario_turnos?.codigo || '(nenhum)'}`)
    console.log(`    folha HOJE   -> afastamento: ${JSON.stringify(r.afastamento)}`)
    console.log(`                    observacao : ${JSON.stringify(r.observacao)}`)
    const novoAf = anulantes.length > 0 ? descreverAfastamentos(anulantes) : null
    const base = r.turno_codigo ? '' : (new Date(2026, 7, dia).getDay() === 0 ? 'DOMINGO' : new Date(2026, 7, dia).getDay() === 6 ? 'SÁBADO' : 'FOLGA')
    const novaObs = novoAf
      ? String(novoAf).toUpperCase()
      : `AFASTAMENTO PARCIAL: ${descreverAfastamentos(doDia)}${base ? ' | ' + base : ''}`.toUpperCase()
    console.log(`    apos SINCRONIZAR -> afastamento: ${JSON.stringify(novoAf)}`)
    console.log(`                        observacao : ${JSON.stringify(novaObs)}`)
  }
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1) })
