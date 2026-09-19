import fs from 'fs'
import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
async function pag(p) { const o=[]; for(let f=0;;f+=1000){ const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}}); if(!r.ok) throw new Error(r.status+' '+await r.text()); const x=await r.json(); o.push(...x); if(x.length<1000) break } return o }
const rpc = async (fn,b) => { const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)}); return r.ok? await r.json() : { __e:r.status, t:(await r.text()).slice(0,200) } }
const { ids } = JSON.parse(fs.readFileSync('scratchpad/_afd/antes.json','utf8'))
const em = []
for (let i=0;i<ids.length;i+=25) em.push(...await pag(`escala_mensal?select=id&mes=eq.9&ano=eq.2026&servidor_id=in.(${ids.slice(i,i+25).join(',')})`))
const emIds = em.map(e=>e.id)
console.log(`escalas: ${emIds.length}`)
const r = await rpc('fn_reconciliacao_pendente_escala', { p_escala_mensal_ids: emIds })
if (r.__e) { console.log('ERRO', r.__e, r.t); process.exit(1) }
const arr = Array.isArray(r) ? r : []
console.log(`linhas de previa: ${arr.length}`)
if (arr.length) console.log('colunas:', Object.keys(arr[0]).join(', '))
const alvo = arr.filter(x => [17,18].includes(Number(x.dia)))
const eleg = alvo.filter(x => x.dia_elegivel)
console.log(`\nnos dias 17 e 18: ${alvo.length} pares, ${eleg.length} elegiveis (so acrescimo)`)
const porImp = {}
for (const x of alvo) { const k = x.dia_elegivel ? 'ELEGIVEL' : (x.impedimento||'sem_motivo'); porImp[k]=(porImp[k]||0)+1 }
console.log(JSON.stringify(porImp, null, 1))
for (const x of eleg.slice(0,20)) console.log(' ', JSON.stringify(x))
