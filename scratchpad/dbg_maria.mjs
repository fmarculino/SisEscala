import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,300));return r.json()}
async function rpc(f,b){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok)throw new Error(`${f}: ${r.status} ${t.slice(0,300)}`);return JSON.parse(t)}
const unis=await q('unidades?select=id,nome');const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const disp=await q('dispositivos_rep?select=id,nome');const dn=Object.fromEntries(disp.map(d=>[d.id,d.nome]))
const loc=s=>s?new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16):'—'
const s=(await q(`servidores?select=id,nome&matricula=eq.67689`))[0]
const DIA='2026-09-07'
console.log('=== BLOCOS PREVISTOS ===')
const b=await rpc('fn_blocos_previstos_dia',{p_servidor_id:s.id,p_data:DIA})
for(const bl of b){
  const us=[]
  for(const id of bl.escala_diaria_ids){
    const d=(await q(`escala_diaria?select=escala_mensal_id,categoria&id=eq.${id}`))[0]
    const em=(await q(`escala_mensal?select=unidade_id&id=eq.${d.escala_mensal_id}`))[0]
    us.push(`${un[em.unidade_id]}/${d.categoria}`)
  }
  console.log(` bloco ${bl.bloco_ordem} ${bl.categoria} [${us.join(',')}]  ${loc(bl.inicio_previsto)} -> ${loc(bl.fim_previsto)}  intervalo=${bl.permite_intervalo}`)
}
console.log('\n=== BATIDAS ===')
const ms=await q(`marcacoes_ponto?select=id,ocorrido_em,unidade_id,dispositivo_id,origem&servidor_id=eq.${s.id}&ocorrido_em=gte.2026-09-06&ocorrido_em=lt.2026-09-09&order=ocorrido_em`)
for(const m of ms) console.log(` ${loc(m.ocorrido_em)} ${m.origem} ${dn[m.dispositivo_id]||''} [${un[m.unidade_id]}] id=${m.id.slice(0,8)}`)
console.log('\n=== ALOCACAO COMPLETA ===')
const a=await rpc('fn_alocar_marcacoes_dia',{p_servidor_id:s.id,p_data:DIA})
console.log('slots:',a.slots)
for(const x of a.alocacoes) console.log(` ALOC bloco${x.bloco} ${x.passo.padEnd(18)} prev ${loc(x.previsto)} dist ${String(x.distancia_min).padStart(4)} marc ${x.marcacao_id.slice(0,8)} fronteira=${x.fronteira}`)
for(const p of a.pendencias) console.log(` PEND ${String(p.tipo).padEnd(20)} ${p.marcacao_id?p.marcacao_id.slice(0,8):''} ${loc(p.ocorrido_em)} ${p.passo?'passo='+p.passo:''} ${p.previsto?'prev='+loc(p.previsto):''}`)
