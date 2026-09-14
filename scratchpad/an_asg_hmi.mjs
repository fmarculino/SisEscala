import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const ASG='707881c5-0aa0-40b4-861b-6ef54a09204e', CERTO='78bab353-7c0f-41e8-9472-36a44d9645fa'
const q = async p => { const r=await fetch(`${U}/rest/v1/${p}`,{headers:H}); const t=await r.text(); return t?JSON.parse(t):null }
const rpc = async (fn,b) => { const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)}); const t=await r.text(); return {ok:r.ok,status:r.status,data:t?JSON.parse(t):null} }

const usos = await q(`setores?select=id,unidade_id,parent_id,ativo,unidades(nome)&dicionario_setor_id=eq.${ASG}`)
console.log('=== setores com a entrada "ASG" ===')
for (const s of usos) {
  const pai = s.parent_id ? await q(`setores?select=dicionario_setores(nome)&id=eq.${s.parent_id}`) : null
  const dep = await rpc('fn_dependencias_setor', { p_setor_id: s.id })
  console.log(` unidade=${s.unidades?.nome} id=${s.id} ativo=${s.ativo}`)
  console.log(`   pai: ${pai?.[0]?.dicionario_setores?.nome || '(raiz)'}`)
  console.log(`   deps: ${(dep.data||[]).map(d=>`${d.tabela}:${d.qtd}`).join(' ') || '(livre)'}`)
}
// a unidade ja tem o nome certo em algum lugar?
for (const s of usos) {
  const irmaos = await q(`setores?select=id,parent_id&unidade_id=eq.${s.unidade_id}&dicionario_setor_id=eq.${CERTO}`)
  console.log(`\n   ${s.unidades?.nome} ja tem setor com o nome CERTO? ${irmaos.length ? 'SIM -> ' + JSON.stringify(irmaos) : 'nao (repontar e seguro)'}`)
}
