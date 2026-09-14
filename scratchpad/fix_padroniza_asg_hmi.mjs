import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const ASG='707881c5-0aa0-40b4-861b-6ef54a09204e', CERTO='78bab353-7c0f-41e8-9472-36a44d9645fa'
const q = async p => { const r=await fetch(`${U}/rest/v1/${p}`,{headers:H}); const t=await r.text(); return t?JSON.parse(t):null }
let falhas=0; const ok=(c,m)=>{console.log(c?'  OK  ':' FALHA',m); if(!c)falhas++}

const usos = await q(`setores?select=id,unidade_id&dicionario_setor_id=eq.${ASG}`)
if (usos.length !== 1) { console.error(`ABORTA: esperava 1 setor com "ASG", achou ${usos.length}`); process.exit(1) }
const colide = await q(`setores?select=id&unidade_id=eq.${usos[0].unidade_id}&dicionario_setor_id=eq.${CERTO}`)
if (colide.length) { console.error('ABORTA: a unidade ja tem setor com o nome correto — caso de fusao, nao de renomeacao'); process.exit(1) }

const r = await fetch(`${U}/rest/v1/setores?id=eq.${usos[0].id}`, { method:'PATCH', headers:{...H,Prefer:'return=representation'}, body: JSON.stringify({ dicionario_setor_id: CERTO }) })
console.log('PATCH status', r.status, '| linhas:', (await r.json()).length)

const d = await fetch(`${U}/rest/v1/dicionario_setores?id=eq.${ASG}`, { method:'DELETE', headers:{...H,Prefer:'return=representation'} })
console.log('DELETE dicionario "ASG" status', d.status, await d.text())

console.log('\n=== conferencia ===')
ok((await q(`setores?select=id&dicionario_setor_id=eq.${ASG}`)).length === 0, 'nenhum setor usa a entrada "ASG"')
ok((await q(`dicionario_setores?select=id&id=eq.${ASG}`)).length === 0, 'entrada "ASG" removida do dicionario')
const agora = await q(`setores?select=id&dicionario_setor_id=eq.${CERTO}`)
ok(agora.length === 31, `setores com o nome correto = 31 (achou ${agora.length})`)
const lot = await q(`servidores?select=matricula&setor_id=eq.${usos[0].id}`)
ok(lot.length === 10, `os 10 lotados do HMI continuam no setor (achou ${lot.length})`)
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodas as asserções passaram.')
process.exit(falhas?1:0)
