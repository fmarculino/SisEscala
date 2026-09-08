import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type':'application/json' }
async function q(p){ const out=[]; for(let f=0;;f+=1000){ const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}}); if(!r.ok){console.error(p.slice(0,120),r.status,(await r.text()).slice(0,200));return out} const g=await r.json(); out.push(...g); if(g.length<1000)break } return out }

const ems = await q(`escala_mensal?select=id,servidor_id,mes,ano,unidade_id&order=id`)
const emById = Object.fromEntries(ems.map(e=>[e.id,e]))
const PASSOS=['presenca_entrada_marcacao_id','presenca_intervalo_saida_marcacao_id','presenca_intervalo_retorno_marcacao_id','presenca_saida_marcacao_id']
const eds = await q(`escala_diaria?select=id,escala_mensal_id,dia,categoria,${PASSOS.join(',')}&presenca_entrada_marcacao_id=not.is.null&order=id`)
const eds2 = await q(`escala_diaria?select=id,escala_mensal_id,dia,categoria,${PASSOS.join(',')}&presenca_entrada_marcacao_id=is.null&presenca_saida_marcacao_id=not.is.null&order=id`)
const todas=[...eds,...eds2]
console.log('escala_mensal:', ems.length, '| escala_diaria com marcacao:', todas.length)

const ids=new Set(); for(const d of todas) for(const c of PASSOS) if(d[c]) ids.add(d[c])
const arr=[...ids]; const marc={}
for(let i=0;i<arr.length;i+=150){
  const g=await q(`marcacoes_ponto?select=id,unidade_id,origem,ocorrido_em,dispositivo_id&id=in.(${arr.slice(i,i+150).join(',')})`)
  for(const m of g) marc[m.id]=m
}
console.log('marcacoes referenciadas:', arr.length, '| carregadas:', Object.keys(marc).length)

const unis=await q(`unidades?select=id,nome`); const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const srvs=await q(`servidores?select=id,nome,matricula`); const sn=Object.fromEntries(srvs.map(s=>[s.id,`${s.nome} (${s.matricula})`]))
const disp=await q(`dispositivos_rep?select=id,nome`); const dn=Object.fromEntries(disp.map(d=>[d.id,d.nome]))

const casos=[]
for(const d of todas){ const em=emById[d.escala_mensal_id]; if(!em) continue
  for(const c of PASSOS){ const mid=d[c]; if(!mid) continue; const m=marc[mid]; if(!m||m.origem!=='rep'||!m.unidade_id) continue
    if(m.unidade_id!==em.unidade_id) casos.push({srv:em.servidor_id,mes:em.mes,ano:em.ano,dia:d.dia,cat:d.categoria,passo:c.slice(9).replace('_marcacao_id',''),eun:un[em.unidade_id],mun:un[m.unidade_id],dev:dn[m.dispositivo_id],ts:m.ocorrido_em}) } }

console.log('\n=== PASSOS PREENCHIDOS POR BATIDA DE OUTRA UNIDADE (base inteira) ===')
console.log('passos:', casos.length, '| pares (servidor,dia):', new Set(casos.map(c=>`${c.srv}|${c.ano}-${c.mes}-${c.dia}`)).size, '| pessoas:', new Set(casos.map(c=>c.srv)).size)
const pm={}; for(const c of casos) pm[`${c.ano}-${String(c.mes).padStart(2,'0')}`]=(pm[`${c.ano}-${String(c.mes).padStart(2,'0')}`]||0)+1
console.log('por competencia:', JSON.stringify(pm))
const pp={}; for(const c of casos){const k=`escala ${c.eun}  <-  batida ${c.mun}`; pp[k]=(pp[k]||0)+1}
console.log('\npor par:')
for(const [k,v] of Object.entries(pp).sort((a,b)=>b[1]-a[1])) console.log(String(v).padStart(5),k)
console.log('\n=== PESSOAS ENVOLVIDAS ===')
const pes={}; for(const c of casos){pes[c.srv]=(pes[c.srv]||0)+1}
for(const [s,n] of Object.entries(pes).sort((a,b)=>b[1]-a[1])) console.log(String(n).padStart(4), sn[s])
const loc=s=>new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16)
console.log('\n=== TODOS OS CASOS ===')
for(const c of casos.sort((a,b)=>a.ts<b.ts?-1:1)) console.log(`${loc(c.ts)} | ${sn[c.srv]} | ${String(c.dia).padStart(2)}/${c.mes} ${c.cat.padEnd(10)} ${c.passo.padEnd(18)} | escala:${c.eun} | bateu em:${c.dev} (${c.mun})`)
