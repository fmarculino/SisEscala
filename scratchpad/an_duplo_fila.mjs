import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function q(p){ const out=[]; for(let f=0;;f+=1000){
  const r = await fetch(`${U}/rest/v1/${p}`,{headers:{...H, Range:`${f}-${f+999}`}})
  if(!r.ok){ console.error('ERRO',p.slice(0,90),r.status,(await r.text()).slice(0,300)); process.exit(1) }
  const pg = await r.json(); out.push(...pg); if(pg.length<1000) break } return out }
const grupos = JSON.parse(fs.readFileSync('scratchpad/_dup_ids.json','utf8'))
const disp  = Object.fromEntries((await q('dispositivos_rep?select=id,nome')).map(d=>[d.id,d.nome]))
const ids = grupos.flatMap(g=>g.ids).join(',')
const fila = await q(`rep_cadastros_fila?select=dispositivo_id,servidor_id,device_user_id,status,erro,processado_em&servidor_id=in.(${ids})&order=processado_em.desc`)
const nome = {}; for(const g of grupos) g.ids.forEach((id,i)=>nome[id]=`${g.nome.trim()} mat ${g.mats[i]}`)

console.log(`=== FILA DE CADASTRO desses ${grupos.length*2} cadastros: ${fila.length} linhas ===`)
const porStatus = {}; for(const f of fila) porStatus[f.status]=(porStatus[f.status]||0)+1
console.log(porStatus)
console.log(`\n=== ERROS DISTINTOS ===`)
const errs = {}; for(const f of fila.filter(f=>f.erro)) errs[f.erro]=(errs[f.erro]||0)+1
for(const [e,n] of Object.entries(errs).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(4)}x  ${e}`)
console.log(`\n=== FALHAS por pessoa (amostra) ===`)
const vis = new Set()
for(const f of fila.filter(f=>f.status==='falhou')){
  const k = `${f.servidor_id}|${f.dispositivo_id}`
  if(vis.has(k)) continue; vis.add(k)
  console.log(`  ${String(nome[f.servidor_id]||f.servidor_id).padEnd(52)} ${String(disp[f.dispositivo_id]).padEnd(24)} dev_user=${f.device_user_id} :: ${f.erro}`)
}
