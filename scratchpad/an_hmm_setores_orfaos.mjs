// Lista os servidores do HMM em setor sem relogio, com o caminho completo do setor e o possivel
// setor "gemeo" (mesmo nome, ja coberto) para o RH realocar. SOMENTE LEITURA.
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
const q=async p=>{const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok){console.error('ERRO',p,r.status,(await r.text()).slice(0,250));process.exit(1)}return r.json()}
const pag=async(t,f)=>{const o=[];for(let i=0;;i+=1000){const r=await fetch(`${U}/rest/v1/${t}${f}&order=id`,{headers:{...H,Range:`${i}-${i+999}`}});const g=await r.json();o.push(...g);if(g.length<1000)break}return o}

const UNI='f248c6d1-952b-42de-b53b-11738625deff'
const devs=await q(`dispositivos_rep?select=id,nome&unidade_id=eq.${UNI}`)
const ds=await q(`dispositivos_rep_setores?select=dispositivo_id,setor_id&limit=5000`)
const idd=n=>devs.find(d=>d.nome.includes(n)).id
const sHMM=new Set(ds.filter(y=>y.dispositivo_id===idd('HMM-01')).map(y=>y.setor_id))
const sCCE=new Set(ds.filter(y=>y.dispositivo_id===idd('CCE-01')).map(y=>y.setor_id))

// arvore de setores (paginada — 645+ setores, armadilha 8)
const setores=await pag('setores','?select=id,parent_id,ativo,unidade_id,dicionario_setores(nome)')
const byId=Object.fromEntries(setores.map(s=>[s.id,s]))
const caminho=(id,vis=new Set())=>{const s=byId[id];if(!s||vis.has(id))return '(?)';vis.add(id)
  const n=s.dicionario_setores?.nome||'(sem nome)';return s.parent_id?caminho(s.parent_id,vis)+' \ '+n:n}
const nomeDe=id=>byId[id]?.dicionario_setores?.nome||'(sem nome)'

const lot=await pag('servidores',`?select=id,nome,matricula,setor_id,status,cargo&unidade_id=eq.${UNI}&status=eq.Ativo`)
const orfaos=lot.filter(s=>s.setor_id&&!sHMM.has(s.setor_id)&&!sCCE.has(s.setor_id))

// onde ja estao cadastrados
const us=[]
for(let i=0;i<orfaos.length;i+=100)
  us.push(...await q(`rep_usuarios_dispositivo?select=servidor_id,dispositivo_id,tem_biometria&servidor_id=in.(${orfaos.slice(i,i+100).map(s=>s.id).join(',')})`))
const nomeDev=Object.fromEntries(devs.map(d=>[d.id,d.nome]))
const porServ={};for(const u of us)(porServ[u.servidor_id] ||= []).push(u)

// gemeo: outro setor do HMM com o MESMO nome que ja esta coberto por algum relogio
const gemeo=id=>{const n=nomeDe(id)
  const c=setores.filter(s=>s.unidade_id===UNI&&s.id!==id&&(s.dicionario_setores?.nome===n)&&(sHMM.has(s.id)||sCCE.has(s.id)))
  return c.map(s=>caminho(s.id)+(sCCE.has(s.id)?'  [CCE]':'  [HMM]'))}

const porSetor={}
for(const s of orfaos)(porSetor[s.setor_id] ||= []).push(s)
console.log(`SERVIDORES ATIVOS DO HMM EM SETOR SEM RELOGIO: ${orfaos.length} em ${Object.keys(porSetor).length} setores\n`)
const linhas=[['matricula','nome','cargo','setor_atual','setor_ativo','ja_no_relogio','tem_biometria','possivel_destino']]
for(const [sid,l] of Object.entries(porSetor).sort((a,b)=>b[1].length-a[1].length)){
  const g=gemeo(sid)
  console.log(`### ${caminho(sid)}${byId[sid]?.ativo===false?'   ⚠️ SETOR INATIVO':''}  — ${l.length} pessoa(s)`)
  console.log(g.length?`    possivel destino (mesmo nome, ja coberto): ${g.join(' | ')}`:'    sem setor de mesmo nome coberto — realocacao precisa de criterio do RH')
  for(const s of l){
    const d=porServ[s.id]||[]
    console.log(`      ${String(s.matricula).padEnd(8)} ${s.nome}`)
    linhas.push([s.matricula,s.nome,s.cargo||'',caminho(sid),byId[sid]?.ativo===false?'NAO':'sim',
      d.map(x=>nomeDev[x.dispositivo_id]||'?').join('+')||'-',d.some(x=>x.tem_biometria)?'sim':'nao',g.join(' | ')])
  }
  console.log('')
}
fs.writeFileSync('scratchpad/hmm_setores_orfaos.csv',linhas.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(';')).join('\r\n'),'utf8')
console.log('CSV para o RH: scratchpad/hmm_setores_orfaos.csv  (ignorado pelo git — contem dado pessoal)')
