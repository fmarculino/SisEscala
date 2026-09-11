import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const q = async p => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); if(!r.ok){console.error(p,r.status,(await r.text()).slice(0,200));return []} return r.json() }
let falhou = false
const ok = (cond, msg) => { console.log((cond?'  OK   ':'  FALHA') + '  ' + msg); if(!cond) falhou = true }

console.log('agora UTC:', new Date().toISOString())
console.log('\n=== FILA PENDENTE ===')
const pend = await q('avisos_ponto_fila?select=tipo,canal,destino,tentativas,criado_em&status=eq.pendente&order=criado_em.asc')
console.table(pend.map(f=>({tipo:f.tipo,canal:f.canal,destino:f.destino||'(null)',tent:f.tentativas,criado:f.criado_em?.slice(0,19)})))

console.log('\n=== ASSERCOES ===')
const optinPend = pend.filter(f=>f.tipo==='confirmacao_optin')
ok(optinPend.length === 4, `4 confirmacoes de opt-in pendentes (achou ${optinPend.length})`)
ok(optinPend.every(f=>f.canal==='whatsapp' && /^\d{10,13}$/.test(f.destino||'')), 'todas com canal whatsapp e destino NUMERICO (nenhum e-mail)')
ok(!pend.some(f=>(f.destino||'').includes('@') && f.canal==='whatsapp'), 'nenhuma linha pendente manda WhatsApp para e-mail')

console.log('\n=== ENVIADOS/PROCESSADOS depois de religar (22:26 em diante) ===')
console.table((await q("avisos_ponto_fila?select=tipo,status,canal,destino,tentativas,processado_em,motivo_falha&processado_em=gte.2026-09-11T22:26:00Z&order=processado_em.desc&limit=25"))
  .map(f=>({tipo:f.tipo,status:f.status,canal:f.canal,destino:(f.destino||'').slice(0,26),tent:f.tentativas,proc:f.processado_em?.slice(11,19),motivo:(f.motivo_falha||'').slice(0,52)})))

console.log('\n=== SERVIDORES por status ===')
for (const st of ['ativo','pendente_confirmacao']) {
  const r = await fetch(`${U}/rest/v1/servidores?select=id&aviso_ponto_status=eq.${st}`, { headers: { ...H, Prefer:'count=exact', Range:'0-0' } })
  console.log(' ', st.padEnd(22), r.headers.get('content-range'))
}
process.exit(falhou ? 1 : 0)
