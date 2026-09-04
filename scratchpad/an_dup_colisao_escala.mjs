import { all } from './an_duplicados.mjs'
const sv = await all('servidores?select=id,nome,matricula,cpf,status')
const norm=s=>(s||'').replace(/\D/g,'')
const m=new Map(); for(const s of sv){const c=norm(s.cpf); if(!c)continue; (m.get(c)||m.set(c,[]).get(c)).push(s)}
const grupos=[...m.values()].filter(v=>v.length>1)
const ids=grupos.flat().map(s=>s.id)
const em = await all(`escala_mensal?select=id,servidor_id,mes,ano,unidade_id,setor_id,status&servidor_id=in.(${ids.join(',')})`)
const fp = await all(`folha_ponto?select=id,servidor_id,mes,ano,status&servidor_id=in.(${ids.join(',')})`)
let colEscala=0, colFolha=0
for(const g of grupos){
  const [a,b]=g
  const ea=em.filter(e=>e.servidor_id===a.id), eb=em.filter(e=>e.servidor_id===b.id)
  const comp=ea.filter(x=>eb.some(y=>y.mes===x.mes&&y.ano===x.ano))
  const mesmoSetor=ea.filter(x=>eb.some(y=>y.mes===x.mes&&y.ano===x.ano&&y.unidade_id===x.unidade_id&&y.setor_id===x.setor_id))
  const fa=fp.filter(e=>e.servidor_id===a.id), fb=fp.filter(e=>e.servidor_id===b.id)
  const fcomp=fa.filter(x=>fb.some(y=>y.mes===x.mes&&y.ano===x.ano))
  if(comp.length){colEscala++; console.log(`${a.nome.trim()}: ${comp.length} competencia(s) com escala nos DOIS (mesmo setor: ${mesmoSetor.length}) | folha nos dois: ${fcomp.length}`)}
  if(fcomp.length) colFolha++
}
console.log(`\ngrupos: ${grupos.length} | com escala na mesma competencia nos dois: ${colEscala} | com folha na mesma competencia: ${colFolha}`)
console.log('status das folhas envolvidas:', [...new Set(fp.map(f=>f.status))].join(', '))
