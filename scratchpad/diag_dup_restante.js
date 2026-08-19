/** SO LEITURA. Detalha uma duplicacao remanescente: quais blocos, quais batidas, o que cada p_data aloca. */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
const get = async q => { const r = await fetch(U + '/rest/v1/' + q, { headers: H }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); return r.json() }
const rpc = async (fn, b) => { const r = await fetch(U + '/rest/v1/rpc/' + fn, { method: 'POST', headers: H, body: JSON.stringify(b) }); if (!r.ok) throw new Error(fn + ' ' + r.status + ' ' + await r.text()); return r.json() }
const F = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'

;(async () => {
  const nome = process.argv[2] || 'MARCOS SOUSA SANTOS'
  const [s] = await get('servidores?select=id,nome,ignora_janela_presenca&nome=eq.' + encodeURIComponent(nome))
  console.log(s.nome, '| ignora_janela_presenca =', s.ignora_janela_presenca)
  const marcs = process.argv.slice(3)
  const mp = await get('marcacoes_ponto?select=id,ocorrido_em,origem&servidor_id=eq.' + s.id + '&ocorrido_em=gte.2026-08-01&ocorrido_em=lt.2026-09-01&order=ocorrido_em')
  const alvo = marcs.length ? mp.filter(m => marcs.includes(m.id)) : []
  console.log('\nbatidas em foco:')
  for (const m of alvo) console.log('   ', F(m.ocorrido_em), m.origem, m.id)
  const dias = new Set()
  for (const m of alvo) {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(m.ocorrido_em))
    dias.add(d)
    const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); dias.add(x.toISOString().slice(0, 10))
    const y = new Date(d + 'T12:00:00Z'); y.setUTCDate(y.getUTCDate() + 1); dias.add(y.toISOString().slice(0, 10))
  }
  for (const d of Array.from(dias).sort()) {
    const b = await rpc('fn_blocos_previstos_dia', { p_servidor_id: s.id, p_data: d })
    console.log('\n=== ' + d)
    for (const x of b) console.log('   bloco ' + x.bloco_ordem + ' ' + x.categoria + ' ' + F(x.inicio_previsto) + ' -> ' + F(x.fim_previsto) + ' int ' + F(x.intervalo_inicio_previsto) + '/' + F(x.intervalo_fim_previsto) + ' ed=' + (x.escala_diaria_ids || []).join(','))
    const a = await rpc('fn_alocar_marcacoes_dia', { p_servidor_id: s.id, p_data: d })
    for (const x of a.alocacoes) console.log('     ALOC ' + x.passo.padEnd(18) + ' prev ' + F(x.previsto) + ' dist ' + String(x.distancia_min).padStart(4) + ' marc ' + x.marcacao_id + (alvo.some(m => m.id === x.marcacao_id) ? '   <<< EM FOCO' : ''))
    for (const x of a.pendencias) if (x.tipo !== 'passo_sem_marcacao') console.log('     PEND ' + x.tipo + ' ' + F(x.ocorrido_em))
  }
  console.log('\nbatidas do periodo:')
  for (const m of mp) console.log('   ', F(m.ocorrido_em), m.origem, m.id)
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
