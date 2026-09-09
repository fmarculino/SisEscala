import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}` }
const q = async p => { const r = await fetch(`${U}/rest/v1/${p}`,{headers:H}); if(!r.ok){console.error(r.status,(await r.text()).slice(0,200));process.exit(1)} return r.json() }
console.log('agora UTC:', new Date().toISOString(), ' local:', new Date(Date.now()-3*3600e3).toISOString())
for (const d of await q(`dispositivos_rep?select=nome,ultimo_contato_em,coletor_versao&coletor_ip=eq.10.110.4.123&order=nome`))
  console.log(`${d.nome} | v${d.coletor_versao} | contato ${d.ultimo_contato_em}`)
// CSST
const s = await q(`setores?select=id,ativo,dicionario_setores(nome),parent_id,unidade_id&id=eq.63178ce5-62bb-4394-ba27-3e9b77216a42`)
console.log('\nsetor extra do HMM-04:', JSON.stringify(s[0]))
const lot = await q(`servidores?select=id&setor_id=eq.63178ce5-62bb-4394-ba27-3e9b77216a42&status=eq.Ativo`)
console.log('servidores ativos lotados nele:', lot.length)
