import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l && !l.startsWith('#') && l.includes('='))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
const q = async (p) => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); const j = await r.json(); if (!r.ok) throw new Error(p+' -> '+JSON.stringify(j)); return j }
const ids = ['78cdf9ff-a0e2-4da2-a9bd-b145e718a93a','a2fbe8e2-3c46-4022-9ec4-da3885ee2c23']
console.log('TRATAMENTOS:', JSON.stringify(await q(`marcacoes_tratamentos?select=*&marcacao_id=in.(${ids.join(',')})`), null, 1))
console.log('\nALOCACOES (marcacoes_alocacoes?):', JSON.stringify(await q(`marcacoes_alocacoes?select=*&limit=1`).catch(e=>String(e).slice(0,200)), null, 1))
// projecao do dia
const r = await fetch(`${U}/rest/v1/rpc/fn_projecao_marcacoes_dia`, { method:'POST', headers:{...H,'Content-Type':'application/json'},
  body: JSON.stringify({ p_servidor_id:'d0adb05a-e8f1-466e-b530-85312d6eab63', p_data:'2026-09-12' })})
console.log('\nPROJECAO 12/09:', r.status, JSON.stringify(await r.json(), null, 1))
