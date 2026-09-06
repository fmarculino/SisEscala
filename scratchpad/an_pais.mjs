import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function todas(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(p+' -> '+(await r.text()).slice(0,250));const q=await r.json();o.push(...q);if(q.length<1000)break}return o}
const unis = await todas('unidades?select=id,nome'); const uniHMM = unis.find(u=>u.nome.startsWith('HMM')).id
const disp = await todas(`dispositivos_rep?unidade_id=eq.${uniHMM}&ativo=eq.true&select=id,nome&order=nome`)
const nd = Object.fromEntries(disp.map(d=>[d.id,d.nome.replace('REP-iDClass-','').replace('REP iDClass - ','')]))
const vinc = {}
for (const d of disp) vinc[d.id] = new Set((await todas(`dispositivos_rep_setores?dispositivo_id=eq.${d.id}&select=setor_id`)).map(x=>x.setor_id))
const setores = await todas(`setores?unidade_id=eq.${uniHMM}&select=id,parent_id,ativo,dicionario_setores(nome)`)
const byId = Object.fromEntries(setores.map(s=>[s.id,s]))
const nome = s => s?.dicionario_setores?.nome || '(?)'
const em = sid => disp.filter(d=>vinc[d.id].has(sid)).map(d=>nd[d.id]).join('+') || 'NENHUM'
const filhos = pid => setores.filter(s=>s.parent_id===pid)

console.log('=== raizes do HMM: quantos filhos, e onde estao vinculadas ===')
for (const r of setores.filter(s=>!s.parent_id).sort((a,b)=>nome(a).localeCompare(nome(b)))) {
  const f = filhos(r.id)
  const vincFilhos = {}
  for (const x of f) { const k = em(x.id); vincFilhos[k]=(vincFilhos[k]||0)+1 }
  console.log(`${nome(r).padEnd(42)} raiz->[${em(r.id)}]  filhos=${String(f.length).padStart(3)}  ${JSON.stringify(vincFilhos)}`)
}
console.log('\n=== detalhe: SAME e CSST ===')
for (const alvo of ['SAME','CSST']) {
  const s = setores.find(x=>nome(x)===alvo)
  if (!s) { console.log(`${alvo}: nao encontrado`); continue }
  console.log(`\n${alvo}  (pai: ${s.parent_id ? nome(byId[s.parent_id]) : 'RAIZ'})  vinculado a: ${em(s.id)}`)
  for (const f of filhos(s.id)) console.log(`   \ ${nome(f).padEnd(34)} -> ${em(f.id)}${f.ativo===false?'  [inativo]':''}`)
}
console.log('\n=== ALA - PSICOSSOCIAL: ramo completo ===')
const ala = setores.find(x=>nome(x)==='ALA - PSICOSSOCIAL')
console.log(`raiz ALA -> ${em(ala.id)}`)
for (const f of filhos(ala.id)) console.log(`   \ ${nome(f).padEnd(34)} -> ${em(f.id)}${f.ativo===false?'  [inativo]':''}`)
