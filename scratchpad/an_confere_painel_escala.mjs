// Confere, contra producao, a migration 20260906110000 recem-aplicada. SOMENTE LEITURA.
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,A=env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const rpc=async(f,b,key)=>{
  const h=key?{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'}:H
  const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:h,body:JSON.stringify(b||{})})
  return {status:r.status, body:r.ok?await r.json():(await r.text()).slice(0,200)}
}

console.log('=== 1. AS FUNCOES EXISTEM E EXECUTAM? ===')
const p=await rpc('fn_cobertura_escala_parque',{p_mes:9,p_ano:2026})
const s=await rpc('fn_cobertura_escala_resumo',{p_mes:9,p_ano:2026})
console.log('  fn_cobertura_escala_parque:', p.status, Array.isArray(p.body)?`${p.body.length} linhas`:p.body)
console.log('  fn_cobertura_escala_resumo:', s.status, Array.isArray(s.body)?`${s.body.length} unidades`:s.body)
if(!Array.isArray(p.body)) process.exit(1)

console.log('\n=== 2. NUMEROS x PROTOTIPO (esperado: sem_biometria 61, sem_relogio_no_setor 17, fora_do_relogio 5, parcial 2) ===')
const ag={};for(const l of p.body)ag[l.situacao]=(ag[l.situacao]||0)+1
const esperado={sem_biometria:61,sem_relogio_no_setor:17,fora_do_relogio:5,parcial:2}
let ok=true
for(const k of Object.keys(esperado)){
  const bate=(ag[k]||0)===esperado[k]
  if(!bate)ok=false
  console.log(`  ${bate?'OK ':'XX '} ${k.padEnd(22)} funcao=${String(ag[k]||0).padStart(3)}  prototipo=${String(esperado[k]).padStart(3)}`)
}
for(const k of Object.keys(ag)) if(!(k in esperado)){ok=false;console.log(`  XX  situacao inesperada: ${k} (${ag[k]})`)}
const pessoas=new Set(p.body.map(l=>l.servidor_id)).size
const externos=new Set(p.body.filter(l=>l.externo).map(l=>l.servidor_id)).size
console.log(`  linhas=${p.body.length} (prototipo 85) | pessoas=${pessoas} (84) | externos=${externos} (2)`)
if(p.body.length!==85||pessoas!==84||externos!==2)ok=false
console.log(`  nenhuma linha "ok" vazou? ${ag.ok?'NAO - '+ag.ok+' vazaram':'sim'}`)

console.log('\n=== 3. O RESUMO BATE COM A LISTA? (envelope, nao segunda derivacao) ===')
const somaResumo=s.body.reduce((a,r)=>a+r.pessoas,0)
const porUni={};for(const l of p.body)(porUni[l.unidade_nome] ||= new Set()).add(l.servidor_id)
let resumoOk=true
for(const r of s.body){
  const n=porUni[r.unidade_nome]?.size||0
  if(n!==r.pessoas){resumoOk=false;console.log(`  XX ${r.unidade_nome}: resumo=${r.pessoas} lista=${n}`)}
}
console.log(`  ${resumoOk?'OK ':'XX '} pessoas por unidade conferem em ${s.body.length} unidades (soma=${somaResumo})`)
if(!resumoOk)ok=false

console.log('\n=== 4. PRIVILEGIOS: anon NAO pode, authenticated pode ===')
for(const f of ['fn_cobertura_escala_parque','fn_cobertura_escala_resumo']){
  const r=await rpc(f,{p_mes:9,p_ano:2026},A)
  const fechado=r.status===401||r.status===403||r.status===404
  if(!fechado)ok=false
  console.log(`  ${fechado?'OK ':'XX VAZANDO'} ${f} com chave anon -> HTTP ${r.status}`)
}

console.log('\n=== 5. AMOSTRA (o que o RH vai ver primeiro) ===')
for(const l of p.body.slice(0,6))
  console.log(`  dia ${String(l.primeiro_dia).padStart(2)} | ${String(l.matricula).padEnd(8)} ${l.servidor_nome.slice(0,32).padEnd(32)} | ${l.unidade_nome.slice(0,28).padEnd(28)} | ${l.situacao.padEnd(20)} | ${l.externo?'EXTERNO':''} bate em: ${(l.bate_em||'nenhum').slice(0,40)}`)

console.log(`\n>>> ${ok?'TUDO CERTO':'HA DIVERGENCIA — nao encerre'}`)
process.exit(ok?0:1)
