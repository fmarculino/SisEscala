import { get, rpc } from './q.mjs'
const ems = await get(`escala_mensal?ano=eq.2026&mes=eq.9&ativo=eq.true&select=id,servidor_id`)
const eds = await get(`escala_diaria?select=escala_mensal_id,dia,presenca_entrada_em`)
const comPonto=new Set(eds.filter(e=>e.presenca_entrada_em).map(e=>e.escala_mensal_id+'|'+e.dia))
const pares=[]
for(const e of ems) for(const d of [1,2,3]) if(comPonto.has(e.id+'|'+d)) pares.push({sv:e.servidor_id,d:`2026-09-0${d}`})
console.log('pares (servidor,dia) com ponto em 01-03/09:', pares.length)
const hist={}; let tot=0; const grandes=[]
for(const p of pares){
  const r = await rpc('fn_alocar_marcacoes_dia',{p_servidor_id:p.sv,p_data:p.d})
  if(!r || !r.alocacoes) continue
  for(const a of r.alocacoes){
    tot++
    const d=Number(a.distancia_min)
    const faixa = d<=15?'0-15':d<=30?'16-30':d<=60?'31-60':d<=120?'61-120':d<=240?'121-240':'241-360'
    hist[faixa]=(hist[faixa]||0)+1
    if(d>90) grandes.push({sv:p.sv,dia:p.d,passo:a.passo,dist:d,previsto:a.previsto})
  }
}
console.log('alocacoes:',tot); console.log('distribuicao da distancia (min):',hist)
console.log('acima de 90 min:',grandes.length, `(${(100*grandes.length/tot).toFixed(1)}%)`)
const sv=await get(`servidores?select=id,nome,matricula`); const SV=Object.fromEntries(sv.map(s=>[s.id,s]))
for(const g of grandes.sort((a,b)=>b.dist-a.dist).slice(0,20))
  console.log(` ${String(g.dist).padStart(4)}min ${g.dia} ${g.passo.padEnd(17)} ${(SV[g.sv]||{}).nome}`)
const porPasso={}
for(const g of grandes){ const k=g.passo.startsWith('intervalo')?'intervalo':g.passo; porPasso[k]=(porPasso[k]||0)+1 }
console.log('\n>90min por passo:',porPasso)
const ent = grandes.filter(g=>!g.passo.startsWith('intervalo'))
console.log('entrada/saida acima de 90min:',ent.length,'| acima de 120:',ent.filter(g=>g.dist>120).length,'| acima de 180:',ent.filter(g=>g.dist>180).length)
