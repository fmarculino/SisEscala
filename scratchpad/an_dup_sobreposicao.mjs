import { all } from './an_duplicados.mjs'
const sv = await all('servidores?select=id,nome,matricula,cpf')
const norm=s=>(s||'').replace(/\D/g,'')
const m=new Map(); for(const s of sv){const c=norm(s.cpf); if(!c)continue; (m.get(c)||m.set(c,[]).get(c)).push(s)}
const grupos=[...m.values()].filter(v=>v.length>1)
const ids=grupos.flat().map(s=>s.id)
const em = await all(`escala_mensal?select=id,servidor_id,mes,ano,unidade_id,setor_id&servidor_id=in.(${ids.join(',')})`)
const emIds = em.map(e=>e.id)
const ed = emIds.length ? await all(`escala_diaria?select=escala_mensal_id,dia,categoria,dicionario_turnos_id,dicionario_turnos(codigo,slots)&escala_mensal_id=in.(${emIds.join(',')})`) : []
const porEm = new Map(); for(const d of ed){ (porEm.get(d.escala_mensal_id)||porEm.set(d.escala_mensal_id,[]).get(d.escala_mensal_id)).push(d) }
let comSobrep=0
for(const g of grupos){
  const [a,b]=g
  const dias = s => em.filter(e=>e.servidor_id===s.id).flatMap(e=>(porEm.get(e.id)||[]).map(d=>({...d, mes:e.mes, ano:e.ano, setor:e.setor_id})))
  const A=dias(a), B=dias(b)
  const confl=[]
  for(const x of A) for(const y of B){
    if(x.mes!==y.mes||x.ano!==y.ano||x.dia!==y.dia) continue
    const sx=x.dicionario_turnos?.slots||[], sy=y.dicionario_turnos?.slots||[]
    if(sx.some(v=>sy.includes(v))) confl.push(`${x.dia}/${x.mes} ${x.dicionario_turnos?.codigo}x${y.dicionario_turnos?.codigo}`)
  }
  if(confl.length){comSobrep++; console.log(`${a.nome.trim()} (${a.matricula} x ${b.matricula}): ${confl.length} dia(s) com slot sobreposto -> ${confl.slice(0,6).join(', ')}`)}
}
console.log(`\ngrupos: ${grupos.length} | com sobreposicao de slot entre os dois cadastros: ${comSobrep}`)
console.log(`linhas de escala_diaria envolvidas: ${ed.length}`)
