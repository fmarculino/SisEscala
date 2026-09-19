import fs from 'fs'
import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
async function pag(p) { const o=[]; for(let f=0;;f+=1000){ const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}}); if(!r.ok) throw new Error(r.status+' '+await r.text()); const x=await r.json(); o.push(...x); if(x.length<1000) break } return o }
const rpc = async (fn,b) => { const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)}); return r.ok? await r.json() : { __e:r.status, t:(await r.text()).slice(0,150) } }
const { ids } = JSON.parse(fs.readFileSync('scratchpad/_afd/antes.json','utf8'))

const em = []
for (let i=0;i<ids.length;i+=25) em.push(...await pag(`escala_mensal?select=id,servidor_id,servidores(nome,matricula)&mes=eq.9&ano=eq.2026&servidor_id=in.(${ids.slice(i,i+25).join(',')})`))
const porEm = Object.fromEntries(em.map(e=>[e.id,e]))
const emIds = em.map(e=>e.id); const linhas=[]
for (let i=0;i<emIds.length;i+=25) linhas.push(...await pag(`escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em,dicionario_turnos(codigo)&escala_mensal_id=in.(${emIds.slice(i,i+25).join(',')})&dia=in.(17,18)`))

const vazios = linhas.filter(l => !l.presenca_entrada_em && !l.presenca_saida_em)
console.log(`linhas ainda SEM presenca nos dias 17 e 18: ${vazios.length}\n`)
for (const l of vazios) {
  const e = porEm[l.escala_mensal_id]
  const data = `2026-09-${String(l.dia).padStart(2,'0')}`
  // ha batida fisica dessa pessoa nesse dia, em qualquer relogio?
  const m = await pag(`marcacoes_ponto?select=ocorrido_em,origem,dispositivo_id&servidor_id=eq.${e.servidor_id}&ocorrido_em=gte.${data}T03:00:00Z&ocorrido_em=lt.2026-09-${String(l.dia+1).padStart(2,'0')}T03:00:00Z`)
  console.log(`${data} ${String(e.servidores?.matricula||'').padEnd(7)} ${String(e.servidores?.nome||'').slice(0,32).padEnd(32)} ${String(l.categoria).padEnd(9)} ${String(l.dicionario_turnos?.codigo||'-').padEnd(5)} batidas_no_dia=${m.length}`)
}
