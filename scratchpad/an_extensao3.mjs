import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function all(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});const j=await r.json();if(!Array.isArray(j))throw new Error(JSON.stringify(j));o.push(...j);if(j.length<1000)break}return o}
const ems=await all('escala_mensal?select=id,servidor_id&mes=eq.9&ano=eq.2026&order=id')
const ids=new Set(ems.map(e=>e.id))
const eds=(await all('escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em&categoria=eq.Plant%C3%A3o&order=id')).filter(d=>ids.has(d.escala_mensal_id)&&d.dia<17)
const reg=eds.filter(d=>d.presenca_entrada_em&&d.presenca_saida_em).length
const av=eds.length-reg
console.log('PLANTOES 09/2026 ja passados:',eds.length,'| registrado (2 extremos, NAO oferece decisao de falta):',reg,'| em_avaliacao (oferece):',av)
// papeis
const pr=await all('profiles?select=role&order=id')
const c={};pr.forEach(p=>c[p.role]=(c[p.role]||0)+1)
console.log('PERFIS:',JSON.stringify(c))
// quantas justificativas com resultado=falta ja existem
const je=await all('justificativas_eventos?select=categoria,resultado,mes,ano&resultado=not.is.null&order=id')
const jc={};je.forEach(j=>{const k=`${j.categoria}/${j.resultado}`;jc[k]=(jc[k]||0)+1})
console.log('DESFECHOS JA REGISTRADOS (toda a base):',JSON.stringify(jc))
