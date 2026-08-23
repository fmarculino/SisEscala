/** SO LEITURA. Caso AGNA — Regular M 08-14 emendado com Plantao T. */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
const get = async q => { const r = await fetch(U + '/rest/v1/' + q, { headers: H }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); return r.json() }
const rpc = async (f, b) => { const r = await fetch(U + '/rest/v1/rpc/' + f, { method: 'POST', headers: H, body: JSON.stringify(b) }); if (!r.ok) throw new Error(f + ' ' + r.status + ' ' + await r.text()); return r.json() }
const F = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '  -  '

;(async () => {
  const [s] = await get('servidores?select=id,nome,matricula,unidade_id,setor_id&nome=like.AGNA*')
  console.log('servidor:', s.nome, s.matricula, s.id)
  const em = await get('escala_mensal?select=id,jornada_id,unidade_id,setor_id,jornadas(nome,horas_totais,intervalo_minutos,intervalo_inicio_padrao,intervalo_fim_padrao)&servidor_id=eq.' + s.id + '&mes=eq.8&ano=eq.2026')
  for (const e of em) console.log('escala_mensal:', e.id, JSON.stringify(e.jornadas), 'un=' + e.unidade_id, 'set=' + e.setor_id)
  const ids = em.map(e => e.id)
  const ed = await get('escala_diaria?select=id,dia,categoria,hora_inicio_prevista,dicionario_turnos(codigo,horario_inicio,horas_computadas,intervalo_minutos),presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em,presenca_entrada_origem,presenca_saida_origem&escala_mensal_id=in.(' + ids.join(',') + ')&order=dia')
  const un = await get('unidades?select=id,nome,permite_marca_intervalo,tipo_intervalo,fonte_ponto_oficial&id=eq.' + em[0].unidade_id)
  console.log('unidade:', JSON.stringify(un[0]))

  for (let dia = 1; dia <= 22; dia++) {
    const linhas = ed.filter(x => x.dia === dia)
    if (!linhas.length) continue
    const data = '2026-08-' + String(dia).padStart(2, '0')
    const b = await rpc('fn_blocos_previstos_dia', { p_servidor_id: s.id, p_data: data })
    const mp = await get('marcacoes_ponto?select=ocorrido_em,origem&servidor_id=eq.' + s.id + '&ocorrido_em=gte.' + data + '&ocorrido_em=lt.' + data + 'T23:59:59&order=ocorrido_em')
    console.log('\n--- dia ' + dia + ' ---')
    console.log('  batidas: ' + (mp.map(m => F(m.ocorrido_em) + '/' + m.origem).join('  ') || '(nenhuma)'))
    for (const x of b) console.log('  bloco' + x.bloco_ordem + ' ' + x.categoria + ' ' + F(x.inicio_previsto) + '->' + F(x.fim_previsto) +
      ' int=' + F(x.intervalo_inicio_previsto) + '/' + F(x.intervalo_fim_previsto) + ' permInt=' + x.permite_intervalo +
      ' turnos: ' + (x.turnos_inicio || []).map((v, k) => F(v) + '-' + F((x.turnos_fim || [])[k])).join(' | '))
    for (const d of linhas) console.log('  ' + String(d.categoria).padEnd(8) + ' ' + String(d.dicionario_turnos?.codigo || '-').padEnd(4) +
      ' dicIni=' + (d.dicionario_turnos?.horario_inicio || '-') + ' hc=' + (d.dicionario_turnos?.horas_computadas ?? '-') +
      ' hIniPrev=' + (d.hora_inicio_prevista || '-') +
      ' | gravado: ' + [d.presenca_entrada_em, d.presenca_intervalo_saida_em, d.presenca_intervalo_retorno_em, d.presenca_saida_em].map(F).join(' ') +
      ' orig=' + (d.presenca_entrada_origem || '-') + '/' + (d.presenca_saida_origem || '-'))
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
