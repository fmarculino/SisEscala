import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const { alvo, unid } = JSON.parse(fs.readFileSync('scratchpad/_asg_alvo.json','utf8'))
const ERRADO = '9e921033-be3c-4ba6-97c8-b866d364d03b'
const CERTO  = '78bab353-7c0f-41e8-9472-36a44d9645fa'
async function rpc(fn, body) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method:'POST', headers:H, body: JSON.stringify(body) })
  const t = await r.text(); return { ok: r.ok, status: r.status, data: t ? JSON.parse(t) : null }
}
const errados = alvo.filter(s => s.dicionario_setor_id === ERRADO)
const linhas = []
for (const s of errados) {
  const d = await rpc('fn_dependencias_setor', { p_setor_id: s.id })
  const deps = d.ok && Array.isArray(d.data) ? d.data : []
  const m = Object.fromEntries(deps.map(x => [x.tabela, x.qtd]))
  linhas.push({
    unidade: (unid[s.unidade_id]||'?').slice(0,32), setor: s.id.slice(0,8), sub: s.parent_id ? 'sim' : '',
    servidores: m.servidores||0, escala_mensal: m.escala_mensal||0, marcacoes: m.marcacoes_ponto||0,
    outras: deps.filter(x => !['servidores','escala_mensal','marcacoes_ponto','logs_sistema'].includes(x.tabela))
                .map(x=>`${x.tabela}:${x.qtd}`).join(' ')
  })
}
linhas.sort((a,b)=> b.servidores - a.servidores || a.unidade.localeCompare(b.unidade))
console.table(linhas)
const tot = k => linhas.reduce((a,l)=>a+l[k],0)
console.log(`TOTAIS: ${linhas.length} setores | servidores=${tot('servidores')} escala_mensal=${tot('escala_mensal')} marcacoes=${tot('marcacoes')}`)
console.log('setores errados SEM vinculo nenhum:', linhas.filter(l=>!l.servidores&&!l.escala_mensal&&!l.marcacoes&&!l.outras).length)
