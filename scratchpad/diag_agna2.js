const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
const get = async q => { const r = await fetch(U + '/rest/v1/' + q, { headers: H }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); return r.json() }
const F = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'
;(async () => {
  const cfg = await get('configuracoes_globais?select=chave,valor&chave=in.(rep_janela_duplicidade_segundos,rep_tolerancia_alocacao_minutos,timezone)')
  console.log('config:', JSON.stringify(cfg))
  const [s] = await get('servidores?select=id&nome=like.AGNA*')
  for (const dia of [3,4,10,13,14,17,20]) {
    const data = '2026-08-' + String(dia).padStart(2,'0')
    const mp = await get('marcacoes_ponto?select=id,ocorrido_em,origem,sintetica&servidor_id=eq.' + s.id + '&ocorrido_em=gte.' + data + '&ocorrido_em=lt.' + data + 'T23:59:59&order=ocorrido_em')
    console.log('dia ' + dia + ': ' + mp.map(m => F(m.ocorrido_em) + '/' + m.origem).join('  '))
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
