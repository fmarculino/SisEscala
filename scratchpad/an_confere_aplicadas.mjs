import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,200));return r.json()}
async function rpc(f,b){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok)throw new Error(`${f}: ${r.status} ${t.slice(0,200)}`);return t?JSON.parse(t):null}
const unis=await q('unidades?select=id,nome');const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))

// --- 160000: fn_marcacoes_mes devolve o lugar?
let m160='NAO APLICADA'
try{
  const s=(await q(`servidores?select=id&matricula=eq.1272`))[0]
  const r=await rpc('fn_marcacoes_mes',{p_servidor_ids:[s.id],p_mes:9,p_ano:2026})
  m160 = (r[0] && 'unidade_nome' in r[0]) ? 'APLICADA' : 'NAO APLICADA (sem unidade_nome)'
}catch(e){ m160='ERRO: '+e.message }
console.log('20260908160000 (fn_marcacoes_mes com lugar):', m160)

// --- 140000: bloco de unidades diferentes vira 2?
const maria=(await q(`servidores?select=id,nome&matricula=eq.1272`))[0]
let m140='?'
for (const dia of ['2026-09-01','2026-09-03','2026-09-08']) {
  const b=await rpc('fn_blocos_previstos_dia',{p_servidor_id:maria.id,p_data:dia})
  const mistos=[]
  for(const bl of b){
    const us=new Set()
    for(const id of bl.escala_diaria_ids){
      const d=(await q(`escala_diaria?select=escala_mensal_id&id=eq.${id}`))[0]
      const em=(await q(`escala_mensal?select=unidade_id&id=eq.${d.escala_mensal_id}`))[0]
      us.add(em.unidade_id)
    }
    if(us.size>1) mistos.push(bl.bloco_ordem)
  }
  console.log(`   ${dia}: ${b.length} bloco(s), ${mistos.length} misto(s)${b.length? ` | intervalo: ${b.map(x=>x.permite_intervalo?'sim':'nao').join('/')}`:''}`)
  m140 = mistos.length===0 ? 'APLICADA' : 'NAO APLICADA'
}
console.log('20260908140000 (bloco nao atravessa unidade):', m140)

// --- 150000: pendencia outra_unidade aparece?
let m150='NAO APLICADA'
const jeo=(await q(`servidores?select=id&matricula=eq.67689`))[0]
for (const [sid,dia] of [[maria.id,'2026-09-01'],[maria.id,'2026-09-03'],[jeo.id,'2026-09-07']]) {
  const a=await rpc('fn_alocar_marcacoes_dia',{p_servidor_id:sid,p_data:dia})
  const p=(a.pendencias||[]).filter(x=>x.tipo==='outra_unidade')
  if(p.length) m150='APLICADA'
  console.log(`   ${dia}: ${a.alocacoes.length} alocacoes, pendencias outra_unidade=${p.length}`)
}
console.log('20260908150000 (alocacao nao atravessa unidade):', m150)
