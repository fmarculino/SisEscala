// Prontidao dos 3 relogios do predio principal do HMM para o inicio do ponto.
// "Sincronizado" = quem esta em um tem que estar nos outros, com digital. SOMENTE LEITURA.
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
const q=async p=>{const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok){console.error('ERRO',p,r.status,(await r.text()).slice(0,250));process.exit(1)}return r.json()}
const pag=async(t,f)=>{const o=[];for(let i=0;;i+=1000){const r=await fetch(`${U}/rest/v1/${t}${f}&order=id`,{headers:{...H,Range:`${i}-${i+999}`}});const g=await r.json();o.push(...g);if(g.length<1000)break}return o}
const emLotes=async(ids,fn)=>{const o=[];for(let i=0;i<ids.length;i+=100)o.push(...await fn(ids.slice(i,i+100)));return o}

const UNI='f248c6d1-952b-42de-b53b-11738625deff'
const devs=await q(`dispositivos_rep?select=id,nome,ultimo_contato_em&unidade_id=eq.${UNI}&order=nome`)
const TRES=devs.filter(d=>/HMM-0[123]/.test(d.nome))
const nome=Object.fromEntries(devs.map(d=>[d.id,d.nome]))
const ds=await q(`dispositivos_rep_setores?select=dispositivo_id,setor_id&limit=5000`)
const S173=new Set(ds.filter(y=>y.dispositivo_id===TRES[0].id).map(y=>y.setor_id))
console.log(`relogios: ${TRES.map(d=>d.nome).join(', ')} | escopo: ${S173.size} setores\n`)

// UNIVERSO = lotados ativos nos 173 setores UNIAO escalados na competencia (armadilha: uniao, nunca substituicao)
const lot=(await pag('servidores',`?select=id,nome,matricula,setor_id&unidade_id=eq.${UNI}&status=eq.Ativo`)).filter(s=>S173.has(s.setor_id))
const esc=await pag('escala_mensal',`?select=servidor_id,setor_id&unidade_id=eq.${UNI}&mes=eq.9&ano=eq.2026`)
const idsEsc=[...new Set(esc.filter(e=>S173.has(e.setor_id)).map(e=>e.servidor_id))]
const faltam=idsEsc.filter(i=>!lot.some(s=>s.id===i))
const extras=faltam.length?await emLotes(faltam,b=>q(`servidores?select=id,nome,matricula,setor_id&id=in.(${b.join(',')})&status=eq.Ativo`)):[]
const universo=[...lot,...extras]
console.log(`UNIVERSO: ${universo.length} pessoas (${lot.length} lotadas + ${extras.length} so escaladas/externas)\n`)

// snapshot dos 3
const snap={}
for(const d of TRES) snap[d.id]=Object.fromEntries((await pag('rep_usuarios_dispositivo',`?select=servidor_id,identificador_afd,tem_biometria&dispositivo_id=eq.${d.id}`)).filter(u=>u.servidor_id).map(u=>[u.servidor_id,u]))

const cat={prontos:[],semBioEmAlgum:[],semCadastroEmAlgum:[],semBioNenhum:[],forinha:[]}
for(const s of universo){
  const st=TRES.map(d=>snap[d.id][s.id])
  const nCad=st.filter(Boolean).length, nBio=st.filter(x=>x?.tem_biometria).length
  if(nCad===0) cat.forinha.push(s)
  else if(nBio===0) cat.semBioNenhum.push(s)
  else if(nCad<3) cat.semCadastroEmAlgum.push({s,st})
  else if(nBio<3) cat.semBioEmAlgum.push({s,st})
  else cat.prontos.push(s)
}
console.log('=== PRONTIDAO PARA AMANHA ===')
console.log(`  ✅ nos 3 relogios COM digital (batem em qualquer um): ${cat.prontos.length}`)
console.log(`  🟡 cadastrados nos 3, digital faltando em algum:      ${cat.semBioEmAlgum.length}  <- copia automatica resolve`)
console.log(`  🟡 falta o CADASTRO em algum relogio:                 ${cat.semCadastroEmAlgum.length}  <- fila resolve`)
console.log(`  🔴 SEM digital em NENHUM dos 3 (nao consegue bater):  ${cat.semBioNenhum.length}  <- exige cadastro presencial`)
console.log(`  🔴 fora dos 3 relogios (nem cadastro):                ${cat.forinha.length}`)

const linha=(s,st)=>`      ${String(s.matricula).padEnd(8)} ${s.nome.padEnd(42)} ${TRES.map((d,i)=>`${d.nome.slice(-2)}:${!st[i]?'--':(st[i].tem_biometria?'BIO':'sem')}`).join('  ')}`
if(cat.semBioEmAlgum.length){console.log('\n  🟡 digital faltando em algum (a copia deve fechar sozinha):')
  for(const {s,st} of cat.semBioEmAlgum.slice(0,15)) console.log(linha(s,st))
  if(cat.semBioEmAlgum.length>15)console.log(`      ... +${cat.semBioEmAlgum.length-15}`)}
if(cat.semCadastroEmAlgum.length){console.log('\n  🟡 cadastro faltando em algum:')
  for(const {s,st} of cat.semCadastroEmAlgum.slice(0,15)) console.log(linha(s,st))
  if(cat.semCadastroEmAlgum.length>15)console.log(`      ... +${cat.semCadastroEmAlgum.length-15}`)}
if(cat.semBioNenhum.length){console.log('\n  🔴 SEM DIGITAL EM LUGAR NENHUM — nao vao conseguir bater amanha:')
  for(const s of cat.semBioNenhum.slice(0,40)) console.log(`      ${String(s.matricula).padEnd(8)} ${s.nome}`)
  if(cat.semBioNenhum.length>40)console.log(`      ... +${cat.semBioNenhum.length-40}`)}
if(cat.forinha.length){console.log('\n  🔴 fora dos 3 relogios:')
  for(const s of cat.forinha.slice(0,20)) console.log(`      ${String(s.matricula).padEnd(8)} ${s.nome}`)
  if(cat.forinha.length>20)console.log(`      ... +${cat.forinha.length-20}`)}

console.log('\n=== FILAS AUTOMATICAS (devem drenar sozinhas) ===')
for(const d of TRES){
  const f=await q(`rep_cadastros_fila?select=status&dispositivo_id=eq.${d.id}&limit=2000`)
  const ag={};for(const x of f)ag[x.status]=(ag[x.status]||0)+1
  console.log(`  ${d.nome}: fila cadastro ${JSON.stringify(ag)} | ultimo contato ${d.ultimo_contato_em}`)
}
const rb=async id=>{const r=await fetch(`${U}/rest/v1/rpc/fn_biometria_faltante_dispositivo`,{method:'POST',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({p_destino_id:id})});return r.ok?(await r.json()).length:'erro'}
for(const d of TRES) console.log(`  ${d.nome}: pendencias de biometria agora = ${await rb(d.id)}`)

const csv=[['matricula','nome','situacao',...TRES.map(d=>d.nome)]]
for(const s of cat.semBioNenhum) csv.push([s.matricula,s.nome,'SEM DIGITAL EM NENHUM',...TRES.map(d=>snap[d.id][s.id]?'cadastrado':'ausente')])
for(const s of cat.forinha) csv.push([s.matricula,s.nome,'FORA DOS RELOGIOS','ausente','ausente','ausente'])
fs.writeFileSync('scratchpad/hmm_prontidao_ponto.csv',csv.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(';')).join('\r\n'),'utf8')
console.log('\nCSV dos bloqueados: scratchpad/hmm_prontidao_ponto.csv (fora do git)')
