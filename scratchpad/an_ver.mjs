import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok){console.error(r.status,(await r.text()).slice(0,200));return[]}return r.json()}
const d=await q(`dispositivos_rep?select=*&limit=1`)
if(d.length) console.log('colunas:', Object.keys(d[0]).filter(c=>/vers|contato|maquina|ativo|nome/i.test(c)).join(','))
const all=await q(`dispositivos_rep?select=nome,coletor_versao,ultimo_contato_em,ativo&order=coletor_versao.asc`)
console.log('\nparque:', all.length, 'relogios | versao atual do release:', fs.readFileSync('tools/coletor-rep/dist/VERSION','utf8').trim())
const porV={}
all.forEach(r=>{const v=r.coletor_versao||'(nunca reportou)';porV[v]=(porV[v]||0)+1})
Object.entries(porV).sort().forEach(([v,n])=>console.log('  v'+v, '->', n))
console.log('\ndetalhe:')
all.forEach(r=>{
  const h=r.ultimo_contato_em?((Date.now()-new Date(r.ultimo_contato_em))/3600000).toFixed(1)+'h':'nunca'
  console.log('  ',String(r.coletor_versao||'-').padEnd(8), String(r.nome).slice(0,28).padEnd(29), 'ultimo contato ha', h)
})
