import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,300));break}const g=await r.json();o.push(...g);if(g.length<1000)break}return o}
const em=await qAll('escala_mensal?select=id,servidor_id,unidade_id,setor_id,mes,ano,status&mes=eq.9&ano=eq.2026')
const dt=await qAll('dicionario_turnos?select=id,codigo,horas_computadas')
const un=await qAll('unidades?select=id,nome')
const ids=new Set(em.map(e=>e.id))
const ed=(await qAll('escala_diaria?select=id,dia,escala_mensal_id,categoria,dicionario_turnos_id&categoria=eq.Plant%C3%A3o&order=id')).filter(l=>ids.has(l.escala_mensal_id))
const T=new Map(dt.map(t=>[t.id,t])),EM=new Map(em.map(e=>[e.id,e])),UN=new Map(un.map(u=>[u.id,u.nome]))
console.log('linhas de Plantao em 09/2026:',ed.length)
const porUn=new Map(), porCod=new Map(), servs=new Set(), porServ=new Map()
for(const l of ed){
  const e=EM.get(l.escala_mensal_id); const t=T.get(l.dicionario_turnos_id)
  const h=Number(t?.horas_computadas)||0
  const u=UN.get(e.unidade_id)||'?'
  const a=porUn.get(u)||{n:0,h:0,s:new Set()}; a.n++; a.h+=h; a.s.add(e.servidor_id); porUn.set(u,a)
  const c=porCod.get(t?.codigo||'?')||{n:0,h:0}; c.n++; c.h+=h; porCod.set(t?.codigo||'?',c)
  servs.add(e.servidor_id)
  porServ.set(e.servidor_id,(porServ.get(e.servidor_id)||0)+h)
}
console.log('servidores distintos com plantao:',servs.size)
console.log('\n-- por unidade --')
;[...porUn.entries()].sort((a,b)=>b[1].h-a[1].h).forEach(([u,a])=>console.log(`  ${String(Math.round(a.h)).padStart(6)}h  ${String(a.n).padStart(5)} plantoes  ${String(a.s.size).padStart(4)} servidores  ${u}`))
console.log('\n-- por codigo --')
;[...porCod.entries()].sort((a,b)=>b[1].h-a[1].h).forEach(([c,a])=>console.log(`  ${c.padEnd(6)} ${String(a.n).padStart(5)}x  ${String(Math.round(a.h)).padStart(6)}h`))
const top=[...porServ.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10)
const sv=await qAll(`servidores?select=id,nome,matricula&id=in.(${top.map(t=>t[0]).join(',')})`)
const SV=new Map(sv.map(s=>[s.id,s]))
console.log('\n-- top 10 servidores por horas de plantao no mes --')
top.forEach(([id,h])=>console.log(`  ${String(Math.round(h)).padStart(4)}h  ${SV.get(id)?.nome} (${SV.get(id)?.matricula})`))
