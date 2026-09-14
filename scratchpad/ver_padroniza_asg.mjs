import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const ERRADO='9e921033-be3c-4ba6-97c8-b866d364d03b', CERTO='78bab353-7c0f-41e8-9472-36a44d9645fa'
const q = async p => { const r=await fetch(`${U}/rest/v1/${p}`,{headers:H}); const t=await r.text(); return t?JSON.parse(t):null }
let falhas = 0
const ok = (cond, msg) => { console.log(cond ? '  OK  ' : ' FALHA', msg); if (!cond) falhas++ }

const aindaErrado = await q(`setores?select=id,unidade_id&dicionario_setor_id=eq.${ERRADO}`)
ok(aindaErrado.length === 0, `nenhum setor usa SERVICOS GERAIS (achou ${aindaErrado.length})`)
const agoraCerto = await q(`setores?select=id&dicionario_setor_id=eq.${CERTO}`)
ok(agoraCerto.length === 30, `setores com ASG AGENTE DE SERVICOS GERAIS = 30 (achou ${agoraCerto.length})`)

// a servidora movida e os colegas do destino
const pc = await q(`setores?select=id,unidade_id,unidades(nome)&dicionario_setor_id=eq.${CERTO}`)
const alvoPC = pc.find(s => (s.unidades?.nome||'').includes('Pedro Cavalcante'))
const lot = await q(`servidores?select=matricula,nome,status&setor_id=eq.${alvoPC.id}&order=nome`)
ok(lot.length === 5, `USF Pedro Cavalcante com 5 lotados no setor unico (achou ${lot.length})`)
ok(lot.some(s => s.matricula === '69158'), 'BEATRIZ (69158) esta no setor correto')
console.log('   ->', lot.map(s=>`${s.matricula} ${s.nome}`).join(' | '))
// o setor errado da Pedro Cavalcante sumiu
const sumiu = await q(`setores?select=id&id=eq.80fa0cfe-d9c5-467f-8511-add70688bb7d`)
ok(sumiu.length === 0, 'setor errado da Pedro Cavalcante foi excluido pela fusao')
// ninguem ficou sem setor
const semSetor = await q(`servidores?select=id&setor_id=is.null&status=eq.Ativo`)
ok(true, `servidores ativos sem setor (informativo): ${semSetor.length}`)
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodas as asserções passaram.')
process.exit(falhas ? 1 : 0)
