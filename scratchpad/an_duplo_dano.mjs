// SOMENTE LEITURA. Onde a batida REALMENTE caiu, contra o previsto de cada matricula.
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
const tz='America/Sao_Paulo'
const hm = iso => new Intl.DateTimeFormat('pt-BR',{timeZone:tz,hour:'2-digit',minute:'2-digit'}).format(new Date(iso))
const dia = iso => new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso))
const grupos = JSON.parse(fs.readFileSync('scratchpad/_dup_ids.json','utf8')).filter(g=>g.mesma)
const ids = grupos.flatMap(g=>g.ids)
const marc = await q(`marcacoes_ponto?select=servidor_id,ocorrido_em,dispositivo_id&origem=eq.rep&ocorrido_em=gte.2026-09-01&servidor_id=in.(${ids.join(',')})&order=ocorrido_em`)
const em = await q(`escala_mensal?select=id,servidor_id&servidor_id=in.(${ids.join(',')})&ano=eq.2026&mes=eq.9`)
const ed = em.length? await q(`escala_diaria?select=escala_mensal_id,dia,dicionario_turnos_id,presenca_entrada_em,presenca_saida_em&escala_mensal_id=in.(${em.map(e=>e.id).join(',')})`):[]
const turnos = Object.fromEntries((await q('dicionario_turnos?select=id,codigo,horario_inicio')).map(t=>[t.id,t]))
const emServ = Object.fromEntries(em.map(e=>[e.id,e.servidor_id]))

console.log('=== 09/2026: em que MATRICULA a batida caiu, e qual estava prevista naquela hora ===')
let batidasNaMatriculaErrada=0, total=0
for(const g of grupos){
  const ms = marc.filter(m=>g.ids.includes(m.servidor_id))
  if(!ms.length) continue
  // previsto por matricula por dia
  const prev = {}
  for(const d of ed){
    const sid = emServ[d.escala_mensal_id]; if(!g.ids.includes(sid)) continue
    const t = turnos[d.dicionario_turnos_id]; if(!t) continue
    prev[`${sid}|${d.dia}`] = t
  }
  console.log(`\n${g.nome.trim()}  [mat ${g.mats[0]} = ${g.ids[0].slice(0,6)}.. | mat ${g.mats[1]} = ${g.ids[1].slice(0,6)}..]`)
  const porDia = {}
  for(const m of ms){ const d=dia(m.ocorrido_em); (porDia[d]||=[]).push(m) }
  for(const [d, lista] of Object.entries(porDia).slice(0,8)){
    const nd = Number(d.slice(-2))
    const turnoDe = i => prev[`${g.ids[i]}|${nd}`]?.codigo
    const desc = lista.map(m=>{
      const i = g.ids.indexOf(m.servidor_id)
      const h = hm(m.ocorrido_em)
      total++
      // heuristica de leitura: batida perto de 07 pertence a MT, perto de 19 a N
      const hora = Number(h.slice(0,2))
      const esperadoMT = hora>=5 && hora<12, esperadoN = hora>=17 || hora<8
      return `${h}->mat ${g.mats[i]}`
    })
    console.log(`   ${d}  previsto: mat ${g.mats[0]}=${turnoDe(0)||'-'} / mat ${g.mats[1]}=${turnoDe(1)||'-'}   batidas: ${desc.join('  ')}`)
  }
}
