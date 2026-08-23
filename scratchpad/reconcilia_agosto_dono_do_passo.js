/**
 * ESCREVE EM PRODUCAO. Reconcilia SO os dias listados em reconciliar_agosto.json.
 *
 * NAO e reconciliacao em massa (memoria "nao-reconciliar-agosto-em-massa"): a lista sai do
 * portao scratchpad/portao_dono_do_passo.js, que so inclui dia em que a projecao DIVERGE do
 * gravado, e so entre os dias com 2+ turnos no mesmo dia.
 *
 * Antes de escrever, salva o estado atual das linhas em backup_reconciliacao_<ts>.json.
 * Reverter e reaplicar esse backup linha a linha por id.
 *
 * Uso:  node scratchpad/reconcilia_agosto_dono_do_passo.js --confirmar
 * Sem --confirmar, so mostra o que faria.
 */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
const get = async q => { const r = await fetch(U + '/rest/v1/' + q, { headers: H }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); return r.json() }
const rpc = async (f, b) => {
  const r = await fetch(U + '/rest/v1/rpc/' + f, { method: 'POST', headers: H, body: JSON.stringify(b) })
  if (!r.ok) throw new Error(f + ' ' + r.status + ' ' + await r.text())
  return r.json()
}
const F = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : ' -- '
const CONFIRMAR = process.argv.includes('--confirmar')
const CAMPOS = [
  'presenca_entrada_em', 'presenca_entrada_origem', 'presenca_entrada_marcacao_id', 'presenca_entrada_manual',
  'presenca_intervalo_saida_em', 'presenca_intervalo_saida_origem', 'presenca_intervalo_saida_marcacao_id', 'presenca_intervalo_saida_manual',
  'presenca_intervalo_retorno_em', 'presenca_intervalo_retorno_origem', 'presenca_intervalo_retorno_marcacao_id', 'presenca_intervalo_retorno_manual',
  'presenca_saida_em', 'presenca_saida_origem', 'presenca_saida_marcacao_id', 'presenca_saida_manual',
  'presenca_confirmada'
]

;(async () => {
  const lista = JSON.parse(fs.readFileSync(path.join(__dirname, 'reconciliar_agosto.json'), 'utf8'))
  console.log('Banco alvo: ' + U)
  console.log('dias a reconciliar: ' + lista.length + '   modo: ' + (CONFIRMAR ? 'ESCRITA' : 'ensaio (use --confirmar para gravar)'))

  // 1. backup do estado atual de TODAS as linhas dos dias envolvidos
  const backup = []
  for (const it of lista) {
    const em = await get('escala_mensal?select=id&servidor_id=eq.' + it.servidor_id + '&mes=eq.8&ano=eq.2026')
    if (!em.length) continue
    const linhas = await get('escala_diaria?select=id,dia,categoria,' + CAMPOS.join(',') +
      '&escala_mensal_id=in.(' + em.map(e => e.id).join(',') + ')&dia=eq.' + it.dia)
    for (const l of linhas) backup.push({ ...it, ...l })
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const arq = path.join(__dirname, 'backup_reconciliacao_' + stamp + '.json')
  fs.writeFileSync(arq, JSON.stringify(backup, null, 1))
  console.log('backup de ' + backup.length + ' linhas em ' + path.basename(arq))

  if (!CONFIRMAR) {
    console.log('\nensaio: nada foi gravado.')
    return
  }

  // 2. reconcilia dia a dia
  let ok = 0, falhas = 0, atualizadas = 0
  for (const it of lista) {
    try {
      const r = await rpc('fn_reconciliar_marcacoes_dia', { p_servidor_id: it.servidor_id, p_data: it.data })
      if (r && r.status === 'ok') { ok++; atualizadas += (r.atualizadas || 0) }
      else { falhas++; console.log('  ! ' + it.nome + ' ' + it.data + ': ' + JSON.stringify(r)) }
    } catch (e) { falhas++; console.log('  ! ' + it.nome + ' ' + it.data + ': ' + e.message.slice(0, 120)) }
  }
  console.log('\nreconciliados: ' + ok + ' dias (' + atualizadas + ' linhas)   falhas: ' + falhas)

  // 3. o que de fato mudou
  let mudou = 0
  for (const b of backup) {
    const [dep] = await get('escala_diaria?select=' + CAMPOS.join(',') + '&id=eq.' + b.id)
    if (!dep) continue
    const dif = CAMPOS.filter(c => String(b[c]) !== String(dep[c]))
    if (!dif.length) continue
    mudou++
    console.log('  ' + String(b.nome).slice(0, 26).padEnd(28) + ' d' + String(b.dia).padStart(2) + ' ' + String(b.categoria).padEnd(8) +
      '  ' + [b.presenca_entrada_em, b.presenca_intervalo_saida_em, b.presenca_intervalo_retorno_em, b.presenca_saida_em].map(F).join(' ') +
      '  ->  ' + [dep.presenca_entrada_em, dep.presenca_intervalo_saida_em, dep.presenca_intervalo_retorno_em, dep.presenca_saida_em].map(F).join(' '))
  }
  console.log('\nlinhas efetivamente alteradas: ' + mudou + ' de ' + backup.length)
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1) })
