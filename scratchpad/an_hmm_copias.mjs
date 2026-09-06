import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function todas(path){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${path}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(await r.text());const p=await r.json();out.push(...p);if(p.length<1000)break}return out}
const disp = JSON.parse(fs.readFileSync('scratchpad/_hmm_disp.json','utf8'))
const nomeDisp = Object.fromEntries(disp.map(d=>[d.id,d.nome]))
const ontem = new Date(Date.now()-24*3600*1000).toISOString()
const copias = await todas(`rep_biometria_copias?created_at=gte.${ontem}&select=*&order=created_at.desc`)
const agr = {}
for (const c of copias) {
  const k = `${nomeDisp[c.destino_id] || c.destino_id.slice(0,8)} <- ${nomeDisp[c.origem_id] || c.origem_id.slice(0,8)}  [${c.status}]`
  agr[k] = (agr[k]||0)+1
}
console.log('=== copias de biometria nas ultimas 24h (destino <- origem) ===')
for (const [k,v] of Object.entries(agr).sort((a,b)=>b[1]-a[1])) console.log(`${String(v).padStart(4)}  ${k}`)
const erros = {}
for (const c of copias) if (c.erro) { const m = c.erro.slice(0,150); erros[m]=(erros[m]||0)+1 }
console.log('\n=== mensagens de erro ===')
console.log(Object.keys(erros).length ? JSON.stringify(erros,null,1) : '(nenhuma)')
console.log('\n=== ultimas 6 copias ===')
for (const c of copias.slice(0,6))
  console.log(`${c.created_at}  ${nomeDisp[c.destino_id]||'?'} <- ${nomeDisp[c.origem_id]||'?'}  status=${c.status} tpl=${c.templates_copiados} fmt=${c.formato_usado} host=${c.coletor_host}`)
console.log('\n=== formatos usados ===')
const fmts={}; for(const c of copias) fmts[c.formato_usado||'(nulo)']=(fmts[c.formato_usado||'(nulo)']||0)+1
console.log(JSON.stringify(fmts,null,1))
