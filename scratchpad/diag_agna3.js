const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
const get = async q => { const r = await fetch(U + '/rest/v1/' + q, { headers: H }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); return r.json() }
const F = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second:'2-digit' }) : '-'
;(async () => {
  const [s] = await get('servidores?select=id&nome=like.AGNA*')
  const em = await get('escala_mensal?select=id&servidor_id=eq.' + s.id + '&mes=eq.8&ano=eq.2026')
  const ids = em.map(e => e.id).join(',')
  for (const dia of [3,4,10]) {
    const ed = await get('escala_diaria?select=categoria,dicionario_turnos(codigo),presenca_entrada_em,presenca_saida_em,presenca_entrada_manual,presenca_saida_manual,presenca_entrada_origem,presenca_saida_origem,presenca_entrada_marcacao_id,presenca_saida_marcacao_id&escala_mensal_id=in.(' + ids + ')&dia=eq.' + dia)
    console.log('\n--- dia ' + dia + ' ---')
    for (const d of ed) console.log('  ' + d.categoria.padEnd(8) + ' ' + (d.dicionario_turnos?.codigo||'-').padEnd(3) + ' ent=' + F(d.presenca_entrada_em) + ' man=' + d.presenca_entrada_manual + ' org=' + d.presenca_entrada_origem + ' mid=' + (d.presenca_entrada_marcacao_id?'sim':'nao') +
      ' | sai=' + F(d.presenca_saida_em) + ' man=' + d.presenca_saida_manual + ' org=' + d.presenca_saida_origem + ' mid=' + (d.presenca_saida_marcacao_id?'sim':'nao'))
    const data = '2026-08-' + String(dia).padStart(2,'0')
    const mp = await get('marcacoes_ponto?select=id,ocorrido_em,origem,sintetica,dispositivo_id,registrado_em,coordenador_id&servidor_id=eq.' + s.id + '&ocorrido_em=gte.' + data + '&ocorrido_em=lt.' + data + 'T23:59:59&order=ocorrido_em')
    for (const m of mp) console.log('   marc ' + F(m.ocorrido_em) + ' ' + m.origem + ' sint=' + m.sintetica + ' disp=' + (m.dispositivo_id?'s':'n') + ' criada=' + F(m.registrado_em) + ' coord=' + (m.coordenador_id?'sim':'nao'))
    const lt = await get('logs_tentativas_presenca?select=data_hora_tentativa,mensagem_erro&servidor_id=eq.' + s.id + '&data_hora_tentativa=gte.' + data + '&data_hora_tentativa=lt.' + data + 'T23:59:59&order=data_hora_tentativa')
    for (const l of lt) console.log('   RECUSADA ' + F(l.data_hora_tentativa) + ' :: ' + l.mensagem_erro)
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
