import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type':'application/json' }
async function q(p){ const r=await fetch(`${U}/rest/v1/${p}`,{headers:H}); if(!r.ok){console.error(p,r.status,await r.text());return []} return r.json() }
async function rpc(fn,body){ const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(body)}); const t=await r.text(); if(!r.ok){console.error(fn,r.status,t);return null} return JSON.parse(t) }
const SID='5defd039-5ce4-4e12-8892-5015e7bc3a58'
const loc = s => s? new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,19):null
const disp = await q(`dispositivos_rep?select=id,nome,unidade_id,setor_id`)
const unis = await q(`unidades?select=id,nome`); const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const dp=Object.fromEntries(disp.map(d=>[d.id,`${d.nome} [${un[d.unidade_id]}]`]))
const ms = await q(`marcacoes_ponto?select=id,ocorrido_em,dispositivo_id,unidade_id,setor_id,nsr&servidor_id=eq.${SID}&ocorrido_em=gte.2026-09-06&ocorrido_em=lt.2026-09-09&order=ocorrido_em`)
console.log('=== MARCACOES dias 6-8 (hora local) ===')
for(const m of ms) console.log(loc(m.ocorrido_em),'| nsr',String(m.nsr).padStart(6),'|',dp[m.dispositivo_id]||'?', '| unid_marc:', un[m.unidade_id])
const turnos = await q(`dicionario_turnos?select=id,codigo,slots,horario_inicio,horas_computadas,tipo`)
const tt=Object.fromEntries(turnos.map(t=>[t.id,t]))
console.log('\n=== TURNOS DA ESCALA ===')
for(const id of ['1c9a00b2-081a-4d06-b191-a6245c8cce78','864644f9-504f-40a5-91be-c608939fc434','f4cd224e-19d1-4a07-a9e4-697f7ca5789d']) console.log(id, JSON.stringify(tt[id]))
console.log('\n=== fn_blocos_previstos_dia 07/09 ===')
console.log(JSON.stringify(await rpc('fn_blocos_previstos_dia',{p_servidor_id:SID,p_data:'2026-09-07'}),null,1))
console.log('\n=== fn_projecao_marcacoes_dia 07/09 ===')
console.log(JSON.stringify(await rpc('fn_projecao_marcacoes_dia',{p_servidor_id:SID,p_data:'2026-09-07'}),null,1))
