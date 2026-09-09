// SOMENTE LEITURA. Sobreposicao entre matriculas IRMAS (mesmo CPF), TODAS as competencias,
// TODOS os 21 grupos - inclusive unidades diferentes (a pessoa e uma so).
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function q(p){ const out=[]; for(let f=0;;f+=1000){
  const r = await fetch(`${U}/rest/v1/${p}`,{headers:{...H, Range:`${f}-${f+999}`}})
  if(!r.ok){ console.error('ERRO',p.slice(0,90),r.status,(await r.text()).slice(0,300)); process.exit(1) }
  const pg = await r.json(); out.push(...pg); if(pg.length<1000) break } return out }
const grupos = JSON.parse(fs.readFileSync('scratchpad/_dup_ids.json','utf8'))
const ids = grupos.flatMap(g=>g.ids)
const em = await q(`escala_mensal?select=id,servidor_id,mes,ano,status,unidade_id,setor_id&servidor_id=in.(${ids.join(',')})`)
const ed = em.length? await q(`escala_diaria?select=escala_mensal_id,dia,categoria,dicionario_turnos_id,hora_inicio_prevista,presenca_entrada_em&escala_mensal_id=in.(${em.map(e=>e.id).join(',')})`):[]
const T = Object.fromEntries((await q('dicionario_turnos?select=id,codigo,horario_inicio,horas_computadas')).map(t=>[t.id,t]))
const un = Object.fromEntries((await q('unidades?select=id,nome')).map(u=>[u.id,u.nome]))
const emx = Object.fromEntries(em.map(e=>[e.id,e]))
const min = h => { if(!h) return null; const [a,b]=h.split(':'); return Number(a)*60+Number(b) }
console.log(`competencias presentes: ${[...new Set(em.map(e=>`${e.ano}-${String(e.mes).padStart(2,'0')}`))].sort().join(', ')}`)

let pares=0, sobre=0, semHora=0
const lista=[]
for(const g of grupos){
  const jan = g.ids.map(id => { const m={}
    for(const d of ed){ const e=emx[d.escala_mensal_id]; if(!e||e.servidor_id!==id) continue
      const t=T[d.dicionario_turnos_id]; const ini=min(d.hora_inicio_prevista)??min(t?.horario_inicio)
      const dur=Number(t?.horas_computadas)||0; const k=`${e.ano}-${String(e.mes).padStart(2,'0')}-${String(d.dia).padStart(2,'0')}`
      ;(m[k]||=[]).push(ini==null||!dur?null:[ini,ini+dur*60,t?.codigo,d.categoria,e.status,un[e.unidade_id],!!d.presenca_entrada_em]) }
    return m })
  for(const k of Object.keys(jan[0]||{})){
    if(!jan[1]?.[k]) continue
    pares++
    const A=jan[0][k],B=jan[1][k]
    if(A.some(x=>!x)||B.some(x=>!x)){ semHora++; continue }
    let cruz=null
    for(const a of A) for(const b of B){ const s=Math.max(a[0],b[0]),e=Math.min(a[1],b[1]); if(e-s>15) cruz=[a,b,e-s] }
    if(cruz){ sobre++
      lista.push(`${g.nome.trim()} ${k}  mat ${g.mats[0]} ${cruz[0][3]}:${cruz[0][2]} [${cruz[0][5]}/${cruz[0][4]}]${cruz[0][6]?' COM PONTO':''}  X  mat ${g.mats[1]} ${cruz[1][3]}:${cruz[1][2]} [${cruz[1][5]}/${cruz[1][4]}]${cruz[1][6]?' COM PONTO':''}  (${cruz[2]}min)`) }
  }
}
console.log(`\npares (dia com turno nas DUAS matriculas): ${pares}`)
console.log(`  SOBREPOSTOS (>15min) -> a trava nova bloquearia: ${sobre}`)
console.log(`  sem horario resolvivel: ${semHora}`)
console.log(`  disjuntos (ok): ${pares-sobre-semHora}`)
if(lista.length){ console.log(`\n--- o que precisa ser limpo ANTES de ligar a trava ---`); lista.forEach(l=>console.log('  '+l)) }
