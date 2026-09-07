import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(`${p} ${r.status} ${await r.text()}`);const x=await r.json();o.push(...x);if(x.length<1000)break}return o}
async function cnt(p){const r=await fetch(`${U}/rest/v1/${p}&limit=1`,{headers:{...H,Prefer:'count=exact'}});return Number((r.headers.get('content-range')||'/0').split('/')[1])}
const D2='a874f789-8ec7-4295-84c6-487597c76efc'

console.log('=== TIPOS DE REGISTRO NA GERACAO 2 ===')
for(const t of ['1','2','3','4','5','6','7','9'])
  { const n=await cnt(`rep_afd_registros?select=id&dispositivo_id=eq.${D2}&geracao=eq.2&tipo_registro=eq.${t}`); if(n) console.log(`  tipo ${t}: ${n}`) }

console.log('\n=== FAIXA DE DATAS DAS BATIDAS (tipo 3) DA GERACAO 2 ===')
const t3 = await q(`rep_afd_registros?select=nsr,ocorrido_em&dispositivo_id=eq.${D2}&geracao=eq.2&tipo_registro=eq.3&order=ocorrido_em.asc`)
console.log(`  ${t3.length} batidas | mais antiga ${t3[0]?.ocorrido_em} | mais nova ${t3[t3.length-1]?.ocorrido_em}`)
const ano={}; for(const x of t3) ano[x.ocorrido_em.slice(0,7)]=(ano[x.ocorrido_em.slice(0,7)]||0)+1
console.log('  por mes:',JSON.stringify(ano))

console.log('\n=== MARCACOES DA GERACAO 2: com dono x orfas, por mes ===')
const m = await q(`marcacoes_ponto?select=ocorrido_em,servidor_id,nsr&dispositivo_id=eq.${D2}&geracao=eq.2&order=ocorrido_em.asc`)
const agg={}; for(const x of m){const k=x.ocorrido_em.slice(0,7); agg[k]=agg[k]||{dono:0,orfa:0}; x.servidor_id?agg[k].dono++:agg[k].orfa++}
for(const k of Object.keys(agg).sort()) console.log(`  ${k}: ${agg[k].dono} com dono | ${agg[k].orfa} orfas`)
console.log(`  TOTAL: ${m.filter(x=>x.servidor_id).length} com dono | ${m.filter(x=>!x.servidor_id).length} orfas`)

console.log('\n=== BATIDAS DE HOJE (07/09) NO CAF-02 ===')
const hoje = m.filter(x=>x.ocorrido_em >= '2026-09-07')
console.log(`  ${hoje.length} marcacoes | ${hoje.filter(x=>x.servidor_id).length} com dono`)
for(const x of hoje.slice(-10)) console.log('   ',x.ocorrido_em,'nsr',x.nsr,x.servidor_id?'COM DONO':'ORFA')

console.log('\n=== PONTO_VALIDO_DESDE ===')
console.log(JSON.stringify(await q(`dispositivos_rep?select=nome,ponto_valido_desde,created_at&nome=ilike.*CAF-02*`)))
