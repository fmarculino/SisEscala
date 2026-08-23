/**
 * SO LEITURA. Portao da 20260823100000 sobre 08/2026 inteiro, em PRODUCAO.
 *
 *   - varre TODO dia com 2+ turnos no mesmo dia (nao so os de bloco fundido)
 *   - compara escala_diaria gravada x fn_projecao_marcacoes_dia (ja com a migration)
 *   - recusa se a projecao produzir passo INVERTIDO ou duracao impossivel
 *   - grava a lista de dias a reconciliar em scratchpad/reconciliar_agosto.json
 *
 * Nao escreve no banco.
 */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
async function page(q) {
  q += (q.includes('?') ? '&' : '?') + 'order=id'
  const out = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(U + '/rest/v1/' + q, { headers: { ...H, Range: f + '-' + (f + 999) } })
    if (!r.ok) throw new Error(r.status + ' ' + await r.text())
    const p = await r.json(); out.push(...p); if (p.length < 1000) break
  }
  return out
}
const rpc = async (f, b) => {
  const r = await fetch(U + '/rest/v1/rpc/' + f, { method: 'POST', headers: H, body: JSON.stringify(b) })
  if (!r.ok) throw new Error(f + ' ' + r.status + ' ' + await r.text())
  return r.json()
}
const F = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : ' -- '
const COL = ['presenca_entrada_em', 'presenca_intervalo_saida_em', 'presenca_intervalo_retorno_em', 'presenca_saida_em']
const PRJ = ['entrada_em', 'int_saida_em', 'int_ret_em', 'saida_em']

;(async () => {
  const em = await page('escala_mensal?select=id,servidor_id&mes=eq.8&ano=eq.2026')
  const byEm = new Map(em.map(e => [e.id, e.servidor_id]))
  const ed = await page('escala_diaria?select=id,escala_mensal_id,dia,categoria,dicionario_turnos(codigo),' + COL.join(','))
  const grupos = new Map()
  for (const d of ed) {
    const sid = byEm.get(d.escala_mensal_id); if (!sid) continue
    const k = sid + '|' + d.dia
    if (!grupos.has(k)) grupos.set(k, { sid, dia: d.dia, linhas: [] })
    grupos.get(k).linhas.push(d)
  }
  const alvo = [...grupos.values()].filter(g => g.linhas.filter(l => l.categoria !== 'Sobreaviso').length >= 2)
  console.log('dias com 2+ turnos em 08/2026: ' + alvo.length)

  const sids = [...new Set(alvo.map(a => a.sid))]
  const servs = []
  for (let i = 0; i < sids.length; i += 100) servs.push(...await page('servidores?select=id,nome,matricula&id=in.(' + sids.slice(i, i + 100).join(',') + ')'))
  const N = new Map(servs.map(s => [s.id, s]))

  const problemas = []
  const reconciliar = []
  const mudancas = []
  let erros = 0

  for (const g of alvo) {
    const data = '2026-08-' + String(g.dia).padStart(2, '0')
    let proj
    try { proj = await rpc('fn_projecao_marcacoes_dia', { p_servidor_id: g.sid, p_data: data }) }
    catch (e) { erros++; continue }
    const P = new Map(proj.map(p => [p.escala_diaria_id, p]))

    let diaMuda = false
    for (const l of g.linhas) {
      if (l.categoria === 'Sobreaviso') continue
      const p = P.get(l.id)
      const antes = COL.map(c => l[c] ? new Date(l[c]).toISOString() : null)
      const depois = p ? PRJ.map(c => p[c] ? new Date(p[c]).toISOString() : null) : antes
      if (JSON.stringify(antes) !== JSON.stringify(depois)) {
        diaMuda = true
        mudancas.push({ sid: g.sid, dia: g.dia, cat: l.categoria, cod: l.dicionario_turnos && l.dicionario_turnos.codigo, antes, depois })
      }
      // portao: cronologia da linha PROJETADA
      const ts = depois.map(x => x ? new Date(x).getTime() : null)
      const preenchidos = ts.filter(x => x !== null)
      for (let i = 1; i < ts.length; i++) {
        if (ts[i] === null) continue
        const ant = ts.slice(0, i).filter(x => x !== null).pop()
        if (ant !== undefined && ts[i] < ant) {
          problemas.push({ tipo: 'invertido', sid: g.sid, dia: g.dia, cat: l.categoria, depois })
          break
        }
      }
      if (preenchidos.length >= 2) {
        const dur = (Math.max(...preenchidos) - Math.min(...preenchidos)) / 3600000
        if (dur > 24.5) problemas.push({ tipo: 'duracao_' + dur.toFixed(1) + 'h', sid: g.sid, dia: g.dia, cat: l.categoria, depois })
      }
    }
    if (diaMuda) reconciliar.push({ servidor_id: g.sid, data, dia: g.dia, nome: N.get(g.sid) && N.get(g.sid).nome, matricula: N.get(g.sid) && N.get(g.sid).matricula })
  }

  console.log('erros de RPC: ' + erros)
  console.log('')
  console.log('### PORTAO')
  if (problemas.length === 0) {
    console.log('  OK — 0 linhas invertidas, 0 duracoes impossiveis na projecao.')
  } else {
    console.log('  RECUSADO — ' + problemas.length + ' problema(s):')
    for (const p of problemas.slice(0, 30))
      console.log('    ' + p.tipo + '  ' + (N.get(p.sid) && N.get(p.sid).nome) + ' dia ' + p.dia + ' ' + p.cat + '  ' + p.depois.map(F).join(' '))
  }
  console.log('')
  console.log('### A RECONCILIAR: ' + reconciliar.length + ' dias, ' + new Set(reconciliar.map(r => r.servidor_id)).size + ' servidores, ' + mudancas.length + ' linhas')
  const porServ = new Map()
  for (const r of reconciliar) { if (!porServ.has(r.servidor_id)) porServ.set(r.servidor_id, []); porServ.get(r.servidor_id).push(r.dia) }
  for (const [sid, dias] of [...porServ.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const s = N.get(sid)
    console.log('  ' + String(s && s.nome).slice(0, 34).padEnd(36) + ' mat ' + String(s && s.matricula).padEnd(7) + String(dias.length).padStart(3) + ' dias: ' + dias.sort((a, b) => a - b).join(','))
  }
  fs.writeFileSync(path.join(__dirname, 'reconciliar_agosto.json'), JSON.stringify(reconciliar, null, 1))
  console.log('')
  console.log('lista gravada em scratchpad/reconciliar_agosto.json')
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1) })
