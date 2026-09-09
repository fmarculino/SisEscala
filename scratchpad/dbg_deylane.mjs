import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,300));return r.json()}
async function rpc(f,b){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok)throw new Error(`${f}: ${r.status} ${t.slice(0,300)}`);return JSON.parse(t)}
const loc=s=>s?new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,19):'—'
const s=(await q(`servidores?select=id&matricula=eq.67836`))[0]
console.log('=== BLOCOS PREVISTOS 08/09 ===')
const b=await rpc('fn_blocos_previstos_dia',{p_servidor_id:s.id,p_data:'2026-09-08'})
for(const x of b) console.log(` bloco ${x.bloco_ordem} ${x.categoria} ${loc(x.inicio_previsto)} -> ${loc(x.fim_previsto)} intervalo=${x.permite_intervalo}`)
console.log('\n=== ALOCACAO 08/09 ===')
const a=await rpc('fn_alocar_marcacoes_dia',{p_servidor_id:s.id,p_data:'2026-09-08'})
console.log('slots:',a.slots)
for(const x of a.alocacoes) console.log(` ALOC ${x.passo.padEnd(18)} prev ${loc(x.previsto)} dist ${x.distancia_min} marc ${x.marcacao_id.slice(0,8)}`)
for(const p of a.pendencias) console.log(` PEND ${String(p.tipo).padEnd(20)} ${p.marcacao_id?p.marcacao_id.slice(0,8):''} ${loc(p.ocorrido_em)} ${p.passo?'passo='+p.passo:''}`)
console.log('\n=== PROJECAO 08/09 ===')
console.log(JSON.stringify(await rpc('fn_projecao_marcacoes_dia',{p_servidor_id:s.id,p_data:'2026-09-08'}),null,1))
