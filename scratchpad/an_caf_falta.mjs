import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(`${p} ${r.status} ${await r.text()}`);const x=await r.json();o.push(...x);if(x.length<1000)break}return o}
async function rpc(fn,b){const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();return r.ok?JSON.parse(t):`ERRO ${r.status} ${t}`}
const D1='8b6f1a36-b48a-4998-8fe0-2503f2443f49', D2='a874f789-8ec7-4295-84c6-487597c76efc'
const s1=await q(`rep_usuarios_dispositivo?select=servidor_id,tem_biometria,nome_no_device,identificador_afd&dispositivo_id=eq.${D1}`)
const s2=await q(`rep_usuarios_dispositivo?select=servidor_id,tem_biometria,nome_no_device,identificador_afd&dispositivo_id=eq.${D2}`)
console.log(`CAF-01: ${s1.length} cadastros / ${s1.filter(x=>x.tem_biometria).length} com digital`)
console.log(`CAF-02: ${s2.length} cadastros / ${s2.filter(x=>x.tem_biometria).length} com digital`)
// comparar por PESSOA (cpf), nunca por servidor_id (duplo vinculo)
const ids=[...new Set([...s1,...s2].map(x=>x.servidor_id).filter(Boolean))]
const srv=await q(`servidores?select=id,nome,matricula,cpf,pis_pasep,status&id=in.(${ids.join(',')})`)
const S=Object.fromEntries(srv.map(x=>[x.id,x]))
const chave=x=>x.servidor_id&&S[x.servidor_id]?.cpf ? S[x.servidor_id].cpf : `dev:${x.identificador_afd}`
const m1=new Map(s1.map(x=>[chave(x),x])), m2=new Map(s2.map(x=>[chave(x),x]))
const so1=[...m1.keys()].filter(k=>!m2.has(k)), so2=[...m2.keys()].filter(k=>!m1.has(k))
console.log(`\nPor PESSOA: ${m1.size} no 01, ${m2.size} no 02 | so no 01: ${so1.length} | so no 02: ${so2.length}`)
console.log('\nSO NO CAF-01 (nao esta no aparelho novo):')
for(const k of so1){const x=m1.get(k), s=S[x.servidor_id]; console.log(`  ${s?`${s.nome} (mat ${s.matricula}, ${s.status})`:`[nao resolvido] ${x.nome_no_device}`} | digital no 01: ${x.tem_biometria}`)}
if(so2.length){console.log('\nSO NO CAF-02:'); for(const k of so2){const x=m2.get(k),s=S[x.servidor_id]; console.log(`  ${s?s.nome:x.nome_no_device}`)}}
console.log('\nSEM DIGITAL NO 02 mas COM digital no 01 (fila da copia):')
let n=0; for(const [k,x] of m2) if(!x.tem_biometria && m1.get(k)?.tem_biometria){n++; const s=S[x.servidor_id]; console.log(`  ${s?s.nome:x.nome_no_device}`)}
console.log(`  -> ${n} pessoas`)
console.log('\nSEM DIGITAL NOS DOIS (precisa cadastrar o dedo presencialmente):')
for(const [k,x] of m2) if(!x.tem_biometria && !m1.get(k)?.tem_biometria){const s=S[x.servidor_id]; console.log(`  ${s?`${s.nome} (mat ${s.matricula})`:x.nome_no_device}`)}
console.log('\nPENDENCIAS DA COPIA AGORA:',(await rpc('fn_biometria_faltante_dispositivo',{p_destino_id:D2})).length)
