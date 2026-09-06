// Equaliza os setores do HMM-03 com HMM-01/02. ESCRITA em producao, com pre-condicoes que abortam.
// Reversivel: DELETE das linhas inseridas devolve o relogio a "unidade inteira".
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const q=async p=>{const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok){console.error('ERRO',p,r.status,(await r.text()).slice(0,250));process.exit(1)}return r.json()}
const APLICAR=process.argv.includes('--aplicar')

const UNI='f248c6d1-952b-42de-b53b-11738625deff'
const devs=await q(`dispositivos_rep?select=id,nome&unidade_id=eq.${UNI}`)
const id=n=>devs.find(d=>d.nome.includes(n)).id
const D1=id('HMM-01'),D2=id('HMM-02'),D3=id('HMM-03')
const ds=await q(`dispositivos_rep_setores?select=*&limit=5000`)
const S=x=>[...new Set(ds.filter(y=>y.dispositivo_id===x).map(y=>y.setor_id))]
const s1=S(D1),s2=S(D2),s3=S(D3)

// PRE-CONDICOES — abortam em vez de "dar um jeito"
if(s1.length===0) throw new Error('HMM-01 sem setores: nao ha o que copiar')
if(s1.length!==s2.length||s1.some(x=>!s2.includes(x))) throw new Error('HMM-01 e HMM-02 divergem: escolha manual necessaria')
if(s3.length!==0) throw new Error(`HMM-03 ja tem ${s3.length} setores: nao sobrescrevo`)
console.log(`pre-condicoes OK. HMM-01=HMM-02=${s1.length} setores. HMM-03=0 (unidade inteira).`)

if(!APLICAR){console.log('\nENSAIO — nada foi escrito. Rode com --aplicar para valer.');process.exit(0)}

const cols=Object.keys(ds[0]).filter(c=>!['id','created_at','updated_at'].includes(c))
console.log('colunas usadas:',cols.join(','))
const linhas=s1.map(sid=>{const o={};for(const c of cols)o[c]=c==='dispositivo_id'?D3:(c==='setor_id'?sid:ds.find(y=>y.dispositivo_id===D1&&y.setor_id===sid)[c]);return o})

const r=await fetch(`${U}/rest/v1/dispositivos_rep_setores`,{method:'POST',headers:{...H,Prefer:'return=representation'},body:JSON.stringify(linhas)})
if(!r.ok){console.error('FALHA NA INSERCAO',r.status,(await r.text()).slice(0,400));process.exit(1)}
const ins=await r.json()
console.log('inseridas:',ins.length)

const dep=await q(`dispositivos_rep_setores?select=setor_id&dispositivo_id=eq.${D3}`)
const ok=dep.length===s1.length&&s1.every(x=>dep.some(y=>y.setor_id===x))
console.log(`conferencia: HMM-03 agora tem ${dep.length} setores | identico ao HMM-01: ${ok?'SIM':'NAO'}`)
if(!ok){console.error('DIVERGENCIA — reverta com o comando abaixo');process.exit(1)}
console.log(`\nrollback (se precisar):\n  curl -X DELETE "${U}/rest/v1/dispositivos_rep_setores?dispositivo_id=eq.${D3}" -H "apikey: <service_key>" -H "Authorization: Bearer <service_key>"`)
