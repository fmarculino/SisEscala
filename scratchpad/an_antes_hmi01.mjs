import fs from 'fs'
import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
async function pag(p) { const o=[]; for(let f=0;;f+=1000){ const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}}); if(!r.ok) throw new Error(r.status+' '+await r.text()); const x=await r.json(); o.push(...x); if(x.length<1000) break } return o }
const rpc = async (fn,b) => { const r = await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)}); return r.ok? await r.json() : null }

const idents = JSON.parse(fs.readFileSync('scratchpad/_afd/idents.json','utf8'))
const mapa = new Map()
for (const id of idents) {
  const s = await rpc('fn_servidor_por_identificador_afd', { p_dispositivo_id:'19454bce-aa64-45af-865f-df2b18e0a205', p_identificador:id, p_ocorrido_em:'2026-09-18T12:00:00Z' })
  const sid = Array.isArray(s) && s[0]?.servidor_id ? s[0].servidor_id : null
  if (sid) mapa.set(id, sid)
}
const ids = [...new Set(mapa.values())]
console.log(`identificadores=${idents.length} resolvidos=${mapa.size} servidores distintos=${ids.length}`)
fs.writeFileSync('scratchpad/_afd/mapa.json', JSON.stringify([...mapa]))

const em = []
for (let i=0;i<ids.length;i+=25) em.push(...await pag(`escala_mensal?select=id,servidor_id,servidores(nome,matricula),setores(dicionario_setores(nome))&mes=eq.9&ano=eq.2026&servidor_id=in.(${ids.slice(i,i+25).join(',')})`))
console.log(`escalas de 09/2026 desses servidores: ${em.length}`)
const emIds = em.map(e=>e.id)
const linhas = []
for (let i=0;i<emIds.length;i+=25) linhas.push(...await pag(`escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,dicionario_turnos(codigo)&escala_mensal_id=in.(${emIds.slice(i,i+25).join(',')})&dia=in.(17,18,19)`))

const porDia = {17:{t:0,vazio:0,parcial:0},18:{t:0,vazio:0,parcial:0},19:{t:0,vazio:0,parcial:0}}
for (const l of linhas) {
  const d = porDia[l.dia]; if(!d) continue
  d.t++
  const passos = [l.presenca_entrada_em,l.presenca_intervalo_saida_em,l.presenca_intervalo_retorno_em,l.presenca_saida_em].filter(Boolean).length
  if (passos===0) d.vazio++; else if (passos<2) d.parcial++
}
console.log('\n=== ESCALA DOS 244 AFETADOS (09/2026) — ANTES ===')
for (const d of [17,18,19]) console.log(`  dia ${d}: ${porDia[d].t} linhas | ${porDia[d].vazio} SEM presenca | ${porDia[d].parcial} com 1 passo so`)
fs.writeFileSync('scratchpad/_afd/antes.json', JSON.stringify({ linhas, em, ids }))
