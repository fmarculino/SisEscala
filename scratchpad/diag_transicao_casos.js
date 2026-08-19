/** SO LEITURA. Compara, POR LINHA de escala_diaria, o gravado x o projetado com a batida de transicao. */
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

const CASOS = [
  ['MAISA MIRANDA BASTOS ATAIDE', '2026-08-03'],
  ['MAISA MIRANDA BASTOS ATAIDE', '2026-08-18'],
  ['LUANA GONÇALVES NÓBREGA', '2026-08-03'],
  ['EIRELLE LINA SALES DOS SANTOS CRUZ', '2026-08-17'],
  ['ANA KAROLINE DA SILVA TAVARES', '2026-08-17'],
]

;(async () => {
  for (const [nome, data] of CASOS) {
    const [s] = await get('servidores?select=id,nome&nome=eq.' + encodeURIComponent(nome))
    if (!s) { console.log('\n### ' + nome + ' NAO ENCONTRADO'); continue }
    const dia = Number(data.slice(8, 10))
    const em = await get('escala_mensal?select=id&servidor_id=eq.' + s.id + '&mes=eq.8&ano=eq.2026')
    const ids = em.map(e => e.id)
    const ed = await get('escala_diaria?select=id,categoria,dicionario_turnos(codigo),presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em&escala_mensal_id=in.(' + ids.join(',') + ')&dia=eq.' + dia)
    const proj = await rpc('fn_projecao_marcacoes_dia', { p_servidor_id: s.id, p_data: data })
    const P = new Map(proj.map(p => [p.escala_diaria_id, p]))
    const mp = await get('marcacoes_ponto?select=ocorrido_em,origem&servidor_id=eq.' + s.id + '&ocorrido_em=gte.' + data + '&ocorrido_em=lt.' + data + 'T23:59:59&order=ocorrido_em')
    const b = await rpc('fn_blocos_previstos_dia', { p_servidor_id: s.id, p_data: data })

    console.log('\n### ' + s.nome + '  ' + data)
    console.log('  batidas: ' + (mp.map(m => F(m.ocorrido_em) + '/' + m.origem).join('  ') || '(nenhuma)'))
    for (const x of b) console.log('  bloco ' + x.bloco_ordem + ' ' + x.categoria + ' ' + F(x.inicio_previsto) + '->' + F(x.fim_previsto) +
      '  turnos: ' + (x.turnos_inicio || []).map((v, k) => F(v) + '-' + F((x.turnos_fim || [])[k])).join(' | '))
    for (const d of ed) {
      const p = P.get(d.id)
      const g = [d.presenca_entrada_em, d.presenca_intervalo_saida_em, d.presenca_intervalo_retorno_em, d.presenca_saida_em].map(F).join(' ')
      const n = p ? [p.entrada_em, p.int_saida_em, p.int_ret_em, p.saida_em].map(F).join(' ') : '(linha sem projecao — ficaria como esta)'
      console.log('  ' + String(d.categoria).padEnd(9) + ' ' + String(d.dicionario_turnos?.codigo || '-').padEnd(4) +
        '  gravado: ' + g + '   ->   projetado: ' + n)
    }
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
