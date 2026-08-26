import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}` }
async function all(path){ const out=[]; for(let f=0;;f+=1000){ const r=await fetch(`${U}/rest/v1/${path}`,{headers:{...H,Range:`${f}-${f+999}`}}); if(!r.ok){console.error(r.status,await r.text());break} const pg=await r.json(); out.push(...pg); if(pg.length<1000) break } return out }

const ems = await all(`escala_mensal?select=id,servidor_id,mes,ano,unidade_id,setor_id,servidores(nome,matricula),unidades(nome),setores(dicionario_setores(nome))&ano=eq.2026&mes=in.(6,7,8)`)
const byId = Object.fromEntries(ems.map(e=>[e.id,e]))
console.log('escala_mensal 06-08/2026:', ems.length)
const edsAll = await all(`escala_diaria?select=id,escala_mensal_id,dia,categoria,dicionario_turnos(codigo,slots),presenca_entrada_em,presenca_saida_em&order=id.asc`)
const eds = edsAll.filter(r=>byId[r.escala_mensal_id])
console.log("escala_diaria total:", edsAll.length)
console.log('escala_diaria:', eds.length)

// agrupar por servidor+mes+dia
const map = new Map()
for (const ed of eds) {
  const em = byId[ed.escala_mensal_id]; if(!em) continue
  const k = `${em.servidor_id}|${em.ano}-${em.mes}|${ed.dia}`
  if(!map.has(k)) map.set(k,[])
  map.get(k).push({ed,em})
}
const conflitos=[]
for (const [k,rows] of map) {
  const setores = new Set(rows.map(r=>r.em.setor_id))
  if (setores.size < 2) continue
  // slots sobrepostos entre escalas mensais diferentes
  for (let i=0;i<rows.length;i++) for (let j=i+1;j<rows.length;j++) {
    const a=rows[i], b=rows[j]
    if (a.em.id===b.em.id) continue
    const sa=a.ed.dicionario_turnos?.slots||[], sb=b.ed.dicionario_turnos?.slots||[]
    if (!sa.some(s=>sb.includes(s))) continue
    conflitos.push({k, nome:a.em.servidores?.nome, mat:a.em.servidores?.matricula,
      mes:`${a.em.mes}/${a.em.ano}`, dia:a.ed.dia,
      A:`${a.em.setores?.dicionario_setores?.nome}/${a.ed.categoria}/${a.ed.dicionario_turnos?.codigo}`,
      B:`${b.em.setores?.dicionario_setores?.nome}/${b.ed.categoria}/${b.ed.dicionario_turnos?.codigo}`,
      pontoA: !!(a.ed.presenca_entrada_em||a.ed.presenca_saida_em), pontoB: !!(b.ed.presenca_entrada_em||b.ed.presenca_saida_em)})
  }
}
console.log('\nPARES CONFLITANTES (mesmo servidor, mesmo dia, setores diferentes, slots sobrepostos):', conflitos.length)
const porServidor = {}
for (const c of conflitos) { const kk=`${c.nome} (${c.mat})`; (porServidor[kk] ||= []).push(c) }
console.log('servidores atingidos:', Object.keys(porServidor).length)
for (const [n,cs] of Object.entries(porServidor)) {
  const comPonto = cs.filter(c=>c.pontoA||c.pontoB).length
  console.log(`\n${n} — ${cs.length} dias (${comPonto} com ponto gravado)`)
  console.log('  ', [...new Set(cs.map(c=>`${c.mes} ${c.A} x ${c.B}`))].join('\n   '))
  console.log('   dias:', cs.map(c=>`${c.mes.split('/')[0]}/${c.dia}${(c.pontoA||c.pontoB)?'*':''}`).join(' '))
}
