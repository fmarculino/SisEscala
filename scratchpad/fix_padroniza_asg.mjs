import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const { alvo, unid } = JSON.parse(fs.readFileSync('scratchpad/_asg_alvo.json','utf8'))
const ERRADO='9e921033-be3c-4ba6-97c8-b866d364d03b', CERTO='78bab353-7c0f-41e8-9472-36a44d9645fa'
const rpc = async (fn, body) => { const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(body)}); const t=await r.text(); return {ok:r.ok,status:r.status,data:t?JSON.parse(t):null} }
const q = async p => { const r=await fetch(`${U}/rest/v1/${p}`,{headers:H}); const t=await r.text(); return t?JSON.parse(t):null }

// BACKUP do estado antes
fs.writeFileSync('scratchpad/_backup_asg_antes.json', JSON.stringify(alvo, null, 1))

const errados = alvo.filter(s => s.dicionario_setor_id === ERRADO)
const pcErrado = errados.find(s => (unid[s.unidade_id]||'').includes('Pedro Cavalcante'))
const pcCerto  = alvo.find(s => s.dicionario_setor_id===CERTO && (unid[s.unidade_id]||'').includes('Pedro Cavalcante'))

// PRE-CONDICAO: aborta se o estado nao for o medido
if (!pcErrado || !pcCerto) { console.error('ABORTA: par da Pedro Cavalcante nao encontrado'); process.exit(1) }
const imp = await rpc('fn_impedimentos_fusao_setor', { p_origem: pcErrado.id, p_destino: pcCerto.id })
if (!imp.ok || (Array.isArray(imp.data) && imp.data.length)) { console.error('ABORTA: impedimentos', JSON.stringify(imp.data)); process.exit(1) }

console.log('--- PASSO 1: fusao na USF Pedro Cavalcante ---')
const fus = await rpc('fn_fundir_setor', { p_origem: pcErrado.id, p_destino: pcCerto.id })
console.log('status', fus.status, JSON.stringify(fus.data))
if (!fus.ok) { console.error('ABORTA: fusao falhou'); process.exit(1) }

console.log('\n--- PASSO 2: repontar os demais para ASG AGENTE DE SERVICOS GERAIS ---')
const repontar = errados.filter(s => s.id !== pcErrado.id).map(s => s.id)
console.log('setores a repontar:', repontar.length)
const r = await fetch(`${U}/rest/v1/setores?id=in.(${repontar.join(',')})`, {
  method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ dicionario_setor_id: CERTO })
})
const gravados = await r.json()
console.log('status', r.status, '| linhas gravadas:', Array.isArray(gravados) ? gravados.length : JSON.stringify(gravados).slice(0,300))
