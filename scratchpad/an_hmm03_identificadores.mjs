// Os identificadores por PIS do HMM-03 resolvem para a pessoa CERTA? E ha algo quebrado hoje
// por causa da diferenca PIS x CPF entre relogios? SOMENTE LEITURA.
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
const q=async p=>{const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok){console.error('ERRO',p,r.status,(await r.text()).slice(0,250));process.exit(1)}return r.json()}
const UNI='f248c6d1-952b-42de-b53b-11738625deff'
const devs=await q(`dispositivos_rep?select=id,nome&unidade_id=eq.${UNI}`)
const D3=devs.find(d=>d.nome.includes('HMM-03')).id
const dig=s=>String(s||'').replace(/\D/g,'')

const us=await q(`rep_usuarios_dispositivo?select=identificador_afd,servidor_id,tem_biometria&dispositivo_id=eq.${D3}&limit=2000`)
const ids=[...new Set(us.map(u=>u.servidor_id).filter(Boolean))]
const servs=[]
for(let i=0;i<ids.length;i+=100) servs.push(...await q(`servidores?select=id,nome,matricula,cpf,pis_pasep&id=in.(${ids.slice(i,i+100).join(',')})`))
const byId=Object.fromEntries(servs.map(s=>[s.id,s]))

let porCpf=0,porPis=0,semBater=0,bioPis=0
const errados=[]
for(const u of us){
  const s=byId[u.servidor_id]; if(!s) continue
  const ident=dig(u.identificador_afd).slice(-11)
  const casaCpf=dig(s.cpf).padStart(11,'0')===ident
  const casaPis=dig(s.pis_pasep).padStart(11,'0')===ident
  if(casaCpf)porCpf++
  else if(casaPis){porPis++; if(u.tem_biometria)bioPis++}
  else {semBater++; errados.push({ident,s})}
}
console.log(`=== HMM-03: ${us.length} cadastros ===`)
console.log(`  identificador CASA com o CPF do servidor:  ${porCpf}`)
console.log(`  identificador CASA com o PIS do servidor:  ${porPis}  (com biometria: ${bioPis})`)
console.log(`  NAO casa com nenhum dos dois:              ${semBater}   <- resolucao suspeita`)
for(const e of errados.slice(0,10)) console.log(`     ident=${e.ident} -> ${e.s.nome} (cpf=${dig(e.s.cpf)} pis=${dig(e.s.pis_pasep)})`)

// A diferenca esta quebrando alguma coisa hoje?
console.log('\n=== ESTA QUEBRANDO ALGO HOJE? ===')
const semServ=us.filter(u=>!u.servidor_id).length
console.log(`  cadastros sem servidor resolvido:          ${semServ}`)
const marc=await q(`marcacoes_ponto?select=id&dispositivo_id=eq.${D3}&servidor_id=is.null&limit=1`)
const marcTot=await fetch(`${U}/rest/v1/marcacoes_ponto?select=id&dispositivo_id=eq.${D3}`,{headers:{...H,Prefer:'count=exact',Range:'0-0'}})
console.log(`  marcacoes do HMM-03 no total:              ${(marcTot.headers.get('content-range')||'?').split('/')[1]}`)
const orf=await fetch(`${U}/rest/v1/marcacoes_ponto?select=id&dispositivo_id=eq.${D3}&servidor_id=is.null`,{headers:{...H,Prefer:'count=exact',Range:'0-0'}})
console.log(`  marcacoes ORFAS (sem dono):                ${(orf.headers.get('content-range')||'?').split('/')[1]}`)
const cop=await q(`rep_biometria_copias?select=status&or=(origem_id.eq.${D3},destino_id.eq.${D3})&limit=500`)
const okc=cop.filter(c=>c.status==='aplicada').length
console.log(`  copias de biometria com o HMM-03:          ${cop.length} (aplicadas: ${okc}, falhas: ${cop.length-okc})`)
