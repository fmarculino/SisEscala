import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function todas(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(p+' -> '+(await r.text()).slice(0,250));const q=await r.json();o.push(...q);if(q.length<1000)break}return o}

const unis = await todas('unidades?select=id,nome')
const uniHMM = unis.find(u=>u.nome.startsWith('HMM')).id
const disp = await todas(`dispositivos_rep?unidade_id=eq.${uniHMM}&ativo=eq.true&select=id,nome&order=nome`)
const nd = Object.fromEntries(disp.map(d=>[d.id,d.nome]))
const vinc = {}
for (const d of disp) vinc[d.id] = new Set((await todas(`dispositivos_rep_setores?dispositivo_id=eq.${d.id}&select=setor_id`)).map(x=>x.setor_id))
const vinculadoA = sid => disp.filter(d=>vinc[d.id].has(sid)).map(d=>nd[d.id].replace('REP-iDClass-','').replace('REP iDClass - ',''))

const setores = await todas(`setores?unidade_id=eq.${uniHMM}&select=id,parent_id,ativo,dicionario_setores(nome)`)
const nome = s => s?.dicionario_setores?.nome || '(?)'
const byId = Object.fromEntries(setores.map(s=>[s.id,s]))
const caminho = s => { const p=[]; let c=s, g=0; while(c && g++<10){ p.unshift(nome(c)); c=byId[c.parent_id] } return p.join(' \ ') }

const servs = await todas(`servidores?unidade_id=eq.${uniHMM}&status=eq.Ativo&select=id,nome,matricula,setor_id`)
const porSetor = {}
for (const s of servs) (porSetor[s.setor_id] ||= []).push(s)

// marcacoes reais dos ultimos 60 dias, por servidor e dispositivo
const desde = new Date(Date.now()-60*24*3600*1000).toISOString()
const marc = await todas(`marcacoes_ponto?origem=eq.rep&ocorrido_em=gte.${desde}&select=servidor_id,dispositivo_id&limit=100000`)
const batidasPorServidor = {}
for (const m of marc) if (m.servidor_id) (batidasPorServidor[m.servidor_id] ||= {})[m.dispositivo_id] = ((batidasPorServidor[m.servidor_id]||{})[m.dispositivo_rep_id]||0)+1

const snapAll = {}
for (const d of disp) for (const l of await todas(`rep_usuarios_dispositivo?dispositivo_id=eq.${d.id}&select=servidor_id,tem_biometria`))
  if (l.servidor_id) (snapAll[l.servidor_id] ||= {})[d.id] = l.tem_biometria

const semRelogio = setores.filter(s => vinculadoA(s.id).length === 0 && (porSetor[s.id]||[]).length > 0)
console.log(`=== setores do HMM SEM relogio vinculado e COM gente lotada: ${semRelogio.length} ===\n`)
const linhas = []
for (const s of semRelogio.sort((a,b)=>caminho(a).localeCompare(caminho(b)))) {
  const gente = porSetor[s.id]
  let cad = {}, batem = {}
  for (const p of gente) {
    for (const [dispId, bio] of Object.entries(snapAll[p.id]||{})) { const n=nd[dispId]; cad[n]=(cad[n]||0)+1; if(bio) cad[n+' c/digital']=(cad[n+' c/digital']||0)+1 }
    for (const [dispId, q] of Object.entries(batidasPorServidor[p.id]||{})) { const n=nd[dispId]||dispId.slice(0,8); batem[n]=(batem[n]||0)+q }
  }
  linhas.push({ setor: caminho(s), ativo: s.ativo, pessoas: gente.length, cadastrados: cad, batidas_60d: batem })
}
for (const l of linhas.sort((a,b)=>b.pessoas-a.pessoas)) {
  console.log(`${l.setor}${l.ativo===false?'  [SETOR INATIVO]':''}`)
  console.log(`   lotados ativos: ${l.pessoas}`)
  const c = Object.entries(l.cadastrados).filter(([k])=>!k.includes('c/digital'))
  console.log(`   cadastrados em: ${c.length?c.map(([k,v])=>`${k.replace('REP-iDClass-','').replace('REP iDClass - ','')}=${v}(${l.cadastrados[k+' c/digital']||0} c/digital)`).join('  '):'nenhum relogio'}`)
  const b = Object.entries(l.batidas_60d)
  console.log(`   BATIDAS reais 60d: ${b.length?b.map(([k,v])=>`${k.replace('REP-iDClass-','').replace('REP iDClass - ','')}=${v}`).join('  '):'nenhuma'}`)
  console.log()
}
console.log(`TOTAL de lotados ativos em setor sem relogio: ${linhas.reduce((a,b)=>a+b.pessoas,0)}`)
