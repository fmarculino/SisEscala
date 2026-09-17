import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
const q=async p=>(await fetch(`${U}/rest/v1/${p}`,{headers:H})).json()
console.log(JSON.stringify(await q('escala_diaria?select=id,categoria,confirmado_por_id,presenca_confirmada,presenca_saida_manual,presenca_entrada_manual,justificativa_manual,confirmacao_manual&id=in.(ed158fe2-309b-46b7-bad7-1a4de0750bb1,f48fcb95-2d1b-4def-84f8-2ec15ae231fd)'),null,1))
// quantas linhas com presenca de origem rep tem confirmado_por_id nulo (=> revert nao grava desconsiderar)
const r=await fetch(`${U}/rest/v1/escala_diaria?select=id&presenca_saida_origem=eq.rep&confirmado_por_id=is.null`,{headers:{...H,Prefer:'count=exact',Range:'0-0'}})
console.log('linhas com saida origem rep e confirmado_por_id NULO:', r.headers.get('content-range'))
const r2=await fetch(`${U}/rest/v1/escala_diaria?select=id&presenca_saida_origem=eq.rep`,{headers:{...H,Prefer:'count=exact',Range:'0-0'}})
console.log('linhas com saida origem rep (total):', r2.headers.get('content-range'))
