// Os 122 que ficaram fora do escopo do HMM-03: quantos pertencem ao CCE-01 (correto) e quantos
// ficaram sem relogio nenhum (lacuna real)? SOMENTE LEITURA.
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
const q=async p=>{const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok){console.error('ERRO',p,r.status,(await r.text()).slice(0,250));process.exit(1)}return r.json()}
const UNI='f248c6d1-952b-42de-b53b-11738625deff'
const devs=await q(`dispositivos_rep?select=id,nome&unidade_id=eq.${UNI}`)
const id=n=>devs.find(d=>d.nome.includes(n)).id
const ds=await q(`dispositivos_rep_setores?select=dispositivo_id,setor_id&limit=5000`)
const S=x=>new Set(ds.filter(y=>y.dispositivo_id===x).map(y=>y.setor_id))
const sHMM=S(id('HMM-01')), sCCE=S(id('CCE-01'))
console.log(`HMM-01/02/03: ${sHMM.size} setores | CCE-01: ${sCCE.size} setores | interseccao: ${[...sHMM].filter(x=>sCCE.has(x)).length}`)

// universo: quem esta LOTADO na unidade HMM
const lot=[]
for(let i=0;;i+=1000){const r=await fetch(`${U}/rest/v1/servidores?select=id,nome,matricula,setor_id,status&unidade_id=eq.${UNI}&status=eq.Ativo&order=id`,{headers:{...H,Range:`${i}-${i+999}`}})
  const g=await r.json();lot.push(...g);if(g.length<1000)break}
let noHMM=0,noCCE=0,semRelogio=0,semSetor=0
const orfaos={}
for(const s of lot){
  if(!s.setor_id){semSetor++;continue}
  if(sHMM.has(s.setor_id))noHMM++
  else if(sCCE.has(s.setor_id))noCCE++
  else {semRelogio++;orfaos[s.setor_id]=(orfaos[s.setor_id]||0)+1}
}
console.log(`\n=== LOTADOS ATIVOS NO HMM: ${lot.length} ===`)
console.log(`  cobertos pelos relogios HMM-01/02/03: ${noHMM}`)
console.log(`  cobertos pelo CCE-01:                 ${noCCE}`)
console.log(`  em setor SEM relogio nenhum:          ${semRelogio}`)
console.log(`  sem setor definido:                   ${semSetor}`)
if(semRelogio){
  const ids=Object.keys(orfaos)
  const nomes=await q(`setores?select=id,dicionario_setores(nome)&id=in.(${ids.slice(0,50).join(',')})`)
  console.log('\n  setores sem relogio (pessoas):')
  for(const s of nomes) console.log(`    ${orfaos[s.id]}x  ${s.dicionario_setores?.nome}`)
}

// Os 36 sem relogio: eles JA batem em algum relogio do HMM? (se sim, o setor deveria estar vinculado)
console.log('\n=== OS 36 SEM RELOGIO JA ESTAO CADASTRADOS EM ALGUM RELOGIO? ===')
const semRel=lot.filter(s=>s.setor_id&&!sHMM.has(s.setor_id)&&!sCCE.has(s.setor_id))
const ids=semRel.map(s=>s.id)
const us=[]
for(let i=0;i<ids.length;i+=100){
  us.push(...await q(`rep_usuarios_dispositivo?select=servidor_id,dispositivo_id,tem_biometria&servidor_id=in.(${ids.slice(i,i+100).join(',')})`))
}
const nome=Object.fromEntries(devs.map(d=>[d.id,d.nome]))
const porServ={}
for(const u of us)(porServ[u.servidor_id] ||= []).push(u)
let comCadastro=0,comBio=0
for(const s of semRel){
  const l=porServ[s.id]||[]
  if(l.length)comCadastro++
  if(l.some(x=>x.tem_biometria))comBio++
}
console.log(`  dos ${semRel.length}: ${comCadastro} ja estao em algum relogio, ${comBio} com biometria`)
const ag={}
for(const u of us){const k=nome[u.dispositivo_id]||u.dispositivo_id.slice(0,8);ag[k]=(ag[k]||0)+1}
console.log('  onde estao:',JSON.stringify(ag))
