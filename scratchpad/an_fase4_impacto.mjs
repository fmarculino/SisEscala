// A pergunta que decide a Fase 4: destes casos, quantos estao CONTANDO horas indevidamente?
import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const rpc=async(n,b)=>{const r=await fetch(`${U}/rest/v1/rpc/${n}`,{method:'POST',headers:H,body:JSON.stringify(b)});return r.ok?await r.json():null}
const q=async p=>(await fetch(`${U}/rest/v1/${p}`,{headers:H})).json()

const cls=JSON.parse(fs.readFileSync('scratchpad/_fase4_casos.json','utf8'))
const alvos=[...cls.chegada_antecipada,...cls.provavel_esqueceu_entrada]
console.log(`avaliando ${alvos.length} linhas "so saida" (os 15 ja tratados ficam de fora)\n`)

const hoje=await rpc('fn_data_local',{})
let contando=0, emAvaliacao=0, naoAplicavel=0
const cont=[]
for(const a of alvos){
  const d=await rpc('fn_desfecho_evento_dia',{p_escala_diaria_id:a.edId,p_hoje:String(hoje)})
  const e=Array.isArray(d)&&d[0]?d[0]:null
  if(!e){ continue }
  if(e.estado==='registrado'||e.estado==='validado'){ contando++; cont.push({...a,estado:e.estado,horas:e.horas}) }
  else if(e.estado==='em_avaliacao') emAvaliacao++
  else naoAplicavel++
}
console.log(`CONTANDO no anexo (registrado/validado): ${contando}`)
console.log(`em_avaliacao (ja NAO contam no anexo):    ${emAvaliacao}`)
console.log(`nao_aplicavel (Regular/Extra, fora do anexo de plantao): ${naoAplicavel}`)
if(cont.length) console.log('\nOs que contam:', JSON.stringify(cont,null,1))

// o caso EUZILENE esta entre eles?
const euz=alvos.find(a=>a.mat==='68216')
console.log('\nEUZILENE (mat 68216, dia 12) na lista?', euz?JSON.stringify(euz):'NAO')
