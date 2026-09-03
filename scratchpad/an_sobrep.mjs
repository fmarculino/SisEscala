import { get, rpc } from './q.mjs'
const dts = await get(`dicionario_turnos?select=id,codigo,slots,horas_computadas,horario_inicio`)
const DT=Object.fromEntries(dts.map(d=>[d.id,d]))
const jor = await get(`jornadas?select=id,nome`); const J=Object.fromEntries(jor.map(j=>[j.id,j]))
const ems = await get(`escala_mensal?ativo=eq.true&select=id,servidor_id,mes,ano,jornada_id,unidade_id,status`)
const EM=Object.fromEntries(ems.map(e=>[e.id,e]))
const eds = await get(`escala_diaria?select=id,escala_mensal_id,dia,categoria,dicionario_turnos_id,hora_inicio_prevista,presenca_entrada_em,presenca_saida_em,presenca_entrada_origem`)
const ED=Object.fromEntries(eds.map(e=>[e.id,e]))
const sv = await get(`servidores?select=id,nome,matricula`); const SV=Object.fromEntries(sv.map(s=>[s.id,s]))
const un = await get(`unidades?select=id,nome`); const UN=Object.fromEntries(un.map(u=>[u.id,u]))

const ids=ems.map(e=>e.id); const blocos=[]
for(let i=0;i<ids.length;i+=25){ const r=await rpc('fn_blocos_previstos_mes',{p_escala_mensal_ids:ids.slice(i,i+25)}); if(!Array.isArray(r)) throw new Error('lote '+i+': '+String(r).slice(0,200)); if(r.length>=1000) throw new Error('teto 1000 no lote '+i); blocos.push(...r) }
console.log('escalas:',ids.length,'blocos:',blocos.length,'temCharlene:',blocos.some(b=>b.escala_mensal_id==='c6144a3c-bd07-4e51-92d0-33a5ca021748'))

const F = t=>new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
// turnos previstos por (escala_diaria_id)
const prev = new Map()
for(const b of blocos){ const L=b.escala_diaria_ids||[]
  for(let i=0;i<L.length;i++) prev.set(L[i],{ini:(b.turnos_inicio||[])[i]??b.inicio_previsto, fim:(b.turnos_fim||[])[i]??b.fim_previsto, fundido:L.length>1, bloco:b}) }

const g=new Map(); for(const e of eds){const k=e.escala_mensal_id+'|'+e.dia; if(!g.has(k))g.set(k,[]); g.get(k).push(e)}
const casos=[]
for(const [k,linhas] of g){
  const reg=linhas.find(l=>l.categoria==='Regular'); if(!reg) continue
  const pr=prev.get(reg.id); if(!pr) continue
  for(const l of linhas){
    if(l.categoria!=='Plantão') continue
    const pp=prev.get(l.id); if(!pp) continue
    const overlap = new Date(pp.ini) < new Date(pr.fim) && new Date(pp.fim) > new Date(pr.ini)
    if(!overlap) continue
    const em=EM[l.escala_mensal_id]; const dt=DT[l.dicionario_turnos_id]
    casos.push({ comp:`${em.ano}-${String(em.mes).padStart(2,'0')}`, un:(UN[em.unidade_id]||{}).nome,
      servidor:(SV[em.servidor_id]||{}).nome, mat:(SV[em.servidor_id]||{}).matricula, dia:l.dia,
      cod:dt.codigo, jornada:(J[em.jornada_id]||{}).nome,
      reg:`${F(pr.ini)}-${F(pr.fim)}`, pl:`${F(pp.ini)}-${F(pp.fim)}`,
      niv1: !!l.hora_inicio_prevista, ancora: dt.horario_inicio,
      ponto: !!(l.presenca_entrada_em||l.presenca_saida_em), status:em.status, edId:l.id, emId:l.escala_mensal_id,
      regPonto: !!(reg.presenca_entrada_em||reg.presenca_saida_em) })
  }
}
console.log('PLANTAO PREVISTO SOBREPOSTO AO REGULAR:', casos.length)
const pc={}; for(const c of casos){pc[c.comp]=(pc[c.comp]||0)+1}; console.log('por competencia:',pc)
const cc={}; for(const c of casos){cc[c.cod]=(cc[c.cod]||0)+1}; console.log('codigos:',cc)
console.log('com ponto no plantao:', casos.filter(c=>c.ponto).length)
console.log('servidores:', new Set(casos.map(c=>c.mat)).size, '| unidades:', [...new Set(casos.map(c=>c.un))])
console.log('\n-- todos:'); for(const c of casos) console.log(`${c.comp} d${String(c.dia).padStart(2)} ${c.cod.padEnd(3)} ${String(c.mat).padEnd(6)} ${(c.servidor||'').slice(0,26).padEnd(26)} jor=${(c.jornada||'').padEnd(11)} REG ${c.reg} | PLANTAO ${c.pl} ${c.ponto?'PONTO':''}`)
import fs from 'fs'; fs.writeFileSync('scratchpad/_sobrep.json',JSON.stringify(casos,null,1))
