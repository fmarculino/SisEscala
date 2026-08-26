import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}` }
async function all(p){ const o=[]; for(let f=0;;f+=1000){ const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}}); if(!r.ok){console.error(r.status,(await r.text()).slice(0,200));break} const g=await r.json(); o.push(...g); if(g.length<1000)break } return o }

const ems = await all(`escala_mensal?select=id,servidor_id,mes,ano,unidade_id,setor_id,status,servidores(nome,matricula),unidades(nome),setores(dicionario_setores(nome))`)
const byId = Object.fromEntries(ems.map(e=>[e.id,e]))
console.log('competencias na base:', [...new Set(ems.map(e=>`${e.mes}/${e.ano}`))].sort().join(' '))

// C) mesmo servidor com DUAS escala_mensal no MESMO setor/competencia?
const dup={}
for(const e of ems){ const k=`${e.servidor_id}|${e.setor_id}|${e.mes}/${e.ano}`; (dup[k]||=[]).push(e.id) }
console.log('servidor com 2+ escala_mensal no MESMO setor/competencia:', Object.values(dup).filter(v=>v.length>1).length)

const eds = await all(`escala_diaria?select=id,escala_mensal_id,dia,categoria,dicionario_turnos(codigo,slots),presenca_entrada_em,presenca_saida_em,presenca_confirmada`)
const mine = eds.filter(r=>byId[r.escala_mensal_id])
console.log('escala_diaria analisada:', mine.length)

const map=new Map()
for(const ed of mine){ const em=byId[ed.escala_mensal_id]; const k=`${em.servidor_id}|${em.mes}/${em.ano}|${ed.dia}`; (map.get(k)||map.set(k,[]).get(k)).push({ed,em}) }

const comboCross={}, comboMesmaEM={}, blocked=[]
for(const [k,rows] of map){
  for(let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++){
    const a=rows[i],b=rows[j]
    const sa=a.ed.dicionario_turnos?.slots||[], sb=b.ed.dicionario_turnos?.slots||[]
    const over=sa.some(s=>sb.includes(s))
    const cc=[a.ed.categoria,b.ed.categoria].sort().join(' x ')+(over?' [SOBREPOE]':' [adjacente]')
    if(a.em.id===b.em.id){ comboMesmaEM[cc]=(comboMesmaEM[cc]||0)+1; continue }
    comboCross[cc]=(comboCross[cc]||0)+1
    if(over) blocked.push({a,b})
  }
}
console.log('\n--- pares na MESMA escala_mensal (mesmo setor) — o trigger NAO toca ---')
Object.entries(comboMesmaEM).sort((x,y)=>y[1]-x[1]).forEach(([k,v])=>console.log('  ',String(v).padStart(5),k))
console.log('\n--- pares em escala_mensal DIFERENTES (cross-setor) ---')
Object.entries(comboCross).sort((x,y)=>y[1]-x[1]).forEach(([k,v])=>console.log('  ',String(v).padStart(5),k))

console.log('\n--- os pares que o trigger BLOQUEARIA (detalhe para decisao) ---')
const seen=new Set()
for(const {a,b} of blocked){
  const nm=a.em.servidores?.nome
  const line=`${nm} (${a.em.servidores?.matricula}) ${a.em.mes}/${a.em.ano} dia ${String(a.ed.dia).padStart(2)} | ${a.em.setores?.dicionario_setores?.nome}/${a.ed.categoria}/${a.ed.dicionario_turnos?.codigo}${a.ed.presenca_entrada_em?' PONTO':''} <-> ${b.em.setores?.dicionario_setores?.nome}/${b.ed.categoria}/${b.ed.dicionario_turnos?.codigo}${b.ed.presenca_entrada_em?' PONTO':''} | status ${a.em.status}/${b.em.status}`
  if(!seen.has(line)){seen.add(line);console.log('  ',line)}
}
