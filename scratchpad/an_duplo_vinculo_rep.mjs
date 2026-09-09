// SOMENTE LEITURA. Mede a situacao real do duplo vinculo em relacao ao relogio de ponto.
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function q(p){ const out=[]; for(let f=0;;f+=1000){
  const r = await fetch(`${U}/rest/v1/${p}`,{headers:{...H, Range:`${f}-${f+999}`}})
  if(!r.ok){ console.error('ERRO',p.slice(0,80),r.status,(await r.text()).slice(0,300)); process.exit(1) }
  const pg = await r.json(); out.push(...pg); if(pg.length<1000) break } return out }
const dig = s => (s||'').replace(/\D/g,'')

const servs = await q('servidores?select=id,nome,matricula,cpf,pis_pasep,status,unidade_id,setor_id,vinculo_multiplo_confirmado,mesclado_em_servidor_id')
const unids = Object.fromEntries((await q('unidades?select=id,nome')).map(u=>[u.id,u.nome]))
const disp  = await q('dispositivos_rep?select=id,nome,unidade_id,ativo,ponto_valido_desde')
const dispPorUnid = {}
for (const d of disp.filter(d=>d.ativo)) (dispPorUnid[d.unidade_id] ||= []).push(d)

const ativos = servs.filter(s => s.status==='Ativo' && !s.mesclado_em_servidor_id)
console.log(`servidores: ${servs.length} | Ativos nao-mesclados: ${ativos.length}`)
console.log(`unidades com relogio ativo: ${Object.keys(dispPorUnid).length} | relogios ativos: ${disp.filter(d=>d.ativo).length}`)

const porCpf = new Map()
for (const s of ativos) { const c = dig(s.cpf); if (c.length>=11) { const k=c.slice(-11); (porCpf.get(k)||porCpf.set(k,[]).get(k)).push(s) } }
const dups = [...porCpf.entries()].filter(([,v]) => v.length>1)
console.log(`\n=== CPFs com 2+ cadastros ATIVOS: ${dups.length} (total de ${dups.reduce((a,[,v])=>a+v.length,0)} cadastros) ===`)

let mesmaUnid=0, unidDif=0, comRelogioAmbos=0, comRelogioUm=0, semRelogio=0, pisIguais=0, pisDifs=0, pisFaltando=0
const linhas=[]
for (const [cpf, v] of dups) {
  const us = [...new Set(v.map(s=>s.unidade_id))]
  const mesma = us.length===1
  mesma ? mesmaUnid++ : unidDif++
  const comRel = v.filter(s => (dispPorUnid[s.unidade_id]||[]).length>0)
  if (comRel.length===v.length) comRelogioAmbos++; else if (comRel.length>0) comRelogioUm++; else semRelogio++
  const pis = v.map(s=>dig(s.pis_pasep)).filter(p=>p.length>=11)
  if (pis.length<v.length) pisFaltando++
  else if (new Set(pis).size===1) pisIguais++
  else pisDifs++
  linhas.push({cpf, nome:v[0].nome, mats:v.map(s=>s.matricula), unids:v.map(s=>unids[s.unidade_id]||'(sem unidade)'),
    mesma, relogios: v.map(s=>(dispPorUnid[s.unidade_id]||[]).map(d=>d.nome).join('+')||'-'),
    pis: v.map(s=>dig(s.pis_pasep)||'-'), ids: v.map(s=>s.id),
    conf: v.map(s=>s.vinculo_multiplo_confirmado)})
}
console.log(`  mesma unidade nos dois: ${mesmaUnid} | unidades diferentes: ${unidDif}`)
console.log(`  os dois em unidade COM relogio: ${comRelogioAmbos} | so um: ${comRelogioUm} | nenhum: ${semRelogio}`)
console.log(`  PIS iguais nos dois: ${pisIguais} | PIS diferentes: ${pisDifs} | falta PIS em algum: ${pisFaltando}`)

console.log(`\n=== DETALHE ===`)
for (const l of linhas) {
  console.log(`\n${l.nome}  cpf ${l.cpf}`)
  for (let i=0;i<l.mats.length;i++)
    console.log(`   mat ${String(l.mats[i]).padEnd(9)} | ${String(l.unids[i]).slice(0,34).padEnd(34)} | relogio: ${String(l.relogios[i]).slice(0,40).padEnd(40)} | pis ${l.pis[i]} | conf=${l.conf[i]}`)
}
fs.writeFileSync('scratchpad/_dup_ids.json', JSON.stringify(linhas,null,1))
