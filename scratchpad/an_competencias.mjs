import { get, rpc } from './q.mjs'
const c = await get(`competencias?select=*&order=ano,mes`).catch(()=>null)
if(c) { console.log('COMPETENCIAS:'); for(const x of c) console.log(' ', JSON.stringify(x)) }
for(const [m,a] of [[6,2026],[7,2026],[8,2026],[9,2026],[10,2026]]){
  const r = await rpc('fn_competencia_encerrada',{p_mes:m,p_ano:a})
  console.log(`  ${String(m).padStart(2,'0')}/${a} encerrada=${r}`)
}
