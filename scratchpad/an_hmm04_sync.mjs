// SOMENTE LEITURA. Compara os relogios do HMM: setores vinculados, snapshot, biometria, fila.
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function q(p){ const out=[]; for(let f=0;;f+=1000){
  const r = await fetch(`${U}/rest/v1/${p}`,{headers:{...H, Range:`${f}-${f+999}`}})
  if(!r.ok){ console.error('ERRO',p,r.status,(await r.text()).slice(0,300)); process.exit(1) }
  const pg = await r.json(); out.push(...pg); if(pg.length<1000) break } return out }

const uni = (await q(`unidades?select=id,nome&nome=ilike.*HMM*`))[0]
console.log('unidade:', uni.nome, uni.id)

const disp = await q(`dispositivos_rep?select=id,nome,ativo,unidade_id,ponto_valido_desde,ultimo_contato_em,coletor_ip,ultimo_nsr,created_at,updated_at,usuarios_lidos_em,usuarios_lidos_total&unidade_id=eq.${uni.id}&order=nome`)
console.log('\n=== DISPOSITIVOS ===')
for (const d of disp) console.log(`${d.nome} | ativo=${d.ativo} | ip_coletor=${d.coletor_ip} | criado=${d.created_at?.slice(0,10)} | ponto_valido_desde=${d.ponto_valido_desde} | contato=${d.ultimo_contato_em} | lidos=${d.usuarios_lidos_total}@${d.usuarios_lidos_em}`)

// setores vinculados
const vincs = await q(`dispositivos_rep_setores?select=dispositivo_id,setor_id`)
const setoresPorDisp = {}
for (const d of disp) setoresPorDisp[d.id] = new Set()
for (const v of vincs) if (setoresPorDisp[v.dispositivo_id]) setoresPorDisp[v.dispositivo_id].add(v.setor_id)

console.log('\n=== SETORES VINCULADOS ===')
for (const d of disp) console.log(`${d.nome}: ${setoresPorDisp[d.id].size} setores`)

// diferencas par a par
const nomes = Object.fromEntries(disp.map(d=>[d.id,d.nome]))
console.log('\n=== DIFERENCA DE SETORES (par a par) ===')
for (let i=0;i<disp.length;i++) for (let j=i+1;j<disp.length;j++){
  const a=setoresPorDisp[disp[i].id], b=setoresPorDisp[disp[j].id]
  const soA=[...a].filter(x=>!b.has(x)), soB=[...b].filter(x=>!a.has(x))
  console.log(`${nomes[disp[i].id]} x ${nomes[disp[j].id]}: comum=${[...a].filter(x=>b.has(x)).length} soA=${soA.length} soB=${soB.length}`)
}

// snapshot por dispositivo
console.log('\n=== SNAPSHOT (rep_usuarios_dispositivo) ===')
const snapPorDisp = {}
for (const d of disp) {
  const s = await q(`rep_usuarios_dispositivo?select=identificador_afd,servidor_id,tem_biometria&dispositivo_id=eq.${d.id}`)
  snapPorDisp[d.id] = s
  console.log(`${d.nome}: ${s.length} cadastros | com digital ${s.filter(x=>x.tem_biometria).length} | resolvidos a servidor ${s.filter(x=>x.servidor_id).length}`)
}

// comparacao de cadastros por identificador
console.log('\n=== CADASTROS: quem esta em um e nao no outro (por identificador_afd) ===')
for (let i=0;i<disp.length;i++) for (let j=i+1;j<disp.length;j++){
  const a=new Set(snapPorDisp[disp[i].id].map(x=>x.identificador_afd))
  const b=new Set(snapPorDisp[disp[j].id].map(x=>x.identificador_afd))
  const soA=[...a].filter(x=>!b.has(x)).length, soB=[...b].filter(x=>!a.has(x)).length
  console.log(`${nomes[disp[i].id]} x ${nomes[disp[j].id]}: comum=${[...a].filter(x=>b.has(x)).length} so_no_1=${soA} so_no_2=${soB}`)
}

// qual setor extra do HMM-04
const d04 = disp.find(d=>d.nome.includes('HMM-04')), d01 = disp.find(d=>d.nome.includes('HMM-01'))
const extra = [...setoresPorDisp[d04.id]].filter(x=>!setoresPorDisp[d01.id].has(x))
if (extra.length) {
  const s = await q(`setores?select=id,ativo,dicionario_setores(nome),parent_id&id=in.(${extra.join(',')})`)
  console.log('\n=== SETOR EXTRA NO HMM-04 ===')
  for (const x of s) console.log(x.id, x.dicionario_setores?.nome, 'ativo=', x.ativo, 'parent=', x.parent_id)
}
