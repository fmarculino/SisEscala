import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const q = async p => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); if(!r.ok){console.error(p,r.status,(await r.text()).slice(0,200));return []} return r.json() }

console.log('=== rep_cadastros_fila: ultimos enfileiramentos (o cron diario popula) ===')
console.table((await q('rep_cadastros_fila?select=criado_em,status&order=criado_em.desc&limit=5')).map(r=>({criado:r.criado_em,status:r.status})))

console.log('\n=== avisos_ponto_fila: total por status ===')
for (const st of ['pendente','enviado','falha','expirado','cancelado']) {
  const r = await fetch(`${U}/rest/v1/avisos_ponto_fila?select=id&status=eq.${st}`, { headers: { ...H, Prefer:'count=exact', Range:'0-0' } })
  console.log(' ', st.padEnd(10), r.headers.get('content-range'))
}

console.log('\n=== pendentes por tipo ===')
const pend = await q('avisos_ponto_fila?select=tipo,criado_em&status=eq.pendente&order=criado_em.asc&limit=1000')
const porTipo = {}
for (const p of pend) porTipo[p.tipo] = (porTipo[p.tipo]||0)+1
console.log(porTipo, '| mais antigo:', pend[0]?.criado_em, '| mais novo:', pend[pend.length-1]?.criado_em)

console.log('\n=== servidores em pendente_confirmacao (travados esperando a mensagem) ===')
const trav = await q('servidores?select=nome,matricula,aviso_ponto_status,aviso_ponto_canal,aviso_ponto_definido_em,aviso_ponto_expira_em&aviso_ponto_status=eq.pendente_confirmacao&order=aviso_ponto_definido_em.desc')
console.table(trav.map(s=>({nome:s.nome.slice(0,30),mat:s.matricula,canal:s.aviso_ponto_canal,definido:s.aviso_ponto_definido_em,expira:s.aviso_ponto_expira_em})))

console.log('\n=== servidores com aviso ATIVO (por canal) ===')
const ativos = await q('servidores?select=aviso_ponto_canal&aviso_ponto_status=eq.ativo')
const porCanal = {}; for (const a of ativos) porCanal[a.aviso_ponto_canal||'(null)'] = (porCanal[a.aviso_ponto_canal||'(null)']||0)+1
console.log(porCanal, '| total ativos:', ativos.length)
