import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const TZ='America/Sao_Paulo'
const diaLocal=iso=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso))
async function req(m,p,b){const r=await fetch(`${U}/rest/v1/${p}`,{method:m,headers:{...H,Prefer:'return=representation'},body:b?JSON.stringify(b):undefined});const t=await r.text();if(!r.ok)throw new Error(`${m} ${p} -> ${r.status} ${t.slice(0,300)}`);return t?JSON.parse(t):[]}
async function rpc(f,b){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok)throw new Error(`rpc ${f} -> ${r.status} ${t.slice(0,300)}`);return t}

const FAG='9c7b7695-6675-4c46-b0e5-1af6793c49e3', CLE='f2c69c5f-f318-479d-b528-cc3b10ce00e7'
const SET_TRANSPORTE='860d9a23-1f86-4e73-bd53-8e721322c5f1', SET_PSE='3192f4aa-530c-4bc2-806e-4e6104bacd21'
const DIAS_FAG=['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07']
const DIAS_CLE=['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07','2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14','2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-24','2026-08-25','2026-08-26','2026-08-27']
const IDS_FAG=['09c0c911-eada-409d-99c5-9c396ad859b8','aef43119-14dd-4172-b419-06865416a42f','b3b70b6a-e79c-4ee1-a40a-3e4fec641730','8501e6a0-d663-4c06-bf21-4525c3dc1166','dc0485d7-3fb2-439e-8677-34cb85666476']
const IDS_CLE=['f396b3b9-92b3-4582-9e35-d4710a70260d','1884414c-c44f-43e1-aee3-e237d433c5e2','2c96d340-6441-4897-951a-64390e3b601f','88e7cb30-fe5b-48c9-9bf8-896ffb8ac411','f93a8b52-19d6-4db3-aba0-218c42ae60ad','9b5a0439-33ed-40a2-a635-b023a18317fb','a0f79b4b-3c99-45b7-bc55-459cfa4c5a16','4c311372-1db8-4d62-96c2-421d7e37a54d','1a426ae6-8982-46f4-b62f-9669336a1713','7b366c47-e0f6-45ca-be2a-12c6bde17b7e','1d3ebef2-ce98-4fd5-bc4a-3e962f37858b','589cc489-8736-4866-8d75-88c466487b72','e27c24b9-059c-4d4d-abb2-3a7ff99ce160','54c697fd-ccd1-47f4-8bf1-c78714dec4ba','0913fd21-a28a-4d89-a2c7-c847e5e841ad','3bb317cd-f9bb-4f96-94a9-16fdefa0ccd3','6de9ddc3-1aeb-485e-992a-5ed52878c757','9f535f39-142f-4813-af51-1b974214b58f','a22ed3e6-4eb9-4dc3-87b4-61551d2a5f90']
const MARCA='Sobreposicao de escala entre setores: marcacao sintetica gerada pelo Aplicar Template do setor removido da escala em 26/08/2026. Ver migration 20260826210000.'

// --- PASSO 1: apagar as linhas do setor que nao fica com o dia
const del1=await req('DELETE',`escala_diaria?id=in.(${IDS_FAG.join(',')})`)
const del2=await req('DELETE',`escala_diaria?id=in.(${IDS_CLE.join(',')})`)
console.log(`1. escala_diaria removidas -> FAGNER/TRANSPORTE: ${del1.length}, CLEONEIDE/PSE: ${del2.length}`)

// --- PASSO 2: desconsiderar as sinteticas do setor removido
const autor=(await req('GET',`profiles?select=id&role=eq.super_admin&order=created_at.asc&limit=1`))[0].id
const jaTratadas=new Set((await req('GET',`marcacoes_tratamentos?select=marcacao_id&tipo=eq.desconsiderar&justificativa=like.*20260826210000*`)).map(r=>r.marcacao_id))
let inseridos=0, guardaReal=0
for (const [sid,setor,dias] of [[FAG,SET_TRANSPORTE,DIAS_FAG],[CLE,SET_PSE,DIAS_CLE]]) {
  const m=await req('GET',`marcacoes_ponto?select=id,ocorrido_em,origem,sintetica&servidor_id=eq.${sid}&setor_id=eq.${setor}&sintetica=is.true&origem=eq.ajuste_coordenador&ocorrido_em=gte.2026-08-01&ocorrido_em=lt.2026-09-01`)
  const alvo=m.filter(r=>dias.includes(diaLocal(r.ocorrido_em)))
  guardaReal+=alvo.filter(r=>r.sintetica!==true||r.origem!=='ajuste_coordenador').length
  const novos=alvo.filter(r=>!jaTratadas.has(r.id))
  if(novos.length){
    await req('POST','marcacoes_tratamentos',novos.map(r=>({marcacao_id:r.id,tipo:'desconsiderar',justificativa:MARCA,registrado_por_id:autor})))
    inseridos+=novos.length
  }
}
console.log(`2. tratamentos 'desconsiderar' inseridos: ${inseridos} (batidas reais alcancadas: ${guardaReal} - tem que ser 0)`)

// --- PASSO 3: reconciliar
let ok=0, outros=[]
for (const [sid,dias] of [[FAG,DIAS_FAG],[CLE,DIAS_CLE]]) {
  for (const d of dias) {
    const res=JSON.parse(await rpc('fn_reconciliar_marcacoes_dia',{p_servidor_id:sid,p_data:d}))
    if(res.status==='ok') ok++; else outros.push(`${d}:${res.status}`)
  }
}
console.log(`3. dias reconciliados ok: ${ok}/24 ${outros.length?'| outros: '+outros.join(', '):''}`)
