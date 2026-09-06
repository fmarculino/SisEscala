import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function todas(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(p+' -> '+(await r.text()).slice(0,200));const q=await r.json();o.push(...q);if(q.length<1000)break}return o}
const s1 = JSON.parse(fs.readFileSync('scratchpad/_snap_HMM-01.json','utf8'))
const s3 = JSON.parse(fs.readFileSync('scratchpad/_snap_HMM-03.json','utf8'))
const ids = [...new Set([...s1,...s3].map(x=>x.servidor_id).filter(Boolean))]
const svs = []
for (let i=0;i<ids.length;i+=50) svs.push(...await todas(`servidores?id=in.(${ids.slice(i,i+50).join(',')})&select=id,nome,matricula,cpf,pis_pasep,status,unidade_id,setor_id,vinculo_multiplo_confirmado,mesclado_em_servidor_id`))
const sv = Object.fromEntries(svs.map(s=>[s.id,s]))
const pad = v => String(v||'').replace(/\D/g,'').padStart(12,'0')
const m1 = new Map(s1.map(x=>[x.servidor_id,x]))
const idents1 = new Map(s1.map(x=>[x.identificador_afd,x]))
const so3 = s3.filter(x=>!m1.has(x.servidor_id))
console.log('=== os 2 casos de CPF que ja e identificador no HMM-01 ===')
for (const x of so3) {
  const s = sv[x.servidor_id]; if (!s) continue
  const colide = idents1.get(pad(s.cpf))
  if (!colide) continue
  const outro = sv[colide.servidor_id]
  console.log(`\n  no HMM-03: ${s.nome} | mat ${s.matricula} | cpf ${s.cpf} | pis ${s.pis_pasep}`)
  console.log(`             ident no device = ${x.identificador_afd}  digital=${x.tem_biometria}  status=${s.status}`)
  console.log(`             vinculo_multiplo_confirmado=${s.vinculo_multiplo_confirmado}  mesclado=${!!s.mesclado_em_servidor_id}`)
  console.log(`  no HMM-01: ${outro?.nome} | mat ${outro?.matricula} | cpf ${outro?.cpf} | pis ${outro?.pis_pasep}`)
  console.log(`             ident no device = ${colide.identificador_afd}  digital=${colide.tem_biometria}  status=${outro?.status}`)
  console.log(`             vinculo_multiplo_confirmado=${outro?.vinculo_multiplo_confirmado}  mesclado=${!!outro?.mesclado_em_servidor_id}`)
  console.log(`  >>> MESMO CPF, servidor_id DIFERENTE = ${s.id !== colide.servidor_id}`)
}
