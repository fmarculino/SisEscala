import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function todas(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(p+' -> '+(await r.text()).slice(0,250));const q=await r.json();o.push(...q);if(q.length<1000)break}return o}
const unis = await todas('unidades?select=id,nome'); const uniHMM = unis.find(u=>u.nome.startsWith('HMM')).id
const disp = await todas(`dispositivos_rep?unidade_id=eq.${uniHMM}&ativo=eq.true&select=id,nome&order=nome`)
const nd = Object.fromEntries(disp.map(d=>[d.id,d.nome.replace('REP-iDClass-','').replace('REP iDClass - ','')]))
const vinc = {}
for (const d of disp) vinc[d.id] = new Set((await todas(`dispositivos_rep_setores?dispositivo_id=eq.${d.id}&select=setor_id`)).map(x=>x.setor_id))
const setores = await todas(`setores?unidade_id=eq.${uniHMM}&select=id,parent_id,ativo,dicionario_setores(nome)`)
const byId = Object.fromEntries(setores.map(s=>[s.id,s]))
const nome = s => s?.dicionario_setores?.nome || '(?)'
const cam = s => { const p=[]; let c=s,g=0; while(c&&g++<10){p.unshift(nome(c)); c=byId[c.parent_id]} return p.join(' \ ') }
const em = sid => disp.filter(d=>vinc[d.id].has(sid)).map(d=>nd[d.id]).join('+') || 'NENHUM'
const servs = await todas(`servidores?unidade_id=eq.${uniHMM}&status=eq.Ativo&select=id,setor_id`)
const cnt = {}; for (const s of servs) cnt[s.setor_id]=(cnt[s.setor_id]||0)+1

console.log('=== todos os setores chamados CSST na unidade HMM ===')
for (const s of setores.filter(x=>nome(x)==='CSST'))
  console.log(`  id=${s.id.slice(0,8)}  caminho="${cam(s)}"  ativo=${s.ativo}  lotados=${cnt[s.id]||0}  relogio=${em(s.id)}`)

console.log('\n=== nomes de setor REPETIDOS dentro do HMM ===')
const porNome = {}
for (const s of setores) (porNome[nome(s)] ||= []).push(s)
for (const [n, lista] of Object.entries(porNome).filter(([,l])=>l.length>1))
  console.log(`  ${n}: ${lista.map(s=>`"${cam(s)}"(${cnt[s.id]||0}p, ${em(s.id)})`).join('   |   ')}`)

console.log('\n=== TODOS os setores do HMM sem relogio vinculado ===')
for (const s of setores.filter(x=>em(x.id)==='NENHUM').sort((a,b)=>cam(a).localeCompare(cam(b))))
  console.log(`  ${String(cnt[s.id]||0).padStart(3)} lotados  ${cam(s)}${s.ativo===false?'  [inativo]':''}`)
