/** SO LEITURA. Casos suspeitos depois da reconciliacao + varredura de inversao no GRAVADO. */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
const get = async q => { const r = await fetch(U + '/rest/v1/' + q, { headers: H }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); return r.json() }
const rpc = async (f, b) => { const r = await fetch(U + '/rest/v1/rpc/' + f, { method: 'POST', headers: H, body: JSON.stringify(b) }); if (!r.ok) throw new Error(f + ' ' + r.status + ' ' + await r.text()); return r.json() }
const F = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '  --  '
const COL = ['presenca_entrada_em', 'presenca_intervalo_saida_em', 'presenca_intervalo_retorno_em', 'presenca_saida_em']

const CASOS = [
  ['61558', 8, 5, 'MAYARA — folha dizia 13:00->15:00'],
  ['37332', 8, 3, 'MARCOS — perdeu a saida 22:00'],
  ['68782', 8, 20, 'IZABELLA — ganhou 2h06 de extra'],
]

;(async () => {
  for (const [mat, mes, dia, rot] of CASOS) {
    const [s] = await get('servidores?select=id,nome&matricula=eq.' + mat)
    if (!s) { console.log('\n### ' + rot + ' — matricula ' + mat + ' nao achada'); continue }
    const data = '2026-0' + mes + '-' + String(dia).padStart(2, '0')
    const em = await get('escala_mensal?select=id,unidade_id,jornadas(nome)&servidor_id=eq.' + s.id + '&mes=eq.' + mes + '&ano=eq.2026')
    const ed = await get('escala_diaria?select=id,categoria,escala_mensal_id,dicionario_turnos(codigo,horas_computadas),' + COL.join(',') +
      '&escala_mensal_id=in.(' + em.map(e => e.id).join(',') + ')&dia=eq.' + dia)
    const blocos = await rpc('fn_blocos_previstos_dia', { p_servidor_id: s.id, p_data: data })
    const marc = await get('marcacoes_ponto?select=ocorrido_em,origem,sintetica&servidor_id=eq.' + s.id +
      '&ocorrido_em=gte.' + data + '&ocorrido_em=lt.2026-0' + mes + '-' + String(dia + 1).padStart(2, '0') + '&order=ocorrido_em')
    console.log('\n### ' + rot + '  (' + s.nome + ', ' + data + ')')
    for (const e of em) console.log('   escala: jornada ' + (e.jornadas && e.jornadas.nome) + ' unidade ' + e.unidade_id.slice(0, 8))
    console.log('   batidas do dia: ' + (marc.map(m => F(m.ocorrido_em).slice(4) + '/' + m.origem + (m.sintetica ? '*' : '')).join('  ') || '(nenhuma)'))
    for (const b of blocos) console.log('   bloco' + b.bloco_ordem + ' ' + b.categoria + ' ' + F(b.inicio_previsto) + '->' + F(b.fim_previsto) +
      '  turnos: ' + (b.turnos_inicio || []).map((v, k) => F(v) + '-' + F((b.turnos_fim || [])[k])).join(' | '))
    for (const d of ed) console.log('   ' + String(d.categoria).padEnd(8) + ' ' + String(d.dicionario_turnos && d.dicionario_turnos.codigo || '-').padEnd(4) +
      ' un ' + String(em.find(e => e.id === d.escala_mensal_id).unidade_id).slice(0, 8) + '  ' + COL.map(c => F(d[c])).join(' '))
  }

  // varredura: inversao no GRAVADO, agosto inteiro
  console.log('\n\n### VARREDURA DE INVERSAO NO GRAVADO (08/2026, todas as linhas)')
  const out = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(U + '/rest/v1/escala_diaria?select=id,dia,categoria,escala_mensal_id,' + COL.join(',') + '&order=id',
      { headers: { ...H, Range: f + '-' + (f + 999) } })
    const p = await r.json(); out.push(...p); if (p.length < 1000) break
  }
  const emAll = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(U + '/rest/v1/escala_mensal?select=id,servidor_id&mes=eq.8&ano=eq.2026&order=id', { headers: { ...H, Range: f + '-' + (f + 999) } })
    const p = await r.json(); emAll.push(...p); if (p.length < 1000) break
  }
  const ok = new Set(emAll.map(e => e.id))
  let inv = 0, vistos = 0
  for (const l of out) {
    if (!ok.has(l.escala_mensal_id)) continue
    vistos++
    const ts = COL.map(c => l[c] ? new Date(l[c]).getTime() : null)
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] === null) continue
      const ant = ts.slice(0, i).filter(x => x !== null).pop()
      if (ant !== undefined && ts[i] < ant) { inv++; console.log('   INVERTIDA: dia ' + l.dia + ' ' + l.categoria + ' ' + ts.map((x, k) => F(l[COL[k]])).join(' ')); break }
    }
  }
  console.log('   linhas de 08/2026 conferidas: ' + vistos + ' | invertidas: ' + inv)
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1) })
