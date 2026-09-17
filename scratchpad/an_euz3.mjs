import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const rpc=async(n,b)=>{const r=await fetch(`${U}/rest/v1/rpc/${n}`,{method:'POST',headers:H,body:JSON.stringify(b)});return [r.status, await r.json()]}
console.log('desfecho PLANTAO MT 12/09:', JSON.stringify(await rpc('fn_desfecho_evento_dia',{p_escala_diaria_id:'ed158fe2-309b-46b7-bad7-1a4de0750bb1',p_hoje:'2026-09-17'})))
console.log('desfecho REGULAR N 12/09:', JSON.stringify(await rpc('fn_desfecho_evento_dia',{p_escala_diaria_id:'f48fcb95-2d1b-4def-84f8-2ec15ae231fd',p_hoje:'2026-09-17'})))
const q=async p=>{const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});return r.json()}
console.log('justificativas_eventos 12/09:', JSON.stringify(await q('justificativas_eventos?select=dia,categoria,resultado,resultado_origem,texto_justificativa&servidor_id=eq.d0adb05a-e8f1-466e-b530-85312d6eab63&mes=eq.9&ano=eq.2026')))
