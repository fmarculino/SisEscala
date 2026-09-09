import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
const q = async p => { const r = await fetch(`${U}/rest/v1/${p}`,{headers:H}); if(!r.ok){console.error(r.status,(await r.text()).slice(0,200));process.exit(1)} return r.json() }
const servs = await q('servidores?select=id,nome,matricula,unidade_id,setor_id&matricula=in.(67454,15892)')
const ids = servs.map(s=>s.id)
const em = await q(`escala_mensal?select=id,servidor_id,mes,ano,status,unidade_id,setor_id&servidor_id=in.(${ids.join(',')})&ano=eq.2026&mes=in.(8,9)`)
const T = Object.fromEntries((await q('dicionario_turnos?select=id,codigo,horario_inicio,horas_computadas,slots')).map(t=>[t.id,t]))
const set = Object.fromEntries((await q('setores?select=id,dicionario_setores(nome)')).map(s=>[s.id,s.dicionario_setores?.nome||'?']))
console.log('=== EDILEUZA — escalas 08 e 09/2026 ===')
for (const s of servs) {
  console.log(`\nmat ${s.matricula} (${s.id.slice(0,8)})`)
  for (const e of em.filter(x=>x.servidor_id===s.id)) {
    const ed = await q(`escala_diaria?select=dia,categoria,dicionario_turnos_id,presenca_entrada_em,presenca_saida_em&escala_mensal_id=eq.${e.id}&order=dia`)
    console.log(`  ${String(e.mes).padStart(2,'0')}/${e.ano} setor=${set[e.setor_id]} status=${e.status} — ${ed.length} dias`)
    const porDia = {}
    for (const d of ed) (porDia[d.dia] ||= []).push(`${d.categoria}:${T[d.dicionario_turnos_id]?.codigo||'?'}${d.presenca_entrada_em?'*':''}`)
    console.log('    ' + Object.entries(porDia).map(([d,v])=>`${d}:${v.join('+')}`).join('  '))
  }
}
// sobreposicao no mesmo dia
console.log('\n=== dias com turno nas DUAS matriculas (09/2026) ===')
const emSet = Object.fromEntries(em.map(e=>[e.id,e]))
const todos = {}
for (const e of em.filter(x=>x.mes===9)) {
  const ed = await q(`escala_diaria?select=dia,categoria,dicionario_turnos_id&escala_mensal_id=eq.${e.id}`)
  for (const d of ed) {
    const t = T[d.dicionario_turnos_id]
    ;(todos[d.dia] ||= []).push({ mat: servs.find(s=>s.id===e.servidor_id).matricula, cod: t?.codigo, slots: t?.slots, cat: d.categoria })
  }
}
let n=0
for (const [dia, v] of Object.entries(todos)) {
  const mats = [...new Set(v.map(x=>x.mat))]
  if (mats.length < 2) continue
  n++
  const cruza = v.some(a=>v.some(b=>a.mat!==b.mat && a.slots?.some(s=>b.slots?.includes(s))))
  console.log(`  dia ${String(dia).padStart(2)} ${cruza?'🚨 SLOT CRUZADO':'ok (complementares)'}  ${v.map(x=>`mat ${x.mat} ${x.cat}:${x.cod}[${(x.slots||[]).join('')}]`).join('  |  ')}`)
}
if(!n) console.log('  nenhum')
