// Avalia se ligar o HMM-03 (relogio reaproveitado, cadastro por PIS) criou duplicidade
// contra o cadastro atual do SisEscala (por CPF). SOMENTE LEITURA.
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
const q=async p=>{const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok){console.error('ERRO',p,r.status,(await r.text()).slice(0,250));process.exit(1)}return r.json()}
const pag=async(t,sel,f='')=>{const o=[];for(let i=0;;i+=1000){const r=await fetch(`${U}/rest/v1/${t}?select=${sel}${f}&order=id`,{headers:{...H,Range:`${i}-${i+999}`}});const g=await r.json();o.push(...g);if(g.length<1000)break}return o}

const UNI='f248c6d1-952b-42de-b53b-11738625deff'
const devs=await q(`dispositivos_rep?select=id,nome,created_at&unidade_id=eq.${UNI}&order=nome`)
const nome=Object.fromEntries(devs.map(d=>[d.id,d.nome]))
const D3=devs.find(d=>d.nome.includes('HMM-03')).id

console.log('=== 1. DUPLICIDADE DENTRO DE CADA RELOGIO (mesmo servidor, 2+ cadastros) ===')
for(const d of devs){
  const us=await pag('rep_usuarios_dispositivo','id,identificador_afd,servidor_id,tem_biometria',`&dispositivo_id=eq.${d.id}`)
  const porServ={}
  for(const u of us) if(u.servidor_id) (porServ[u.servidor_id] ||= []).push(u)
  const dup=Object.entries(porServ).filter(([,l])=>l.length>1)
  console.log(`  ${d.nome.padEnd(20)} cadastros=${us.length}  servidores distintos=${Object.keys(porServ).length}  DUPLICADOS=${dup.length}`)
  for(const [sid,l] of dup.slice(0,10)){
    const s=await q(`servidores?select=nome,matricula,cpf,pis_pasep&id=eq.${sid}`)
    console.log(`     ${s[0]?.nome} (mat ${s[0]?.matricula}) -> ${l.map(x=>x.identificador_afd+(x.tem_biometria?' [bio]':'')).join(' , ')}`)
  }
  if(dup.length>10) console.log(`     ... +${dup.length-10}`)
}

console.log('\n=== 2. FILA DE CADASTRO PARA O HMM-03 ===')
const fila=await q(`rep_cadastros_fila?select=status,created_at,processado_em,erro,servidor_id&dispositivo_id=eq.${D3}&order=created_at.desc&limit=1000`)
const porSt={}
for(const f of fila) porSt[f.status]=(porSt[f.status]||0)+1
console.log('  total:',fila.length,JSON.stringify(porSt))
for(const f of fila.slice(0,10)) console.log(`   ${f.created_at} | ${f.status} | ${(f.erro||'').slice(0,100)}`)

console.log('\n=== 3. FILA EM TODOS OS RELOGIOS DO HMM (ultimas 24h) ===')
const dl=new Date(Date.now()-24*36e5).toISOString()
const f24=await q(`rep_cadastros_fila?select=dispositivo_id,status&created_at=gte.${dl}&limit=2000`)
const ag={}
for(const f of f24){const k=`${nome[f.dispositivo_id]||f.dispositivo_id.slice(0,8)} | ${f.status}`;ag[k]=(ag[k]||0)+1}
for(const [k,n] of Object.entries(ag).sort()) console.log('  ',String(n).padStart(4),k)

console.log('\n=== 4. VINCULOS NO HMM-03 (identificador que o SisEscala considera oficial) ===')
const v=await pag('rep_vinculos_servidor','id,servidor_id,identificador_afd,tem_biometria,vigente_de,vigente_ate',`&dispositivo_id=eq.${D3}`)
const vig=v.filter(x=>!x.vigente_ate)
console.log('  vinculos vigentes:',vig.length,'| encerrados:',v.length-vig.length)
const us3=await pag('rep_usuarios_dispositivo','id,identificador_afd,servidor_id',`&dispositivo_id=eq.${D3}`)
const identNoRelogio=new Set(us3.map(u=>u.identificador_afd))
const divergente=vig.filter(x=>!identNoRelogio.has(x.identificador_afd))
console.log('  vinculos vigentes cujo identificador NAO esta no relogio:',divergente.length)
for(const x of divergente.slice(0,10)){
  const s=await q(`servidores?select=nome,matricula&id=eq.${x.servidor_id}`)
  console.log(`     ${s[0]?.nome} vinculo=${x.identificador_afd}`)
}

console.log('\n=== 5. COPIAS DE BIOMETRIA COM O HMM-03 ===')
const c=await q(`rep_biometria_copias?select=created_at,origem_id,destino_id,status,templates_copiados,erro&or=(origem_id.eq.${D3},destino_id.eq.${D3})&order=created_at.desc&limit=100`)
console.log('  total:',c.length)
for(const x of c.slice(0,15)) console.log(`   ${x.created_at} | ${nome[x.origem_id]} -> ${nome[x.destino_id]} | ${x.status} | ${(x.erro||'').slice(0,90)}`)
