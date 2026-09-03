import fs from 'fs'
import { get } from './q.mjs'
const mudam = JSON.parse(fs.readFileSync('scratchpad/_mudam_2b.json','utf8'))
const sv = await get(`servidores?select=id,nome,matricula`); const porMat=Object.fromEntries(sv.map(s=>[s.matricula,s]))
const ems = await get(`escala_mensal?ativo=eq.true&ano=eq.2026&mes=eq.9&select=id,servidor_id,unidade_id`)
const EM=Object.fromEntries(ems.map(e=>[e.id,e]))
const un = await get(`unidades?select=id,nome`); const UN=Object.fromEntries(un.map(u=>[u.id,u]))
const eds = await get(`escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em,presenca_entrada_origem,presenca_saida_origem`)
const F=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'
const idx=new Map(); for(const e of eds){const em=EM[e.escala_mensal_id]; if(!em)continue; idx.set(`${em.servidor_id}|${e.dia}|${e.categoria}`,e)}
let comPonto=0; const lista=[]
for(const m of mudam){
  const s=porMat[m.mat]; if(!s) continue
  const pl=idx.get(`${s.id}|${m.dia}|Plantão`), rg=idx.get(`${s.id}|${m.dia}|Regular`)
  const temPonto = (pl&&(pl.presenca_entrada_em||pl.presenca_saida_em))||(rg&&(rg.presenca_entrada_em||rg.presenca_saida_em))
  if(temPonto){ comPonto++
    lista.push({mat:m.mat,nome:m.nome,dia:m.dia,sv:s.id,
      un:UN[EM[(pl||rg).escala_mensal_id].unidade_id]?.nome,
      reg: rg?`${F(rg.presenca_entrada_em)} -> ${F(rg.presenca_saida_em)}`:'(sem linha)',
      pl:  pl?`${F(pl.presenca_entrada_em)} -> ${F(pl.presenca_saida_em)}`:'(sem linha)'}) }
}
console.log(`dos ${mudam.length} plantoes que mudam, ${comPonto} JA TEM PONTO gravado (precisam de reconciliacao):`)
for(const x of lista) console.log(`  d${String(x.dia).padStart(2)} ${String(x.mat).padEnd(6)} ${(x.nome||'').slice(0,26).padEnd(26)} REG ${x.reg.padEnd(30)} PLANTAO ${x.pl}`)
const dias=[...new Set(lista.map(x=>x.dia))].sort((a,b)=>a-b)
console.log('\ndias envolvidos:', dias.join(', '))
fs.writeFileSync('scratchpad/_afetados.json',JSON.stringify(lista,null,1))
