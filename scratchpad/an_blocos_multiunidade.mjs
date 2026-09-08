import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type':'application/json' }
async function q(p){ const out=[]; for(let f=0;;f+=1000){ const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}}); if(!r.ok){console.error(r.status,(await r.text()).slice(0,150));return out} const g=await r.json(); out.push(...g); if(g.length<1000)break } return out }
async function rpc(fn,b){ const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)}); const t=await r.text(); if(!r.ok) return null; return JSON.parse(t) }

const ems=await q(`escala_mensal?select=id,servidor_id,mes,ano,unidade_id&order=id`)
const emById=Object.fromEntries(ems.map(e=>[e.id,e]))
const eds=await q(`escala_diaria?select=id,escala_mensal_id,dia,categoria&categoria=in.(Regular,Plantão,Extra)&order=id`)
console.log('escala_diaria (Reg/Pla/Ext):', eds.length)
// pares (servidor, ano, mes, dia) com 2+ unidades
const mapa={}
for(const d of eds){ const em=emById[d.escala_mensal_id]; if(!em) continue
  const k=`${em.servidor_id}|${em.ano}|${em.mes}|${d.dia}`
  ;(mapa[k]=mapa[k]||new Set()).add(em.unidade_id) }
const multi=Object.entries(mapa).filter(([,s])=>s.size>1)
console.log('pares (servidor,dia) com escala em 2+ unidades:', multi.length)
const pessoas=new Set(multi.map(([k])=>k.split('|')[0]))
console.log('pessoas envolvidas:', pessoas.size)
const pm={}; for(const [k] of multi){const [,a,m]=k.split('|'); pm[`${a}-${String(m).padStart(2,'0')}`]=(pm[`${a}-${String(m).padStart(2,'0')}`]||0)+1}
console.log('por competencia:', JSON.stringify(pm))

const unis=await q(`unidades?select=id,nome`); const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const srvs=await q(`servidores?select=id,nome,matricula`); const sn=Object.fromEntries(srvs.map(s=>[s.id,`${s.nome} (${s.matricula})`]))

console.log('\n=== CHAMANDO fn_blocos_previstos_dia para cada par ===')
let fundidos=0, separados=0, erro=0
const detalhe=[]
for(const [k] of multi){
  const [srv,ano,mes,dia]=k.split('|')
  const data=`${ano}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`
  const b=await rpc('fn_blocos_previstos_dia',{p_servidor_id:srv,p_data:data})
  if(!b){erro++;continue}
  let temFusaoCross=false
  for(const bl of b){
    const uSet=new Set(bl.escala_diaria_ids.map(id=>{const d=eds.find(x=>x.id===id); return d?emById[d.escala_mensal_id]?.unidade_id:null}).filter(Boolean))
    if(uSet.size>1){ temFusaoCross=true
      detalhe.push({srv,data,bloco:bl.bloco_ordem,cat:bl.categoria,unis:[...uSet].map(u=>un[u]),ini:bl.inicio_previsto,fim:bl.fim_previsto,permInt:bl.permite_intervalo,intIni:bl.intervalo_inicio_previsto}) } }
  if(temFusaoCross) fundidos++; else separados++
}
console.log('pares cujo bloco FUNDE unidades diferentes:', fundidos)
console.log('pares que ficam em blocos separados      :', separados, '| erro RPC:', erro)
const loc=s=>s?new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16):'—'
console.log('\n=== BLOCOS QUE FUNDEM UNIDADES ===')
for(const d of detalhe.sort((a,b)=>a.data<b.data?-1:1)) console.log(`${d.data} | ${sn[d.srv]} | ${d.cat.padEnd(8)} | ${loc(d.ini)} -> ${loc(d.fim)} | intervalo: ${d.permInt?loc(d.intIni):'NENHUM'} | ${d.unis.join('  +  ')}`)
