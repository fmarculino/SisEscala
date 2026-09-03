import { get, rpc } from './q.mjs'
const F=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'
const ems = await get(`escala_mensal?ativo=eq.true&ano=eq.2026&mes=in.(8,9,10)&select=id,servidor_id,mes,ano,unidade_id`)
const EM=Object.fromEntries(ems.map(e=>[e.id,e]))
const eds = await get(`escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em,presenca_entrada_origem,presenca_saida_origem`)
const ED=Object.fromEntries(eds.map(e=>[e.id,e]))
const sv = await get(`servidores?select=id,nome,matricula`); const SV=Object.fromEntries(sv.map(s=>[s.id,s]))
const un = await get(`unidades?select=id,nome`); const UN=Object.fromEntries(un.map(u=>[u.id,u]))

const ids=ems.map(e=>e.id); const blocos=[]
for(let i=0;i<ids.length;i+=25){
  const r=await rpc('fn_blocos_previstos_mes',{p_escala_mensal_ids:ids.slice(i,i+25)})
  if(!Array.isArray(r)) throw new Error('lote '+i+': '+String(r).slice(0,200))
  if(r.length>=1000) throw new Error('teto 1000 no lote '+i)
  blocos.push(...r)
}
console.log('escalas', ids.length, 'blocos', blocos.length)

// blocos que cruzam a meia-noite
const dISO = t => new Date(t).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})
const cruzam = blocos.filter(b => b.inicio_previsto && b.fim_previsto && dISO(b.inicio_previsto)!==dISO(b.fim_previsto))
console.log('blocos que cruzam a meia-noite:', cruzam.length)

const semSaida=[], semEntrada=[]
for(const b of cruzam){
  for(const id of (b.escala_diaria_ids||[])){
    const l=ED[id]; if(!l) continue
    const em=EM[l.escala_mensal_id]; if(!em) continue
    const info={ comp:`${em.ano}-${String(em.mes).padStart(2,'0')}`, un:(UN[em.unidade_id]||{}).nome,
      sv:em.servidor_id, nome:(SV[em.servidor_id]||{}).nome, mat:(SV[em.servidor_id]||{}).matricula,
      dia:l.dia, cat:l.categoria, prev:`${F(b.inicio_previsto)}→${F(b.fim_previsto)}`,
      ent:F(l.presenca_entrada_em), sai:F(l.presenca_saida_em), edId:id }
    if(l.presenca_entrada_em && !l.presenca_saida_em) semSaida.push(info)
    if(!l.presenca_entrada_em && l.presenca_saida_em) semEntrada.push(info)
  }
}
console.log('\nturno que cruza a meia-noite COM entrada e SEM saida:', semSaida.length)
console.log('turno que cruza a meia-noite SEM entrada e COM saida:', semEntrada.length)
const pc={}; for(const x of semSaida) pc[x.comp]=(pc[x.comp]||0)+1; console.log('sem saida por competencia:',pc)
import fs from 'fs'; fs.writeFileSync('scratchpad/_cruza.json',JSON.stringify({semSaida,semEntrada},null,1))
for(const x of semSaida.slice(0,25)) console.log(` ${x.comp} d${String(x.dia).padStart(2)} ${x.cat.padEnd(8)} ${String(x.mat).padEnd(6)} ${(x.nome||'').slice(0,24).padEnd(24)} prev ${x.prev} | ent ${x.ent} sai ${x.sai}`)
