import fs from 'fs'
import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
async function pag(p) { const o=[]; for(let f=0;;f+=1000){ const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}}); if(!r.ok) throw new Error(r.status+' '+await r.text()); const x=await r.json(); o.push(...x); if(x.length<1000) break } return o }
const rpc = async (fn,b) => { const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)}); return r.ok? await r.json() : null }
const D = '19454bce-aa64-45af-865f-df2b18e0a205'
let falhou = 0
const ok = (c, m) => { console.log(`${c?'  OK  ':'  FALHA'} ${m}`); if(!c) falhou++ }

const cur = await rpc('fn_cursor_afd_dispositivo', { p_dispositivo_id: D })
const d = (await pag(`dispositivos_rep?select=ultimo_nsr&id=eq.${D}`))[0]
ok(Number(cur) === Number(d.ultimo_nsr)+1, `cursor=${cur} ultimo_nsr=${d.ultimo_nsr} -> lacuna ZERO`)

const regs = await pag(`rep_afd_registros?select=nsr&dispositivo_id=eq.${D}&nsr=gte.130000&order=nsr`)
const n = regs.map(r=>Number(r.nsr)); const gaps=[]
for (let i=1;i<n.length;i++) if (n[i]!==n[i-1]+1) gaps.push([n[i-1]+1,n[i]-1])
ok(gaps.length===0, `sem lacuna de NSR acima de 130000 (${n.length} registros contiguos ${n[0]}..${n[n.length-1]})`)

for (const [dia,a,b] of [[17,'2026-09-17','2026-09-18'],[18,'2026-09-18','2026-09-19'],[19,'2026-09-19','2026-09-20']]) {
  const r = await fetch(`${U}/rest/v1/marcacoes_ponto?select=id&dispositivo_id=eq.${D}&ocorrido_em=gte.${a}T03:00:00Z&ocorrido_em=lt.${b}T03:00:00Z`, { headers:{...H,Prefer:'count=exact',Range:'0-0'} })
  const c = (r.headers.get('content-range')||'').split('/')[1]
  console.log(`  marcacoes dia ${dia}/09 no HMI-01: ${c}`)
}

const { ids } = JSON.parse(fs.readFileSync('scratchpad/_afd/antes.json','utf8'))
const em = []
for (let i=0;i<ids.length;i+=25) em.push(...await pag(`escala_mensal?select=id&mes=eq.9&ano=eq.2026&servidor_id=in.(${ids.slice(i,i+25).join(',')})`))
const emIds = em.map(e=>e.id); const linhas=[]
for (let i=0;i<emIds.length;i+=25) linhas.push(...await pag(`escala_diaria?select=dia,presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em&escala_mensal_id=in.(${emIds.slice(i,i+25).join(',')})&dia=in.(17,18,19)`))
const pd={17:{t:0,v:0,p:0},18:{t:0,v:0,p:0},19:{t:0,v:0,p:0}}
for (const l of linhas){ const x=pd[l.dia]; if(!x) continue; x.t++
  const k=[l.presenca_entrada_em,l.presenca_intervalo_saida_em,l.presenca_intervalo_retorno_em,l.presenca_saida_em].filter(Boolean).length
  if(k===0)x.v++; else if(k<2)x.p++ }
console.log('\n=== ESCALA DOS 244 — DEPOIS ===')
const antes={17:{v:50,p:67,t:172},18:{v:106,p:45,t:174},19:{v:105,p:17,t:122}}
for (const dia of [17,18,19]) console.log(`  dia ${dia}: ${pd[dia].t} linhas | SEM presenca ${antes[dia].v} -> ${pd[dia].v}  (${antes[dia].v-pd[dia].v} recuperadas) | 1 passo so ${antes[dia].p} -> ${pd[dia].p}`)
console.log(falhou===0 ? '\nTODAS AS ASSERCOES PASSARAM' : `\n${falhou} ASSERCAO(OES) FALHARAM`)
process.exit(falhou===0?0:1)
