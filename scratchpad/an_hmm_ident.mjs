import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function todas(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(p+' -> '+(await r.text()).slice(0,200));const q=await r.json();o.push(...q);if(q.length<1000)break}return o}
const disp = JSON.parse(fs.readFileSync('scratchpad/_hmm_disp.json','utf8'))
const snaps = {}
for (const n of ['REP-iDClass-HMM-01','REP-iDClass-HMM-02','REP-iDClass-HMM-03'])
  snaps[n] = JSON.parse(fs.readFileSync(`scratchpad/_snap_${n.slice(-6)}.json`,'utf8'))

// servidores citados
const ids = [...new Set(Object.values(snaps).flat().map(x=>x.servidor_id).filter(Boolean))]
const svs = []
for (let i=0;i<ids.length;i+=50) svs.push(...await todas(`servidores?id=in.(${ids.slice(i,i+50).join(',')})&select=id,nome,cpf,pis_pasep`))
const sv = Object.fromEntries(svs.map(s=>[s.id,s]))
const only = v => String(v||'').replace(/\D/g,'')
const pad = v => only(v).padStart(12,'0')

console.log('=== tipo de identificador usado em cada relogio ===')
for (const [n, lista] of Object.entries(snaps)) {
  let porCpf=0, porPis=0, outro=0
  for (const x of lista) {
    const s = sv[x.servidor_id]; if (!s) { outro++; continue }
    if (s.cpf && pad(s.cpf) === x.identificador_afd) porCpf++
    else if (s.pis_pasep && pad(s.pis_pasep) === x.identificador_afd) porPis++
    else outro++
  }
  console.log(`${n.padEnd(20)} CPF=${String(porCpf).padStart(4)}  PIS=${String(porPis).padStart(4)}  nenhum_dos_dois=${String(outro).padStart(4)}  total=${lista.length}`)
}

console.log('\n=== duplicidade DENTRO de cada relogio (mesmo servidor, 2+ cadastros) ===')
for (const [n, lista] of Object.entries(snaps)) {
  const c = {}; for (const x of lista) if (x.servidor_id) c[x.servidor_id]=(c[x.servidor_id]||0)+1
  const dup = Object.entries(c).filter(([,v])=>v>1)
  console.log(`${n.padEnd(20)} servidores com mais de um cadastro: ${dup.length}`)
  for (const [id] of dup.slice(0,5)) console.log(`   ${sv[id]?.nome}: ${lista.filter(x=>x.servidor_id===id).map(x=>x.identificador_afd).join(' , ')}`)
}

console.log('\n=== risco de duplicar ao levar os 130 do HMM-03 para o HMM-01 ===')
const m1 = new Map(snaps['REP-iDClass-HMM-01'].map(x=>[x.servidor_id,x]))
const idents1 = new Set(snaps['REP-iDClass-HMM-01'].map(x=>x.identificador_afd))
const so3 = snaps['REP-iDClass-HMM-03'].filter(x=>!m1.has(x.servidor_id))
let colideIdent=0, semCpf=0, semPis=0
for (const x of so3) {
  const s = sv[x.servidor_id]
  if (s && idents1.has(pad(s.cpf))) colideIdent++
  if (!s?.cpf) semCpf++
  if (!s?.pis_pasep) semPis++
}
console.log(`dos ${so3.length}: ja existe no HMM-01 sob outro identificador = ${colideIdent}`)
console.log(`  sem CPF no cadastro do SisEscala = ${semCpf}   sem PIS = ${semPis}`)
console.log(`cadastros do HMM-01 sem servidor_id resolvido = ${snaps['REP-iDClass-HMM-01'].filter(x=>!x.servidor_id).length}`)
console.log(`cadastros do HMM-03 sem servidor_id resolvido = ${snaps['REP-iDClass-HMM-03'].filter(x=>!x.servidor_id).length}`)
