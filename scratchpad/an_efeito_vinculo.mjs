import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function todas(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(p+' -> '+(await r.text()).slice(0,250));const q=await r.json();o.push(...q);if(q.length<1000)break}return o}
async function rpc(fn,b){const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(b)});if(!r.ok)throw new Error(fn+' -> '+(await r.text()).slice(0,250));return r.json()}
const unis = await todas('unidades?select=id,nome'); const uniHMM = unis.find(u=>u.nome.startsWith('HMM')).id
const disp = await todas(`dispositivos_rep?unidade_id=eq.${uniHMM}&ativo=eq.true&select=id,nome&order=nome`)
const nd = Object.fromEntries(disp.map(d=>[d.id,d.nome.replace('REP-iDClass-','').replace('REP iDClass - ','')]))
const setores = await todas(`setores?unidade_id=eq.${uniHMM}&select=id,parent_id,dicionario_setores(nome)`)
const byId=Object.fromEntries(setores.map(s=>[s.id,s])); const nome=s=>s?.dicionario_setores?.nome||'(?)'
const cam=s=>{const p=[];let c=s,g=0;while(c&&g++<10){p.unshift(nome(c));c=byId[c.parent_id]}return p.join(' \ ')}
const alvo = setores.filter(s=>['SAME \ APOIO','CCE - CENTRO DE CIRURGIAS ELETIVAS HMM \ MÉDICOS ESPECIALISTAS'].includes(cam(s)))
const gente = await todas(`servidores?unidade_id=eq.${uniHMM}&status=eq.Ativo&setor_id=in.(${alvo.map(s=>s.id).join(',')})&select=id,nome,matricula,setor_id,cpf,pis_pasep`)
console.log('=== as 3 pessoas afetadas ===')
for (const p of gente) {
  const snap = await todas(`rep_usuarios_dispositivo?servidor_id=eq.${p.id}&select=dispositivo_id,identificador_afd,tem_biometria`)
  console.log(`\n${p.nome} | mat ${p.matricula} | ${cam(byId[p.setor_id])}`)
  for (const s of snap) console.log(`   ja no ${nd[s.dispositivo_id]||s.dispositivo_id.slice(0,8)}: ident=${s.identificador_afd} digital=${s.tem_biometria}`)
  if (!snap.length) console.log('   nao esta em relogio nenhum')
}
console.log('\n=== cobertura de ponto por relogio, agora ===')
for (const d of disp) {
  const c = await rpc('fn_cobertura_ponto_resumo', { p_dispositivo_id: d.id }).catch(e=>({erro:e.message.slice(0,120)}))
  console.log(`${nd[d.id].padEnd(10)} ${JSON.stringify(c)}`)
}
console.log('\n=== pendencias de biometria agora ===')
for (const d of disp) {
  const p = await rpc('fn_biometria_faltante_dispositivo', { p_destino_id: d.id })
  const o={}; for(const x of p) o[x.origem_nome.replace('REP-iDClass-','')]=(o[x.origem_nome.replace('REP-iDClass-','')]||0)+1
  console.log(`${nd[d.id].padEnd(10)} ${p.length} ${JSON.stringify(o)}`)
  for (const x of p) console.log(`     ${x.servidor_nome} <- ${x.origem_nome}`)
}
