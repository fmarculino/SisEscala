import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function todas(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(p+' -> '+(await r.text()).slice(0,200));const q=await r.json();o.push(...q);if(q.length<1000)break}return o}
const disp = JSON.parse(fs.readFileSync('scratchpad/_hmm_disp.json','utf8'))
const D = Object.fromEntries(disp.map(d=>[d.nome,d.id]))
const s1 = JSON.parse(fs.readFileSync('scratchpad/_snap_HMM-01.json','utf8'))
const s3 = JSON.parse(fs.readFileSync('scratchpad/_snap_HMM-03.json','utf8'))
const ids = [...new Set([...s1,...s3].map(x=>x.servidor_id).filter(Boolean))]
const svs = []
for (let i=0;i<ids.length;i+=50) svs.push(...await todas(`servidores?id=in.(${ids.slice(i,i+50).join(',')})&select=id,nome,matricula,cpf,status,unidade_id,setor_id`))
const sv = Object.fromEntries(svs.map(s=>[s.id,s]))
const unis = await todas('unidades?select=id,nome'); const uniHMM = unis.find(u=>u.nome.startsWith('HMM')).id
const vinc01 = new Set((await todas(`dispositivos_rep_setores?dispositivo_id=eq.${D['REP-iDClass-HMM-01']}&select=setor_id`)).map(x=>x.setor_id))
const vincCCE = new Set((await todas(`dispositivos_rep_setores?dispositivo_id=eq.${D['REP-iDClass-CCE-01']}&select=setor_id`)).map(x=>x.setor_id))
const setores = await todas('setores?select=id,dicionario_setores(nome)')
const nsetor = Object.fromEntries(setores.map(s=>[s.id, s.dicionario_setores?.nome]))
const pad = v => String(v||'').replace(/\D/g,'').padStart(12,'0')

// comparacao FISICA: por identificador_afd, nao por servidor_id
const id1 = new Set(s1.map(x=>x.identificador_afd))
const id3 = new Set(s3.map(x=>x.identificador_afd))
// mas HMM-03 usa PIS em 314; comparar pela PESSOA (cpf) e' o unico jeito honesto
const cpf1 = new Set(s1.map(x=>sv[x.servidor_id]?.cpf).filter(Boolean))
const cpf3 = new Set(s3.map(x=>sv[x.servidor_id]?.cpf).filter(Boolean))
console.log('=== comparacao por PESSOA (cpf), nao por servidor_id ===')
console.log(`pessoas no HMM-01: ${cpf1.size}   no HMM-03: ${cpf3.size}`)
console.log(`so no HMM-01: ${[...cpf1].filter(c=>!cpf3.has(c)).length}   so no HMM-03: ${[...cpf3].filter(c=>!cpf1.has(c)).length}`)

console.log('\n=== quem esta so no HMM-01 (por pessoa) ===')
for (const c of [...cpf1].filter(x=>!cpf3.has(x))) {
  const s = svs.find(x=>x.cpf===c); const l = s1.find(x=>sv[x.servidor_id]?.cpf===c)
  console.log(`  ${s.nome} | mat ${s.matricula} | digital=${l.tem_biometria} | setor=${nsetor[s.setor_id]}`)
}
console.log('\n=== quem esta so no HMM-03 (por pessoa), classificado ===')
const grupos = { 'lotado HMM, setor do HMM-01/02/03':[], 'lotado HMM, setor do CCE':[], 'lotado HMM, setor SEM relogio':[], 'outra unidade':[] }
for (const c of [...cpf3].filter(x=>!cpf1.has(x))) {
  const l = s3.find(x=>sv[x.servidor_id]?.cpf===c); const s = sv[l.servidor_id]
  const item = `${s.nome} | mat ${s.matricula} | digital=${l.tem_biometria} | ${nsetor[s.setor_id]||'(sem setor)'}`
  if (s.unidade_id !== uniHMM) grupos['outra unidade'].push(item)
  else if (vinc01.has(s.setor_id)) grupos['lotado HMM, setor do HMM-01/02/03'].push(item)
  else if (vincCCE.has(s.setor_id)) grupos['lotado HMM, setor do CCE'].push(item)
  else grupos['lotado HMM, setor SEM relogio'].push(item)
}
for (const [k,v] of Object.entries(grupos)) {
  console.log(`\n-- ${k}: ${v.length}`)
  for (const i of v.slice(0,6)) console.log(`   ${i}`)
  if (v.length>6) console.log(`   ... +${v.length-6}`)
}
const semRel = grupos['lotado HMM, setor SEM relogio']
console.log('\n=== setores sem relogio, agrupados ===')
const agr={}; for (const c of [...cpf3].filter(x=>!cpf1.has(x))) { const l=s3.find(x=>sv[x.servidor_id]?.cpf===c); const s=sv[l.servidor_id]
  if (s.unidade_id===uniHMM && !vinc01.has(s.setor_id) && !vincCCE.has(s.setor_id)) agr[nsetor[s.setor_id]||'(sem setor)']=(agr[nsetor[s.setor_id]||'(sem setor)']||0)+1 }
console.log(JSON.stringify(agr,null,1))
