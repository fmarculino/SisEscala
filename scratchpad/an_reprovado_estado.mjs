// Executa fn_cadastro_rep_reprovado contra TODOS os pares com falha. Serve de antes e depois.
import fs from 'fs'
const alvo = process.argv[2] || '.env.production'
const env=Object.fromEntries(fs.readFileSync(alvo,'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(`${p} ${r.status} ${await r.text()}`);const x=await r.json();o.push(...x);if(x.length<1000)break}return o}
async function rpc(fn,b){const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok)throw new Error(`${fn} ${r.status} ${t}`);return JSON.parse(t)}
const fila=await q('rep_cadastros_fila?select=dispositivo_id,servidor_id,status,created_at,processado_em')
const inst=f=>f.processado_em||f.created_at
const par={}; for(const f of fila){const k=`${f.dispositivo_id}|${f.servidor_id}`;(par[k]=par[k]||[]).push(f)}
const comFalha=Object.entries(par).filter(([,ls])=>ls.some(x=>x.status==='falhou'))
console.log(`${alvo}: ${fila.length} linhas de fila, ${comFalha.length} pares com alguma falha`)
const out={}
let n=0
for(const [k,ls] of comFalha){
  const [d,s]=k.split('|')
  out[k]=await rpc('fn_cadastro_rep_reprovado',{p_dispositivo_id:d,p_servidor_id:s})
  if(++n%50===0) process.stderr.write('.')
}
const repro=Object.entries(out).filter(([,v])=>v)
console.log(`\nreprovados AGORA: ${repro.length} de ${comFalha.length}`)
// classificacao independente, em JS, para conferir contra o que a funcao diz
const lim=new Date(Date.now()-30*864e5)
let superada=0
for(const [k] of repro){
  const ls=par[k], fal=ls.filter(x=>x.status==='falhou').filter(x=>new Date(inst(x))>lim)
  if(!fal.length) continue
  const ult=Math.max(...fal.map(x=>+new Date(inst(x))))
  if(ls.some(x=>x.status==='enviado'&&+new Date(inst(x))>ult)) superada++
}
console.log(`  dos reprovados, ${superada} tem SUCESSO posterior a ultima falha (reprovacao indevida)`)
fs.writeFileSync(process.argv[3]||'scratchpad/_reprovado_antes.json',JSON.stringify(out,null,0))
console.log('estado salvo em',process.argv[3]||'scratchpad/_reprovado_antes.json')
