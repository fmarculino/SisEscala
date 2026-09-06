import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function todas(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(await r.text());const q=await r.json();o.push(...q);if(q.length<1000)break}return o}
async function rpc(fn,b){const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)});if(!r.ok)throw new Error(await r.text());return r.json()}
const disp = JSON.parse(fs.readFileSync('scratchpad/_hmm_disp.json','utf8'))
const D = Object.fromEntries(disp.map(d=>[d.nome,d.id]))
const s1 = JSON.parse(fs.readFileSync('scratchpad/_snap_HMM-01.json','utf8'))
const s3 = JSON.parse(fs.readFileSync('scratchpad/_snap_HMM-03.json','utf8'))
const m1 = new Map(s1.map(x=>[x.servidor_id,x])), m3 = new Map(s3.map(x=>[x.servidor_id,x]))
const so1 = s1.filter(x=>!m3.has(x.servidor_id))
console.log('=== os 3 que estao no HMM-01/02 e NAO no HMM-03 ===')
for (const x of so1) console.log(`  ${x.nome_no_device} | ident ${x.identificador_afd} | digital=${x.tem_biometria}`)
const so3 = s3.filter(x=>!m1.has(x.servidor_id))
console.log(`\n=== os ${so3.length} que so estao no HMM-03 (bagagem do reaproveitado) ===`)
const comDig = so3.filter(x=>x.tem_biometria).length
console.log(`  com digital: ${comDig}   sem digital: ${so3.length-comDig}`)
// quantos desses sao servidores do HMM?
const ids = so3.map(x=>x.servidor_id).filter(Boolean)
const svs = []
for (let i=0;i<ids.length;i+=50) svs.push(...await todas(`servidores?id=in.(${ids.slice(i,i+50).join(',')})&select=id,nome,status,unidade_id`))
const unis = await todas('unidades?select=id,nome')
const nu = Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const porUni = {}
for (const s of svs) porUni[nu[s.unidade_id]||'(sem unidade)'] = (porUni[nu[s.unidade_id]||'(sem unidade)']||0)+1
console.log('  lotacao desses 130:'); console.log(JSON.stringify(porUni,null,1))
console.log('\n=== pendencias que envolvem o CCE-01 (maquina diferente) ===')
for (const n of ['REP-iDClass-HMM-03','REP-iDClass-CCE-01']) {
  const p = await rpc('fn_biometria_faltante_dispositivo',{p_destino_id:D[n]})
  console.log(` destino ${n}: ${p.length}`)
  for (const x of p) console.log(`   ${x.servidor_nome} (mat ${x.matricula}) <- ${x.origem_nome}`)
}
