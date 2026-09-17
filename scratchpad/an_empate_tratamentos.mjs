import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function all(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});const j=await r.json();if(!Array.isArray(j))throw new Error(JSON.stringify(j));o.push(...j);if(j.length<1000)break}return o}
const t=await all('marcacoes_tratamentos?select=id,marcacao_id,tipo,created_at&order=id')
console.log('total de tratamentos em producao:', t.length)
const porTipo={}; t.forEach(x=>porTipo[x.tipo]=(porTipo[x.tipo]||0)+1)
console.log('por tipo:', JSON.stringify(porTipo))
// empates: mesma marcacao, mesmo created_at, tipos desconsiderar/restaurar
const k=new Map()
for(const x of t){ if(!['desconsiderar','restaurar'].includes(x.tipo)) continue
  const key=x.marcacao_id+'|'+x.created_at; if(!k.has(key))k.set(key,[]); k.get(key).push(x.tipo) }
const empates=[...k.entries()].filter(([,v])=>v.length>1)
console.log('empates (mesma marcacao + mesmo created_at, desconsiderar/restaurar):', empates.length)
if(empates.length) console.log(JSON.stringify(empates.slice(0,5),null,1))
// quantas marcacoes tem par desconsiderar+restaurar
const porMarc=new Map()
for(const x of t){ if(!['desconsiderar','restaurar'].includes(x.tipo)) continue
  if(!porMarc.has(x.marcacao_id))porMarc.set(x.marcacao_id,[]); porMarc.get(x.marcacao_id).push(x) }
const comPar=[...porMarc.values()].filter(v=>new Set(v.map(x=>x.tipo)).size>1)
console.log('marcacoes com desconsiderar E restaurar:', comPar.length)
