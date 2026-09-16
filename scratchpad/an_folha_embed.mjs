import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const uniHiroshi='36abf7d9-6b28-4890-8c4c-676bbcd048c0'
const sel='id,status,servidor_id,escala_mensal_id,total_horas_normais,cargo,escala_mensal!inner(unidade_id,setor_id)'
const url=`${U}/rest/v1/folha_ponto?select=${encodeURIComponent(sel)}&mes=eq.9&ano=eq.2026&escala_mensal.unidade_id=eq.${uniHiroshi}&order=id.asc`
const r=await fetch(url,{headers:H})
console.log('status',r.status)
const j=await r.json()
if(!r.ok){console.log(JSON.stringify(j).slice(0,400))}
else{console.log('linhas',j.length);console.log('amostra',JSON.stringify(j[0]));
  console.log('ALDENIR presente?',j.some(f=>f.id==='c0d11d0e-0a06-4bf8-8f99-e9dbfecccf4b'))}
