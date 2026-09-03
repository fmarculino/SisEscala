import { get } from './q.mjs'
const dts=await get(`dicionario_turnos?select=id,codigo,slots,horas_computadas,horario_inicio,ativo`)
const DT=Object.fromEntries(dts.map(d=>[d.id,d]))
console.log('codigos com ancora:', dts.filter(d=>d.horario_inicio).length, '| sem ancora (Classe B):', dts.filter(d=>!d.horario_inicio).length, '| total', dts.length)
const eds=await get(`escala_diaria?categoria=eq.Plantão&select=id,escala_mensal_id,dia,dicionario_turnos_id,hora_inicio_prevista`)
console.log('\nlinhas de Plantao na base:', eds.length)
console.log('  com hora_inicio_prevista (nivel 1):', eds.filter(e=>e.hora_inicio_prevista).length)
const semAnc = eds.filter(e=>!(DT[e.dicionario_turnos_id]||{}).horario_inicio)
console.log('  de codigo Classe B (sem ancora):', semAnc.length, '| destes, SEM hora informada:', semAnc.filter(e=>!e.hora_inicio_prevista).length)
// quantos Classe B sem hora convivem com Regular no mesmo dia
const all=await get(`escala_diaria?select=escala_mensal_id,dia,categoria`)
const comReg=new Set(all.filter(a=>a.categoria==='Regular').map(a=>a.escala_mensal_id+'|'+a.dia))
const risco=semAnc.filter(e=>!e.hora_inicio_prevista && comReg.has(e.escala_mensal_id+'|'+e.dia))
console.log('  Classe B sem hora E com Regular no mesmo dia (empilhamento certo):', risco.length)
const cb={}; for(const e of risco){const c=(DT[e.dicionario_turnos_id]||{}).codigo; cb[c]=(cb[c]||0)+1}
console.log('   por codigo:', cb)
