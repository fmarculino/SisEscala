// SOMENTE LEITURA. Em quantos dias os DOIS vinculos tem janela de horario SOBREPOSTA?
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
const grupos = JSON.parse(fs.readFileSync('scratchpad/_dup_ids.json','utf8')).filter(g=>g.mesma)
const ids = grupos.flatMap(g=>g.ids)
const em = await q(`escala_mensal?select=id,servidor_id,mes,ano&servidor_id=in.(${ids.join(',')})&ano=eq.2026&mes=in.(8,9)`)
const ed = em.length? await q(`escala_diaria?select=escala_mensal_id,dia,categoria,dicionario_turnos_id,hora_inicio_prevista&escala_mensal_id=in.(${em.map(e=>e.id).join(',')})`):[]
const T = Object.fromEntries((await q('dicionario_turnos?select=id,codigo,horario_inicio,horas_computadas')).map(t=>[t.id,t]))
const emx = Object.fromEntries(em.map(e=>[e.id,e]))
const min = h => { if(!h) return null; const [a,b]=h.split(':'); return Number(a)*60+Number(b) }

let diasComum=0, sobrepostos=0, disjuntos=0, semHora=0
const casos=[]
for(const g of grupos){
  const janelas = g.ids.map(id => {
    const map = {}
    for(const d of ed){ const e=emx[d.escala_mensal_id]; if(!e||e.servidor_id!==id) continue
      const t=T[d.dicionario_turnos_id]; const ini=min(d.hora_inicio_prevista)??min(t?.horario_inicio)
      const dur=Number(t?.horas_computadas)||0
      const k=`${e.ano}-${e.mes}-${d.dia}`
      if(ini==null||!dur){ (map[k]||=[]).push(null); continue }
      ;(map[k]||=[]).push([ini, ini+dur*60, t?.codigo, d.categoria]) }
    return map })
  for(const k of Object.keys(janelas[0])){
    if(!janelas[1]?.[k]) continue
    diasComum++
    const A=janelas[0][k], B=janelas[1][k]
    if(A.some(x=>!x)||B.some(x=>!x)){ semHora++; continue }
    let cruz=false
    for(const a of A) for(const b of B){ const s=Math.max(a[0],b[0]), e=Math.min(a[1],b[1]); if(e-s>15) cruz=true }
    if(cruz){ sobrepostos++; casos.push(`${g.nome.trim()} ${k}: ${A.map(a=>`${a[3]}:${a[2]} ${Math.floor(a[0]/60)}h-${Math.floor(a[1]/60)%24}h`).join('+')}  X  ${B.map(b=>`${b[3]}:${b[2]} ${Math.floor(b[0]/60)}h-${Math.floor(b[1]/60)%24}h`).join('+')}`) }
    else disjuntos++
  }
}
console.log(`dias em que AS DUAS matriculas tem turno (08+09/2026): ${diasComum}`)
console.log(`  janelas DISJUNTAS (a escala desambigua sozinha): ${disjuntos}`)
console.log(`  janelas SOBREPOSTAS (>15min): ${sobrepostos}`)
console.log(`  sem horario resolvivel: ${semHora}`)
if(casos.length){ console.log(`\n--- os sobrepostos ---`); casos.forEach(c=>console.log('  '+c)) }
