import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const { alvo, unid } = JSON.parse(fs.readFileSync('scratchpad/_asg_alvo.json','utf8'))
const ERRADO='9e921033-be3c-4ba6-97c8-b866d364d03b', CERTO='78bab353-7c0f-41e8-9472-36a44d9645fa'
const rpc = async (fn, body) => { const r = await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(body)}); const t=await r.text(); return {ok:r.ok,status:r.status,data:t?JSON.parse(t):null} }
const q = async p => { const r = await fetch(`${U}/rest/v1/${p}`,{headers:H}); const t=await r.text(); return t?JSON.parse(t):null }

const pc = alvo.filter(s => (unid[s.unidade_id]||'').includes('Pedro Cavalcante'))
const origem = pc.find(s=>s.dicionario_setor_id===ERRADO), destino = pc.find(s=>s.dicionario_setor_id===CERTO)
const imp = await rpc('fn_impedimentos_fusao_setor', { p_origem: origem.id, p_destino: destino.id })
console.log('=== impedimentos da fusao (Pedro Cavalcante) ===', imp.status)
console.log(JSON.stringify(imp.data, null, 1))

console.log('\ncolunas de servidores:', Object.keys((await q('servidores?select=*&limit=1'))[0]||{}).join(', '))
for (const s of pc) {
  const v = await q(`servidores?select=matricula,nome,status&setor_id=eq.${s.id}`)
  console.log(`\nlotados em ${s.dicionario_setor_id===ERRADO?'SERVICOS GERAIS (origem)':'ASG AGENTE (destino)'}:`, JSON.stringify(v))
}
console.log('\n=== historico_transferencias que cita o setor errado de Pedro Cavalcante ===')
console.log(JSON.stringify(await q(`historico_transferencias?select=*&or=(setor_origem_id.eq.${origem.id},setor_destino_id.eq.${origem.id})`), null, 1).slice(0,1500))
