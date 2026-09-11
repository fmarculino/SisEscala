import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const q = async p => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); if(!r.ok){console.error(p,r.status,await r.text());return []} return r.json() }

console.log('agora (UTC):', new Date().toISOString(), '| local Maraba:', new Date(Date.now()-3*3600e3).toISOString().slice(0,19))

console.log('\n=== ULTIMOS 10 ITENS PROCESSADOS DA FILA (qualquer servidor) ===')
console.table((await q('avisos_ponto_fila?select=tipo,status,canal,destino,tentativas,criado_em,processado_em,motivo_falha&processado_em=not.is.null&order=processado_em.desc&limit=10'))
  .map(f=>({tipo:f.tipo,status:f.status,canal:f.canal,tent:f.tentativas,proc:f.processado_em,motivo:(f.motivo_falha||'').slice(0,50)})))

console.log('\n=== PENDENTES AGORA ===')
console.table((await q('avisos_ponto_fila?select=tipo,status,canal,destino,tentativas,criado_em&status=eq.pendente&order=criado_em.desc&limit=20'))
  .map(f=>({tipo:f.tipo,canal:f.canal,destino:f.destino,tent:f.tentativas,criado:f.criado_em})))

console.log('\n=== CONFIG DE SILENCIO / TETOS / CANAL ===')
console.table(await q("configuracoes_globais?select=chave,valor&chave=like.aviso_ponto*"))

console.log('\n=== HISTORICO DE confirmacao_optin (todos) ===')
console.table((await q('avisos_ponto_fila?select=servidor_id,status,canal,destino,tentativas,criado_em,processado_em,motivo_falha&tipo=eq.confirmacao_optin&order=criado_em.desc&limit=15'))
  .map(f=>({status:f.status,canal:f.canal,destino:f.destino,tent:f.tentativas,criado:f.criado_em,proc:f.processado_em,motivo:(f.motivo_falha||'').slice(0,60)})))
