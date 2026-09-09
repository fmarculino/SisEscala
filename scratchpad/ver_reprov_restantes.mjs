import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function q(p){ const out=[]; for(let f=0;;f+=1000){
  const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}})
  if(!r.ok){console.error(r.status,(await r.text()).slice(0,200));process.exit(1)}
  const pg=await r.json(); out.push(...pg); if(pg.length<1000)break } return out }
const rpc=async(f,b)=>{const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});return r.ok?r.json():null}
const nomes=Object.fromEntries((await q(`dispositivos_rep?select=id,nome`)).map(d=>[d.id,d.nome]))
const servs=Object.fromEntries((await q(`servidores?select=id,nome,matricula`)).map(s=>[s.id,`${s.nome} (${s.matricula})`]))
const f=await q(`rep_cadastros_fila?select=dispositivo_id,servidor_id,erro,processado_em,created_at&status=eq.falhou`)
const pares=new Map()
for(const x of f){const k=`${x.dispositivo_id}|${x.servidor_id}`
  const t=x.processado_em||x.created_at
  const c=pares.get(k); if(!c)pares.set(k,{erros:[x.erro],t,d:x.dispositivo_id,s:x.servidor_id})
  else{c.erros.push(x.erro); if(t>c.t)c.t=t}}
console.log('OS 34 QUE CONTINUAM REPROVADOS (recusa legitima do equipamento):\n')
const porMsg={}
for(const [,v] of pares){
  if(await rpc('fn_cadastro_rep_reprovado',{p_dispositivo_id:v.d,p_servidor_id:v.s})!==true) continue
  const ultima=v.erros[v.erros.length-1]||''
  const chave=ultima.replace(/\d{5,}/g,'<N>').replace(/\d+\.\d+\.\d+\.\d+/g,'<IP>').slice(0,80)
  porMsg[chave]=(porMsg[chave]||0)+1
  if(nomes[v.d].includes('HMM-04')) console.log(`  HMM-04: ${servs[v.s]}\n     -> ${ultima.slice(0,120)}`)
}
console.log('\npor mensagem:')
for(const [m,n] of Object.entries(porMsg).sort((a,b)=>b[1]-a[1])) console.log(`  ${n.toString().padStart(3)}  ${m}`)
