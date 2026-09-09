// SOMENTE LEITURA. Nos casos de MESMA unidade: as duas matriculas se sobrepoem no dia?
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
const em = await q(`escala_mensal?select=id,servidor_id,mes,ano,setor_id&servidor_id=in.(${ids.join(',')})&ano=eq.2026&mes=in.(8,9)`)
const emIds = em.map(e=>e.id)
const ed = emIds.length ? await q(`escala_diaria?select=escala_mensal_id,dia,categoria,dicionario_turnos_id,hora_inicio_prevista&escala_mensal_id=in.(${emIds.join(',')})`) : []
const turnos = Object.fromEntries((await q('dicionario_turnos?select=id,codigo,horario_inicio,horas_computadas')).map(t=>[t.id,t]))
const setores = Object.fromEntries((await q('setores?select=id,dicionario_setores(nome)')).map(s=>[s.id,s.dicionario_setores?.nome||'?']))
const porEm = {}; for(const e of em) porEm[e.id]=e

console.log('=== 10 CASOS DE MESMA UNIDADE: dias em que AS DUAS matriculas tem turno (08 e 09/2026) ===')
let comColisao=0, semColisao=0
for(const g of grupos){
  const porMat = g.ids.map(id => {
    const meus = em.filter(e=>e.servidor_id===id)
    const dias = {}
    for(const e of meus) for(const d of ed.filter(x=>x.escala_mensal_id===e.id)){
      const t = turnos[d.dicionario_turnos_id]
      const k = `${e.ano}-${String(e.mes).padStart(2,'0')}-${String(d.dia).padStart(2,'0')}`
      ;(dias[k] ||= []).push(`${d.categoria}:${t?.codigo||'?'}@${d.hora_inicio_prevista||t?.horario_inicio||'?'}(${t?.horas_computadas||'?'}h)[${setores[e.setor_id]||'?'}]`)
    }
    return dias
  })
  const comuns = Object.keys(porMat[0]).filter(k=>porMat[1]&&porMat[1][k])
  const totA=Object.keys(porMat[0]).length, totB=porMat[1]?Object.keys(porMat[1]).length:0
  if(comuns.length) comColisao++; else semColisao++
  console.log(`\n${g.nome.trim()}  mat ${g.mats[0]}: ${totA} dias | mat ${g.mats[1]}: ${totB} dias | DIAS EM COMUM: ${comuns.length}`)
  for(const k of comuns.slice(0,6))
    console.log(`   ${k}  mat ${g.mats[0]} -> ${porMat[0][k].join(' + ')}\n${' '.repeat(15)}mat ${g.mats[1]} -> ${porMat[1][k].join(' + ')}`)
}
console.log(`\ncom dias em comum: ${comColisao} | sem dias em comum: ${semColisao}`)
