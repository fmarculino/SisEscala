import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const TZ='America/Sao_Paulo'
const diaLocal=iso=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso))
async function req(m,p,b){const r=await fetch(`${U}/rest/v1/${p}`,{method:m,headers:{...H,Prefer:'return=representation'},body:b?JSON.stringify(b):undefined});const t=await r.text();if(!r.ok)throw new Error(`${m} ${p} -> ${r.status} ${t.slice(0,300)}`);return t?JSON.parse(t):[]}
async function rpc(f,b){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok)throw new Error(`rpc ${f} -> ${r.status}`);return t}

const FAG='9c7b7695-6675-4c46-b0e5-1af6793c49e3', CLE='f2c69c5f-f318-479d-b528-cc3b10ce00e7'
const DIAS_FAG=['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07']
const DIAS_CLE=['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07','2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14','2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-24','2026-08-25','2026-08-26','2026-08-27']
const MARCA='Batida REAL restaurada: fora desconsiderada pela reversao automatica da grade em 26/08/2026, quando o dia pertencia ao setor errado. O setor correto ficou com o dia. Ver migration 20260826210000.'
const autor=(await req('GET',`profiles?select=id&role=eq.super_admin&order=created_at.asc&limit=1`))[0].id

let total=0
for (const [nome,sid,dias] of [['FAGNER',FAG,DIAS_FAG],['CLEONEIDE',CLE,DIAS_CLE]]) {
  const m=await req('GET',`marcacoes_ponto?select=id,ocorrido_em,origem,sintetica&servidor_id=eq.${sid}&sintetica=is.false&origem=in.(terminal,rep)&ocorrido_em=gte.2026-08-01&ocorrido_em=lt.2026-09-01`)
  const alvo=m.filter(r=>dias.includes(diaLocal(r.ocorrido_em)))
  const novos=[]
  for (const r of alvo) {
    const t=await req('GET',`marcacoes_tratamentos?select=tipo,created_at&marcacao_id=eq.${r.id}&tipo=in.(desconsiderar,restaurar)&order=created_at.desc&limit=1`)
    if (t.length && t[0].tipo==='desconsiderar') novos.push(r)
  }
  if (novos.length) await req('POST','marcacoes_tratamentos',novos.map(r=>({marcacao_id:r.id,tipo:'restaurar',justificativa:MARCA,registrado_por_id:autor})))
  console.log(`${nome}: batidas reais nos dias afetados = ${alvo.length} | estavam desconsideradas e foram RESTAURADAS = ${novos.length}`)
  novos.forEach(r=>console.log(`   ${diaLocal(r.ocorrido_em)} ${String(r.ocorrido_em).slice(11,19)}Z ${r.origem}`))
  total+=novos.length
}
console.log(`\nrestauradas: ${total}`)

// reconciliar de novo
let ok=0
for (const [sid,dias] of [[FAG,DIAS_FAG],[CLE,DIAS_CLE]]) for (const d of dias) {
  const res=JSON.parse(await rpc('fn_reconciliar_marcacoes_dia',{p_servidor_id:sid,p_data:d}))
  if(res.status==='ok') ok++
}
console.log(`reconciliados novamente: ${ok}/24`)
