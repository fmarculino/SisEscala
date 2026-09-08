import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function q(p){ const out=[]; for(let f=0;;f+=1000){ const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}}); if(!r.ok){console.error(r.status,(await r.text()).slice(0,150));return out} const g=await r.json(); out.push(...g); if(g.length<1000)break } return out }
const ems = await q(`escala_mensal?select=id,servidor_id,unidade_id&order=id`)
const emById=Object.fromEntries(ems.map(e=>[e.id,e]))
const PASSOS=['presenca_entrada_marcacao_id','presenca_intervalo_saida_marcacao_id','presenca_intervalo_retorno_marcacao_id','presenca_saida_marcacao_id']
const a=await q(`escala_diaria?select=escala_mensal_id,${PASSOS.join(',')}&presenca_entrada_marcacao_id=not.is.null&order=id`)
const b=await q(`escala_diaria?select=escala_mensal_id,${PASSOS.join(',')}&presenca_entrada_marcacao_id=is.null&presenca_saida_marcacao_id=not.is.null&order=id`)
const todas=[...a,...b]
const ids=new Set(); for(const d of todas) for(const c of PASSOS) if(d[c]) ids.add(d[c])
const arr=[...ids]; const marc={}
for(let i=0;i<arr.length;i+=150){ for(const m of await q(`marcacoes_ponto?select=id,unidade_id,origem&id=in.(${arr.slice(i,i+150).join(',')})`)) marc[m.id]=m }
const st={}
for(const d of todas){ const em=emById[d.escala_mensal_id]; if(!em) continue
  for(const c of PASSOS){ const m=marc[d[c]]; if(!m) continue
    const k=m.origem+(m.unidade_id?(m.unidade_id===em.unidade_id?' :: MESMA unidade':' :: OUTRA unidade'):' :: sem unidade')
    st[k]=(st[k]||0)+1 } }
console.log('=== PASSOS GRAVADOS, por origem x unidade ===')
for(const [k,v] of Object.entries(st).sort((x,y)=>y[1]-x[1])) console.log(String(v).padStart(6), k)
