import fs from 'fs'
import { get } from './q.mjs'
const casos = JSON.parse(fs.readFileSync('scratchpad/_sobrep.json','utf8')).filter(c=>c.comp==='2026-09')
const ids = casos.map(c=>c.edId ?? null).filter(Boolean)
const sv = await get(`servidores?select=id,nome,matricula`); const SV=Object.fromEntries(sv.map(s=>[s.id,s]))
const F = t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'
// pega TODAS as linhas do dia dos casos com ponto
const alvo = casos.filter(c=>c.ponto)
console.log('casos 09/2026 com ponto:', alvo.length)
const ems = await get(`escala_mensal?ano=eq.2026&mes=eq.9&ativo=eq.true&select=id,servidor_id,jornada_id`)
const EM=Object.fromEntries(ems.map(e=>[e.id,e]))
const eds = await get(`escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em,presenca_entrada_origem,presenca_saida_origem,dicionario_turnos_id`)
const dts = await get(`dicionario_turnos?select=id,codigo,horas_computadas`); const DT=Object.fromEntries(dts.map(d=>[d.id,d]))
const jor = await get(`jornadas?select=id,nome,horas_totais`); const J=Object.fromEntries(jor.map(j=>[j.id,j]))
const byId = Object.fromEntries(eds.map(e=>[e.id,e]))
const g=new Map(); for(const e of eds){const k=e.escala_mensal_id+'|'+e.dia; if(!g.has(k))g.set(k,[]); g.get(k).push(e)}
let extraTotal=0
for(const c of alvo){
  const l = byId[c.edId]; if(!l) continue
  const em = EM[l.escala_mensal_id]; if(!em) continue
  const linhas = g.get(l.escala_mensal_id+'|'+l.dia)
  console.log(`\n${c.servidor} (${c.mat}) dia ${c.dia} — jornada ${c.jornada} | previsto REG ${c.reg} / PLANTAO(${c.cod}) ${c.pl}`)
  for(const x of linhas){
    const dur = x.presenca_entrada_em&&x.presenca_saida_em ? ((new Date(x.presenca_saida_em)-new Date(x.presenca_entrada_em))/3.6e6).toFixed(2) : '—'
    const prevH = x.categoria==='Regular' ? (J[em.jornada_id]||{}).horas_totais : (DT[x.dicionario_turnos_id]||{}).horas_computadas
    if(x.categoria==='Regular' && dur!=='—') extraTotal += Math.max(0, dur-prevH)
    console.log(`   ${x.categoria.padEnd(10)} ${(DT[x.dicionario_turnos_id]||{}).codigo||''} : ${F(x.presenca_entrada_em)} -> ${F(x.presenca_saida_em)}  = ${dur}h  (previsto ${prevH}h)`)
  }
}
console.log('\nHORA EXTRA INDEVIDA aparente no Regular (09/2026, estes dias):', extraTotal.toFixed(2),'h')
