/**
 * SO LEITURA + SIMULACAO EM MEMORIA. Nao escreve nada.
 *
 * C1 = passo do BLOCO so vai para a linha do turno a que ele pertence
 *      (entrada -> primeiro turno; saida -> ultimo turno; intervalo -> turno que o contem).
 * C2 = batida unica na fronteira espelha para o slot irmao vazio.
 */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
async function page(q) { q += (q.includes('?') ? '&' : '?') + 'order=id'; const out = []; for (let f = 0; ; f += 1000) { const r = await fetch(U + '/rest/v1/' + q, { headers: { ...H, Range: `${f}-${f + 999}` } }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); const p = await r.json(); out.push(...p); if (p.length < 1000) break } return out }
const rpc = async (f, b) => { const r = await fetch(U + '/rest/v1/rpc/' + f, { method: 'POST', headers: H, body: JSON.stringify(b) }); if (!r.ok) throw new Error(f + ' ' + r.status + ' ' + await r.text()); return r.json() }
const F = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : ' -- '
const PASSOS = ['entrada', 'intervalo_saida', 'intervalo_retorno', 'saida']
const COL = { entrada: 'presenca_entrada_em', intervalo_saida: 'presenca_intervalo_saida_em', intervalo_retorno: 'presenca_intervalo_retorno_em', saida: 'presenca_saida_em' }

