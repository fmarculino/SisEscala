import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,300));break}const g=await r.json();o.push(...g);if(g.length<1000)break}return o}
const em=await qAll('escala_mensal?select=id,servidor_id,unidade_id,setor_id&mes=eq.9&ano=eq.2026')
const ids=new Set(em.map(e=>e.id)),EM=new Map(em.map(e=>[e.id,e]))
const dt=await qAll('dicionario_turnos?select=id,codigo,horas_computadas')
const un=await qAll('unidades?select=id,nome')
const se=await qAll('setores?select=id,parent_id,dicionario_setores(nome)')
const sv=await qAll('servidores?select=id,nome,matricula')
const ed=(await qAll('escala_diaria?select=id,dia,escala_mensal_id,dicionario_turnos_id&categoria=eq.Plant%C3%A3o&order=id')).filter(l=>ids.has(l.escala_mensal_id))
const T=new Map(dt.map(t=>[t.id,t])),UN=new Map(un.map(u=>[u.id,u.nome])),SV=new Map(sv.map(s=>[s.id,s]))
const SEn=new Map(se.map(s=>[s.id,s.dicionario_setores?.nome||'?'])),SEp=new Map(se.map(s=>[s.id,s.parent_id]))
const cam=id=>{const p=[];let c=id,g=0;while(c&&g++<10){p.unshift(SEn.get(c)||'?');c=SEp.get(c)}return p.join(' \ ')}

const M=new Map()
for(const l of ed){
  const e=EM.get(l.escala_mensal_id),t=T.get(l.dicionario_turnos_id)
  const k=`${e.servidor_id}|${e.unidade_id}|${e.setor_id}`
  const a=M.get(k)||{sid:e.servidor_id,un:UN.get(e.unidade_id)||'?',se:cam(e.setor_id),n:0,h:0,cods:new Map(),dias:[]}
  a.n++; a.h+=Number(t?.horas_computadas)||0
  a.cods.set(t?.codigo||'?',(a.cods.get(t?.codigo||'?')||0)+1)
  a.dias.push(l.dia)
  M.set(k,a)
}
const linhas=[...M.values()].map(a=>({...a,nome:SV.get(a.sid)?.nome||'?',mat:SV.get(a.sid)?.matricula||'?'}))
  .sort((a,b)=>b.h-a.h||a.nome.localeCompare(b.nome))
const totN=linhas.reduce((s,a)=>s+a.n,0), totH=linhas.reduce((s,a)=>s+a.h,0)
const servs=new Set(linhas.map(a=>a.sid)).size

const csv=['matricula;servidor;unidade;setor;qtd_plantoes;horas;codigos;dias']
linhas.forEach(a=>csv.push([a.mat,a.nome,a.un,a.se,a.n,a.h,[...a.cods.entries()].map(([c,n])=>`${c}x${n}`).join(' '),a.dias.sort((x,y)=>x-y).join(',')].join(';')))
csv.push(`;TOTAL (${servs} servidores, ${linhas.length} linhas servidor+setor);;;${totN};${totH};;`)
fs.writeFileSync('scratchpad/plantoes_09_2026.csv',csv.join('\r\n'),'latin1')
console.log(`TOTAL: ${totN} plantoes | ${totH}h | ${servs} servidores distintos | ${linhas.length} pares servidor+setor`)
console.log('\nTop 30 por horas:')
console.log('  horas  qtd  matricula  servidor / unidade')
linhas.slice(0,30).forEach(a=>console.log(`  ${String(a.h).padStart(5)}  ${String(a.n).padStart(3)}  ${String(a.mat).padStart(8)}  ${a.nome} — ${a.un}`))
const dist=new Map()
linhas.forEach(a=>{const f=a.n<=2?'1-2':a.n<=5?'3-5':a.n<=8?'6-8':a.n<=12?'9-12':a.n<=16?'13-16':'17+';dist.set(f,(dist.get(f)||0)+1)})
console.log('\nDistribuicao (plantoes por servidor/setor):')
;['1-2','3-5','6-8','9-12','13-16','17+'].forEach(f=>dist.get(f)&&console.log(`  ${f.padEnd(6)} ${dist.get(f)} servidores`))
console.log('\nCSV: scratchpad/plantoes_09_2026.csv')
