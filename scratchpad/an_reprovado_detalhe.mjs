import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(`${p} ${r.status} ${await r.text()}`);const x=await r.json();o.push(...x);if(x.length<1000)break}return o}
const antes=JSON.parse(fs.readFileSync('scratchpad/_reprovado_antes.json','utf8'))
const repro=Object.entries(antes).filter(([,v])=>v).map(([k])=>k)
const fila=await q('rep_cadastros_fila?select=dispositivo_id,servidor_id,status,created_at,processado_em')
const snap=await q('rep_usuarios_dispositivo?select=dispositivo_id,servidor_id')
const vin=await q('rep_vinculos_servidor?select=dispositivo_id,servidor_id&vigente_ate=is.null')
const subs=await q('dispositivos_rep_substituicoes?select=dispositivo_id,created_at')
const D=Object.fromEntries((await q('dispositivos_rep?select=id,nome,ativo')).map(d=>[d.id,d]))
const sids=[...new Set(repro.map(k=>k.split('|')[1]))]
const S=Object.fromEntries((await q(`servidores?select=id,nome,matricula,status&id=in.(${sids.join(',')})`)).map(s=>[s.id,s]))
const noDev=new Set(snap.filter(s=>s.servidor_id).map(s=>`${s.dispositivo_id}|${s.servidor_id}`))
const temVinc=new Set(vin.map(v=>`${v.dispositivo_id}|${v.servidor_id}`))
const ultimaSub={}; for(const s of subs) if(!ultimaSub[s.dispositivo_id]||s.created_at>ultimaSub[s.dispositivo_id]) ultimaSub[s.dispositivo_id]=s.created_at
const inst=f=>f.processado_em||f.created_at, lim=new Date(Date.now()-30*864e5)
const par={}; for(const f of fila){const k=`${f.dispositivo_id}|${f.servidor_id}`;(par[k]=par[k]||[]).push(f)}
let cSup=0,cSub=0,cLeg=0
console.log('=== OS 43 REPROVADOS HOJE ===\n')
for(const k of repro){
  const [d,s]=k.split('|'), ls=par[k]
  const fal=ls.filter(x=>x.status==='falhou').filter(x=>new Date(inst(x))>lim)
  const ult=Math.max(...fal.map(x=>+new Date(inst(x))))
  const sup=ls.some(x=>x.status==='enviado'&&+new Date(inst(x))>ult)
  const preSub=ultimaSub[d] && new Date(ult) < new Date(ultimaSub[d])
  const ausente=!noDev.has(k)&&!temVinc.has(k)
  const motivo = sup?'SUCESSO POSTERIOR':(preSub?'ANTES DA TROCA DO APARELHO':'recusa legitima')
  if(sup)cSup++; else if(preSub)cSub++; else cLeg++
  if(sup||preSub||ausente)
    console.log(`  [${motivo}]${ausente?' AUSENTE DO EQUIPAMENTO':''}\n     ${D[d]?.nome} <- ${S[s]?.nome} (mat ${S[s]?.matricula}, ${S[s]?.status})`)
}
console.log(`\nRESUMO dos 43: ${cSup} por sucesso posterior | ${cSub} por falha anterior a troca do aparelho | ${cLeg} recusa legitima`)
const ausentes=repro.filter(k=>!noDev.has(k)&&!temVinc.has(k))
console.log(`AUSENTES DO EQUIPAMENTO (presos de verdade): ${ausentes.length}`)
