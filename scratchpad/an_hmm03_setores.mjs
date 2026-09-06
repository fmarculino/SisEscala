// Ensaio (dry-run) da equalizacao de setores do HMM-03 com HMM-01/02. SOMENTE LEITURA.
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
const q=async p=>{const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok){console.error('ERRO',p,r.status,(await r.text()).slice(0,250));process.exit(1)}return r.json()}
const UNI='f248c6d1-952b-42de-b53b-11738625deff'
const devs=await q(`dispositivos_rep?select=id,nome&unidade_id=eq.${UNI}&order=nome`)
const id=n=>devs.find(d=>d.nome.includes(n)).id
const D1=id('HMM-01'),D2=id('HMM-02'),D3=id('HMM-03'),DC=id('CCE-01')
const ds=await q(`dispositivos_rep_setores?select=dispositivo_id,setor_id&limit=5000`)
const S=x=>new Set(ds.filter(y=>y.dispositivo_id===x).map(y=>y.setor_id))
const s1=S(D1),s2=S(D2),s3=S(D3),sc=S(DC)

console.log('=== 2 CADASTROS QUE FALHARAM NO HMM-03 ===')
const f=await q(`rep_cadastros_fila?select=servidor_id,erro,processado_em&dispositivo_id=eq.${D3}&status=eq.falhou`)
for(const x of f){const s=await q(`servidores?select=nome,matricula,cpf,pis_pasep&id=eq.${x.servidor_id}`)
  console.log(`  ${s[0]?.nome} (mat ${s[0]?.matricula}) | ${x.erro}`)}

console.log('\n=== HMM-01 x HMM-02: as listas sao identicas? ===')
const so1=[...s1].filter(x=>!s2.has(x)), so2=[...s2].filter(x=>!s1.has(x))
console.log(`  HMM-01=${s1.size}  HMM-02=${s2.size}  so no 01=${so1.length}  so no 02=${so2.length}  ->`,
  so1.length===0&&so2.length===0?'IDENTICAS':'DIVERGEM')

console.log('\n=== EFEITO DE DAR AO HMM-03 OS MESMOS SETORES ===')
console.log(`  hoje: ${s3.size} setores (0 = unidade inteira, atende TUDO)`)
console.log(`  depois: ${s1.size} setores`)
console.log(`  sobreposicao com CCE-01 hoje: ${sc.size} (unidade inteira alcanca os 10)`)
console.log(`  sobreposicao com CCE-01 depois: ${[...s1].filter(x=>sc.has(x)).length}  <- ponto cego`)

// quem esta cadastrado no HMM-03 e ficaria FORA do escopo novo
const us=await q(`rep_usuarios_dispositivo?select=servidor_id&dispositivo_id=eq.${D3}&limit=2000`)
const ids=us.map(u=>u.servidor_id).filter(Boolean)
const servs=[]
for(let i=0;i<ids.length;i+=100){
  servs.push(...await q(`servidores?select=id,nome,matricula,setor_id,unidade_id,status&id=in.(${ids.slice(i,i+100).join(',')})`))
}
const fora=servs.filter(s=>!s1.has(s.setor_id))
console.log(`\n  cadastrados hoje no HMM-03: ${servs.length}`)
console.log(`  ficariam FORA do escopo novo: ${fora.length}  (permanecem no relogio; so deixam de ser enfileirados/cobrados)`)
const porUni={}
for(const s of fora) porUni[s.unidade_id===UNI?'HMM':'outra unidade']=(porUni[s.unidade_id===UNI?'HMM':'outra unidade']||0)+1
console.log('   ',JSON.stringify(porUni))
for(const s of fora.slice(0,8)) console.log(`     ${s.nome} (mat ${s.matricula}, ${s.status})`)
if(fora.length>8) console.log(`     ... +${fora.length-8}`)
console.log('\n  setor_id nulo entre eles:',servs.filter(s=>!s.setor_id).length)
