// Portao de medicao do teto consolidado de horas (28/08/2026).
// Espelha calculateTotals (ScaleGrid.tsx) e fn_carga_mensal_servidor:
//   Regular  -> LEAST(horas_computadas, jornada.horas_totais - intervalo_minutos/60)
//   Extra/Plantao -> horas_computadas
//   Sobreaviso -> nao entra nas horas
// Escala com ativo = false fica de fora: foi retirada.
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,300));break}const g=await r.json();o.push(...g);if(g.length<1000)break}return o}

const emAll=await qAll('escala_mensal?select=id,servidor_id,unidade_id,setor_id,mes,ano,status,jornada_id,ativo')
const em=emAll.filter(e=>e.ativo!==false)
const ed=await qAll('escala_diaria?select=escala_mensal_id,categoria,dicionario_turnos_id')
const dt=await qAll('dicionario_turnos?select=id,codigo,horas_computadas')
const jo=await qAll('jornadas?select=id,nome,horas_totais,intervalo_minutos')
const un=await qAll('unidades?select=id,nome')
const se=await qAll('setores?select=id,parent_id,dicionario_setores(nome)')
const sv=await qAll('servidores?select=id,nome,matricula')
const cfg=await qAll('configuracoes_globais?select=chave,valor&chave=in.(max_horas_escala_servidor,max_sobreavisos_escala_servidor)')
const ex=await qAll('excecoes_escala_servidor?select=servidor_id,mes,ano,horas_adicionais_autorizadas,sobreavisos_adicionais_autorizados')
const LIM=Number(String(cfg.find(c=>c.chave==='max_horas_escala_servidor')?.valor).replace(/"/g,''))||300
const LIMS=Number(String(cfg.find(c=>c.chave==='max_sobreavisos_escala_servidor')?.valor).replace(/"/g,''))||10
console.log(`escala_mensal ativas: ${em.length} (de ${emAll.length}) | escala_diaria: ${ed.length}`)
console.log(`teto horas: ${LIM}h | teto sobreavisos: ${LIMS} un | excecoes gravadas: ${ex.length}`)

const T=new Map(dt.map(t=>[t.id,t])),J=new Map(jo.map(j=>[j.id,j])),EM=new Map(em.map(e=>[e.id,e]))
const UN=new Map(un.map(u=>[u.id,u.nome]))
const SEn=new Map(se.map(s=>[s.id,s.dicionario_setores?.nome||'?'])),SEp=new Map(se.map(s=>[s.id,s.parent_id]))
const SV=new Map(sv.map(s=>[s.id,s]))
const EXC=new Map(ex.map(e=>[`${e.servidor_id}|${e.mes}/${e.ano}`,e]))
function caminho(id){const p=[];let c=id,g=0;while(c&&g++<10){p.unshift(SEn.get(c)||'?');c=SEp.get(c)}return p.join(' \ ')}

const hEM=new Map(), sEM=new Map()
ed.forEach(l=>{
  const e=EM.get(l.escala_mensal_id); if(!e) return
  if(l.categoria==='Sobreaviso'){sEM.set(l.escala_mensal_id,(sEM.get(l.escala_mensal_id)||0)+1);return}
  const t=T.get(l.dicionario_turnos_id); if(!t) return
  let h=Number(t.horas_computadas)||0
  if(l.categoria==='Regular'){
    const j=J.get(e.jornada_id)
    if(j&&Number(j.horas_totais)>0) h=Math.min(h,Math.max(0,Number(j.horas_totais)-(Number(j.intervalo_minutos)||0)/60))
  }
  hEM.set(l.escala_mensal_id,(hEM.get(l.escala_mensal_id)||0)+h)
})

const cons=new Map()
em.forEach(e=>{
  const comp=`${e.mes}/${e.ano}`
  const k=`${e.servidor_id}|${comp}`
  const c=cons.get(k)||{sv:e.servidor_id,comp,horas:0,sob:0,esc:[]}
  const h=hEM.get(e.id)||0, s=sEM.get(e.id)||0
  c.horas+=h; c.sob+=s
  if(h||s) c.esc.push({h,s,txt:`${UN.get(e.unidade_id)} / ${caminho(e.setor_id)} [${e.status}]`})
  cons.set(k,c)
})

let falhas=0
console.log('\n=== ACIMA DO TETO DE HORAS (consolidado, ja descontada a excecao) ===')
;[...cons.values()].filter(x=>{const a=EXC.get(`${x.sv}|${x.comp}`);return x.horas>LIM+Number(a?.horas_adicionais_autorizadas||0)})
  .sort((a,b)=>b.horas-a.horas).forEach(x=>{
    falhas++
    const soSomando=x.esc.filter(e=>e.h>0).length>1
    console.log(`  ${x.horas.toFixed(0)}h  ${SV.get(x.sv)?.nome} (${SV.get(x.sv)?.matricula}) ${x.comp}${soSomando?'  <<< SO ESTOURA SOMANDO':''}`)
    x.esc.filter(e=>e.h>0).forEach(e=>console.log(`        ${String(e.h.toFixed(0)).padStart(4)}h  ${e.txt}`))
  })
if(!falhas) console.log('  (nenhum)')

console.log('\n=== ACIMA DO TETO DE SOBREAVISOS (consolidado) ===')
let fs2=0
;[...cons.values()].filter(x=>{const a=EXC.get(`${x.sv}|${x.comp}`);return x.sob>LIMS+Number(a?.sobreavisos_adicionais_autorizados||0)})
  .sort((a,b)=>b.sob-a.sob).forEach(x=>{fs2++;console.log(`  ${x.sob} un  ${SV.get(x.sv)?.nome} ${x.comp} :: ${x.esc.filter(e=>e.s>0).map(e=>`${e.txt}=${e.s}un`).join(' + ')}`)})
if(!fs2) console.log('  (nenhum)')

console.log('\n=== servidores em 2+ escalas COM CARGA, por competencia ===')
const porComp={}
;[...cons.values()].filter(x=>x.esc.length>1).forEach(x=>{porComp[x.comp]=(porComp[x.comp]||0)+1})
Object.entries(porComp).sort().forEach(([k,v])=>console.log('  ',k,'->',v))
console.log(`\nRESULTADO: ${falhas} caso(s) de horas e ${fs2} de sobreaviso acima do teto.`)
