import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function todas(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(p+' -> '+(await r.text()).slice(0,200));const q=await r.json();o.push(...q);if(q.length<1000)break}return o}
const disp = JSON.parse(fs.readFileSync('scratchpad/_hmm_disp.json','utf8'))
const D = Object.fromEntries(disp.map(d=>[d.nome,d.id]))
const s1 = JSON.parse(fs.readFileSync('scratchpad/_snap_HMM-01.json','utf8'))
const s3 = JSON.parse(fs.readFileSync('scratchpad/_snap_HMM-03.json','utf8'))
const m1 = new Set(s1.map(x=>x.servidor_id))
const so3 = s3.filter(x=>!m1.has(x.servidor_id))

// setores vinculados ao HMM-01
const vinc01 = new Set((await todas(`dispositivos_rep_setores?dispositivo_id=eq.${D['REP-iDClass-HMM-01']}&select=setor_id`)).map(x=>x.setor_id))
const vinc03 = new Set((await todas(`dispositivos_rep_setores?dispositivo_id=eq.${D['REP-iDClass-HMM-03']}&select=setor_id`)).map(x=>x.setor_id))
const vincCCE = new Set((await todas(`dispositivos_rep_setores?dispositivo_id=eq.${D['REP-iDClass-CCE-01']}&select=setor_id`)).map(x=>x.setor_id))
console.log(`setores vinculados: HMM-01=${vinc01.size}  HMM-03=${vinc03.size}  CCE-01=${vincCCE.size}`)

const ids = so3.map(x=>x.servidor_id).filter(Boolean)
const svs = []
for (let i=0;i<ids.length;i+=50) svs.push(...await todas(`servidores?id=in.(${ids.slice(i,i+50).join(',')})&select=id,nome,matricula,status,unidade_id,setor_id`))
const svById = Object.fromEntries(svs.map(s=>[s.id,s]))
const unis = await todas('unidades?select=id,nome'); const nu = Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const uniHMM = unis.find(u=>u.nome.startsWith('HMM')).id

// escala em 09/2026 no HMM
const esc = await todas(`escala_mensal?mes=eq.9&ano=eq.2026&unidade_id=eq.${uniHMM}&select=servidor_id,setor_id`)
const escaladosHMM = new Set(esc.map(e=>e.servidor_id))

let cat = { ativo_lotado_hmm_setor_do_01:0, ativo_lotado_hmm_setor_do_cce:0, ativo_lotado_hmm_setor_sem_relogio:0,
            ativo_escalado_hmm_outra_lotacao:0, ativo_outra_unidade_sem_escala:0, inativo_ou_afastado:0, sem_servidor:0 }
const listaOutras = []
for (const x of so3) {
  const s = svById[x.servidor_id]
  if (!s) { cat.sem_servidor++; continue }
  if (s.status !== 'Ativo') { cat.inativo_ou_afastado++; continue }
  if (s.unidade_id === uniHMM) {
    if (vinc01.has(s.setor_id)) cat.ativo_lotado_hmm_setor_do_01++
    else if (vincCCE.has(s.setor_id)) cat.ativo_lotado_hmm_setor_do_cce++
    else cat.ativo_lotado_hmm_setor_sem_relogio++
  } else if (escaladosHMM.has(s.id)) cat.ativo_escalado_hmm_outra_lotacao++
  else { cat.ativo_outra_unidade_sem_escala++; listaOutras.push(`${s.nome} (${nu[s.unidade_id]}) digital=${x.tem_biometria}`) }
}
console.log('\n=== os 130 que so estao no HMM-03, por situacao ===')
for (const [k,v] of Object.entries(cat)) console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log('\n=== amostra dos "ativo de outra unidade, sem escala no HMM" ===')
for (const l of listaOutras.slice(0,12)) console.log('  '+l)
console.log(`  ... (${listaOutras.length} no total)`)
