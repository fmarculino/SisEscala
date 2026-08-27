import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});const t=await r.text();if(!r.ok){console.error(r.status,t.slice(0,200));return[]}return JSON.parse(t)}

const IDS=['09c0c911-eada-409d-99c5-9c396ad859b8','aef43119-14dd-4172-b419-06865416a42f','b3b70b6a-e79c-4ee1-a40a-3e4fec641730','8501e6a0-d663-4c06-bf21-4525c3dc1166','dc0485d7-3fb2-439e-8677-34cb85666476','f396b3b9-92b3-4582-9e35-d4710a70260d','1884414c-c44f-43e1-aee3-e237d433c5e2','2c96d340-6441-4897-951a-64390e3b601f','88e7cb30-fe5b-48c9-9bf8-896ffb8ac411','f93a8b52-19d6-4db3-aba0-218c42ae60ad','9b5a0439-33ed-40a2-a635-b023a18317fb','a0f79b4b-3c99-45b7-bc55-459cfa4c5a16','4c311372-1db8-4d62-96c2-421d7e37a54d','1a426ae6-8982-46f4-b62f-9669336a1713','7b366c47-e0f6-45ca-be2a-12c6bde17b7e','1d3ebef2-ce98-4fd5-bc4a-3e962f37858b','589cc489-8736-4866-8d75-88c466487b72','e27c24b9-059c-4d4d-abb2-3a7ff99ce160','54c697fd-ccd1-47f4-8bf1-c78714dec4ba','0913fd21-a28a-4d89-a2c7-c847e5e841ad','3bb317cd-f9bb-4f96-94a9-16fdefa0ccd3','6de9ddc3-1aeb-485e-992a-5ed52878c757','9f535f39-142f-4813-af51-1b974214b58f','a22ed3e6-4eb9-4dc3-87b4-61551d2a5f90']

// PASSO 1 — o DELETE ainda encontraria alguma linha?
const restantes=await q(`escala_diaria?select=id&id=in.(${IDS.join(',')})`)
console.log(`passo 1 (DELETE por id): linhas que ainda existem = ${restantes.length}  -> apagaria ${restantes.length}`)

// PASSO 2 — o NOT EXISTS casa com o que foi realmente gravado?
const desc=await q(`marcacoes_tratamentos?select=marcacao_id,justificativa&tipo=eq.desconsiderar&justificativa=like.*migration 20260826210000*`)
console.log(`passo 2 (INSERT desconsiderar): tratamentos ja gravados que o NOT EXISTS enxerga = ${desc.length}  -> inseriria 0`)
if(desc.length) console.log(`         texto gravado: "${desc[0].justificativa.slice(0,80)}..."`)

// PASSO 2b — o tratamento EFETIVO das batidas reais ainda e 'desconsiderar'?
const rest=await q(`marcacoes_tratamentos?select=marcacao_id&tipo=eq.restaurar&justificativa=like.*migration 20260826210000*`)
let aindaDesconsideradas=0
for (const t of rest) {
  const ult=await q(`marcacoes_tratamentos?select=tipo&marcacao_id=eq.${t.marcacao_id}&tipo=in.(desconsiderar,restaurar)&order=created_at.desc&limit=1`)
  if(ult[0]?.tipo==='desconsiderar') aindaDesconsideradas++
}
console.log(`passo 2b (INSERT restaurar): batidas restauradas = ${rest.length}, cujo tratamento efetivo ainda e 'desconsiderar' = ${aindaDesconsideradas}  -> inseriria ${aindaDesconsideradas}`)