;(async () => {
  const em = await page('escala_mensal?select=id,servidor_id,unidade_id&mes=eq.8&ano=eq.2026')
  const byEm = new Map(em.map(e => [e.id, e]))
  const ed = await page('escala_diaria?select=id,escala_mensal_id,dia,categoria,dicionario_turnos(codigo),presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em')
  const grupos = new Map()
  for (const d of ed) {
    const e = byEm.get(d.escala_mensal_id); if (!e) continue
    const k = e.servidor_id + '|' + d.dia
    if (!grupos.has(k)) grupos.set(k, { sid: e.servidor_id, dia: d.dia, linhas: [] })
    grupos.get(k).linhas.push(d)
  }
  const alvo = [...grupos.values()].filter(g => g.linhas.filter(l => l.categoria !== 'Sobreaviso').length >= 2)
  console.log('dias com 2+ turnos: ' + alvo.length)

  const servIds = [...new Set(alvo.map(a => a.sid))]
  const servs = []
  for (let i = 0; i < servIds.length; i += 100) servs.push(...await page('servidores?select=id,nome,matricula&id=in.(' + servIds.slice(i, i + 100).join(',') + ')'))
  const N = new Map(servs.map(s => [s.id, s]))

  const mudancas = []
  let erros = 0, blocosMulti = 0, espelhados = 0
  for (const g of alvo) {
    const data = '2026-08-' + String(g.dia).padStart(2, '0')
    let blocos, aloc
    try { blocos = await rpc('fn_blocos_previstos_dia', { p_servidor_id: g.sid, p_data: data }); aloc = await rpc('fn_alocar_marcacoes_dia', { p_servidor_id: g.sid, p_data: data }) }
    catch (e) { erros++; continue }
    if (!blocos.some(b => (b.escala_diaria_ids || []).length > 1)) continue
    blocosMulti++

    // mapa: escala_diaria_id -> {ini, fim} do SEU turno; e ordem dentro do bloco
    const turnoDe = new Map()
    for (const b of blocos) {
      const ids = b.escala_diaria_ids || []
      ids.forEach((id, i) => turnoDe.set(id, { ini: b.turnos_inicio?.[i], fim: b.turnos_fim?.[i], primeiro: i === 0, ultimo: i === ids.length - 1, bloco: b.bloco_ordem }))
    }

    // --- reproduz a projecao ATUAL (C0) e a NOVA (C1+C2)
    const alocs = (aloc.alocacoes || []).slice()

    // C2: espelha fronteira solitaria
    const fronts = alocs.filter(a => a.fronteira)
    for (const b of blocos) {
      const ids = b.escala_diaria_ids || []
      for (let i = 0; i < ids.length - 1; i++) {
        const saiI = fronts.find(a => a.passo === 'saida' && a.escala_diaria_ids?.[0] === ids[i])
        const entJ = fronts.find(a => a.passo === 'entrada' && a.escala_diaria_ids?.[0] === ids[i + 1])
        if (saiI && !entJ) { alocs.push({ ...saiI, passo: 'entrada', escala_diaria_ids: [ids[i + 1]], espelhada: true }); espelhados++ }
        else if (entJ && !saiI) { alocs.push({ ...entJ, passo: 'saida', escala_diaria_ids: [ids[i]], espelhada: true }); espelhados++ }
      }
    }

    const marcIds = [...new Set(alocs.map(a => a.marcacao_id))]
    if (!marcIds.length) continue
    const marcs = await page('marcacoes_ponto?select=id,ocorrido_em,origem&id=in.(' + marcIds.join(',') + ')')
    const M = new Map(marcs.map(m => [m.id, m]))

    const proj = new Map()  // ed_id -> {passo: {ts, fronteira}}
    for (const a of alocs) {
      const m = M.get(a.marcacao_id); if (!m) continue
      for (const id of (a.escala_diaria_ids || [])) {
        const t = turnoDe.get(id)
        // C1: passo do bloco so vai para a linha do turno dono
        if (!a.fronteira && t) {
          if (a.passo === 'entrada' && !t.primeiro) continue
          if (a.passo === 'saida' && !t.ultimo) continue
          if (a.passo.startsWith('intervalo') && t.ini && t.fim) {
            const p = new Date(a.previsto).getTime()
            if (!(p >= new Date(t.ini).getTime() && p <= new Date(t.fim).getTime())) continue
          }
        }
        if (!proj.has(id)) proj.set(id, {})
        const cur = proj.get(id)[a.passo]
        if (!cur || (a.fronteira && !cur.fronteira)) proj.get(id)[a.passo] = { ts: m.ocorrido_em, fronteira: !!a.fronteira }
      }
    }

    for (const l of g.linhas) {
      if (l.categoria === 'Sobreaviso') continue
      const novo = proj.get(l.id) || {}
      const antes = PASSOS.map(p => l[COL[p]] ? new Date(l[COL[p]]).toISOString() : null)
      const depois = PASSOS.map(p => novo[p] ? new Date(novo[p].ts).toISOString() : null)
      if (JSON.stringify(antes) !== JSON.stringify(depois)) {
        mudancas.push({ sid: g.sid, dia: g.dia, cat: l.categoria, cod: l.dicionario_turnos?.codigo, antes, depois })
      }
    }
  }
  console.log('blocos com 2+ turnos fundidos: ' + blocosMulti + ' dias | erros RPC: ' + erros + ' | fronteiras espelhadas: ' + espelhados)
  console.log('LINHAS que mudam: ' + mudancas.length)

  const porServ = new Map()
  for (const m of mudancas) { if (!porServ.has(m.sid)) porServ.set(m.sid, []); porServ.get(m.sid).push(m) }
  console.log('servidores afetados: ' + porServ.size + '\n')
  const tipo = { perdePasso: 0, ganhaPasso: 0, trocaPasso: 0 }
  for (const m of mudancas) {
    const perdeu = m.antes.filter((a, i) => a && !m.depois[i]).length
    const ganhou = m.depois.filter((d, i) => d && !m.antes[i]).length
    if (perdeu && ganhou) tipo.trocaPasso++; else if (perdeu) tipo.perdePasso++; else tipo.ganhaPasso++
  }
  console.log(JSON.stringify(tipo))
  for (const [sid, arr] of [...porServ.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const s = N.get(sid)
    console.log('\n' + (s?.nome || sid) + '  mat ' + (s?.matricula || '-') + '  (' + arr.length + ' linhas)')
    for (const m of arr.sort((a, b) => a.dia - b.dia).slice(0, 40))
    for (const m of arr.sort((a, b) => a.dia - b.dia).slice(0, 40))
      console.log('   dia ' + String(m.dia).padStart(2) + ' ' + String(m.cat).padEnd(8) + ' ' + String(m.cod || '-').padEnd(4) + ' antes: ' + m.antes.map(F).join(' ') + '  ->  depois: ' + m.depois.map(F).join(' '))
  }
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1) })
