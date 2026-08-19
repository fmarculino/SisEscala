/**
 * Portao da migration 20260819180000 (regra do dono + piso de meia-noite).
 *
 *   node scratchpad/portao_dono_piso.js            -> SO LEITURA (dry-run). Nao escreve nada.
 *   node scratchpad/portao_dono_piso.js --aplicar  -> ESCREVE: reconcilia os dias divergentes.
 *
 * O dry-run usa fn_conferir_reconciliacao, que compara o que esta gravado em escala_diaria com
 * o que a projecao (ja com a funcao nova) produziria — sem escrever. Rodar ANTES de --aplicar e
 * ler a lista: reconciliar mexe em ponto ja projetado.
 *
 * Datas por argumento: --de=2026-08-01 --ate=2026-08-31 (default: mes corrente de agosto/2026).
 */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
const rpc = async (fn, b) => { const r = await fetch(U + '/rest/v1/rpc/' + fn, { method: 'POST', headers: H, body: JSON.stringify(b) }); if (!r.ok) throw new Error(fn + ' ' + r.status + ' ' + await r.text()); return r.json() }
const pag = async r0 => { const o = []; for (let f = 0; ; f += 1000) { const r = await fetch(U + '/rest/v1/' + r0, { headers: { ...H, Range: `${f}-${f + 999}` } }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); const p = await r.json(); o.push(...p); if (p.length < 1000) break } return o }
const F = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'

const arg = n => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : null }
const APLICAR = process.argv.includes('--aplicar')
const DE = arg('de') || '2026-08-01'
const ATE = arg('ate') || '2026-08-31'

;(async () => {
  console.log((APLICAR ? 'APLICAR (ESCREVE)' : 'DRY-RUN (so leitura)') + '  ' + DE + ' .. ' + ATE)
  console.log('banco: ' + U + '\n')

  const em = await pag('escala_mensal?select=servidor_id&ano=eq.2026&mes=eq.' + Number(DE.slice(5, 7)))
  const servidores = Array.from(new Set(em.map(e => e.servidor_id).filter(Boolean)))
  const serv = await pag('servidores?select=id,nome')
  const SN = new Map(serv.map(s => [s.id, s.nome]))
  console.log('servidores com escala no periodo: ' + servidores.length)

  const divs = []
  let erros = 0
  for (const sid of servidores) {
    try {
      const r = await rpc('fn_conferir_reconciliacao', { p_data_inicio: DE, p_data_fim: ATE, p_servidor_id: sid })
      divs.push(...r)
    } catch (e) { erros++; console.error('  ! ' + (SN.get(sid) || sid) + ': ' + e.message.slice(0, 120)) }
  }

  const porTipo = {}
  for (const d of divs) porTipo[d.tipo_divergencia] = (porTipo[d.tipo_divergencia] || 0) + 1
  const dias = new Map()
  for (const d of divs) {
    const k = d.servidor_id + '|' + d.data
    if (!dias.has(k)) dias.set(k, [])
    dias.get(k).push(d)
  }

  console.log('\ndivergencias: ' + divs.length + ' em ' + dias.size + ' dias' + (erros ? '  (' + erros + ' servidores com erro)' : ''))
  for (const t of Object.keys(porTipo).sort()) console.log('   ' + t + ': ' + porTipo[t])

  console.log('\nprimeiros 25 dias divergentes:')
  let n = 0
  for (const [k, lista] of dias) {
    if (n++ >= 25) break
    const [sid, data] = k.split('|')
    console.log('  ' + (SN.get(sid) || sid) + ' ' + data)
    for (const d of lista) console.log('      ' + d.campo.padEnd(18) + ' gravado ' + F(d.valor_atual).padEnd(16) + ' -> projetado ' + F(d.valor_projetado).padEnd(16) + ' [' + d.tipo_divergencia + ']')
  }

  if (!APLICAR) { console.log('\nDRY-RUN: nada foi escrito. Rode com --aplicar para reconciliar estes dias.'); return }

  console.log('\nreconciliando ' + dias.size + ' dias...')
  let ok = 0, falhou = 0
  for (const k of dias.keys()) {
    const [sid, data] = k.split('|')
    try { await rpc('fn_reconciliar_marcacoes_dia', { p_servidor_id: sid, p_data: data }); ok++ }
    catch (e) { falhou++; console.error('  ! ' + (SN.get(sid) || sid) + ' ' + data + ': ' + e.message.slice(0, 120)) }
  }
  console.log('reconciliados: ' + ok + ' | falhas: ' + falhou)
  console.log('\nATENCAO: escala_diaria foi atualizada. A folha_ponto ja gerada NAO se atualiza sozinha —')
  console.log('use "Sincronizar" na folha do servidor para a folha refletir o novo horario.')
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
