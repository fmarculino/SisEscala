import fs from 'fs'
import { get, rpc } from './q.mjs'
const MES=9, ANO=2026
const F=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'
const ems = await get(`escala_mensal?ativo=eq.true&ano=eq.${ANO}&mes=eq.${MES}&select=id,servidor_id,unidade_id`)
const EM=Object.fromEntries(ems.map(e=>[e.id,e]))
const eds = await get(`escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em`)
const ED=Object.fromEntries(eds.map(e=>[e.id,e]))
const sv = await get(`servidores?select=id,nome,matricula`); const SV=Object.fromEntries(sv.map(s=>[s.id,s]))
// dias com alguma presenca ou marcacao em 09/2026 (so os 3 dias ja decorridos)
const pares=new Set()
for(const e of eds){ const em=EM[e.escala_mensal_id]; if(!em) continue
  if(e.dia<=3 && (e.presenca_entrada_em||e.presenca_saida_em)) pares.add(em.servidor_id+'|'+e.dia) }
console.log('pares (servidor,dia) com presenca em 01-03/09:', pares.size)
const campos=[['entrada','presenca_entrada_em','entrada_em'],['int_saida','presenca_intervalo_saida_em','int_saida_em'],
  ['int_retorno','presenca_intervalo_retorno_em','int_ret_em'],['saida','presenca_saida_em','saida_em']]
const ganho=[], troca=[], perda=[]
for(const par of pares){
  const [s,d]=par.split('|')
  const data=`${ANO}-${String(MES).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  const p=await rpc('fn_projecao_marcacoes_dia',{p_servidor_id:s,p_data:data})
  if(!Array.isArray(p)) continue
  for(const linha of p){
    const l=ED[linha.escala_diaria_id]; if(!l) continue
    if(String(l.dia)!==String(d)) continue   // so a linha do proprio dia
    for(const [nome,colBanco,colProj] of campos){
      const b=l[colBanco]?new Date(l[colBanco]).getTime():null
      const j=linha[colProj]?new Date(linha[colProj]).getTime():null
      if(b===j) continue
      const item={mat:(SV[s]||{}).matricula,nome:(SV[s]||{}).nome,dia:l.dia,cat:l.categoria,campo:nome,
        banco:F(l[colBanco]),proj:F(linha[colProj]),edId:l.id,sv:s,data}
      if(b===null&&j!==null) ganho.push(item)
      else if(b!==null&&j===null) perda.push(item)
      else troca.push(item)
    }
  }
}
console.log('\nGANHO  (banco vazio -> projecao preenche):', ganho.length)
console.log('TROCA  (valores diferentes):', troca.length)
console.log('PERDA  (banco preenchido -> projecao vazia):', perda.length)
const p=(t,arr)=>{console.log(`\n-- ${t}`); for(const x of arr.slice(0,20)) console.log(` d${String(x.dia).padStart(2)} ${x.cat.padEnd(8)} ${String(x.mat).padEnd(6)} ${(x.nome||'').slice(0,22).padEnd(22)} ${x.campo.padEnd(11)} banco ${x.banco} -> proj ${x.proj}`)}
p('GANHO',ganho); p('TROCA',troca); p('PERDA',perda)
fs.writeFileSync('scratchpad/_diverg.json',JSON.stringify({ganho,troca,perda},null,1))
