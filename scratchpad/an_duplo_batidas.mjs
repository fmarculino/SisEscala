// SOMENTE LEITURA. O que acontece HOJE com a batida de quem tem duplo vinculo.
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
const dig = s => (s||'').replace(/\D/g,'')
const grupos = JSON.parse(fs.readFileSync('scratchpad/_dup_ids.json','utf8'))

const unids = Object.fromEntries((await q('unidades?select=id,nome')).map(u=>[u.id,u.nome]))
const disp  = Object.fromEntries((await q('dispositivos_rep?select=id,nome,unidade_id,ativo')).map(d=>[d.id,d]))
const todosIds = grupos.flatMap(g=>g.ids)
const ids = todosIds.join(',')

// snapshot de cadastro no relogio
const snap = await q(`rep_usuarios_dispositivo?select=dispositivo_id,servidor_id,identificador_afd,tem_biometria&servidor_id=in.(${ids})`)
// vinculos vigentes
const vinc = await q(`rep_vinculos_servidor?select=dispositivo_id,servidor_id,identificador_afd,vigente_de,vigente_ate,tem_biometria&servidor_id=in.(${ids})`)
// marcacoes rep dos ultimos 60 dias
const desde = new Date(Date.now()-60*864e5).toISOString().slice(0,10)
const marc = await q(`marcacoes_ponto?select=servidor_id,dispositivo_id,ocorrido_em,origem&origem=eq.rep&ocorrido_em=gte.${desde}&servidor_id=in.(${ids})`)
// escalas 09/2026
const esc = await q(`escala_mensal?select=servidor_id,unidade_id,mes,ano&mes=eq.9&ano=eq.2026&servidor_id=in.(${ids})`)

const nSnap=new Map(), nVinc=new Map(), nMarc=new Map(), nEsc=new Map()
for(const s of snap){ (nSnap.get(s.servidor_id)||nSnap.set(s.servidor_id,[]).get(s.servidor_id)).push(s) }
for(const v of vinc.filter(v=>!v.vigente_ate)){ (nVinc.get(v.servidor_id)||nVinc.set(v.servidor_id,[]).get(v.servidor_id)).push(v) }
for(const m of marc){ nMarc.set(m.servidor_id,(nMarc.get(m.servidor_id)||0)+1) }
for(const e of esc){ (nEsc.get(e.servidor_id)||nEsc.set(e.servidor_id,[]).get(e.servidor_id)).push(e) }

console.log('=== ESTADO DE CADA GRUPO (60 dias, escala 09/2026) ===')
let ambosEscala=0, ambosBatendo=0, soUmBatendo=0, nenhumBatendo=0, ambosCadastrados=0
for(const g of grupos){
  const mesma = g.mesma
  const linhas = g.ids.map((id,i)=>({
    id, mat:g.mats[i], unid:g.unids[i],
    cad: (nSnap.get(id)||[]).length, bio:(nSnap.get(id)||[]).filter(s=>s.tem_biometria).length,
    vin: (nVinc.get(id)||[]).length, mar: nMarc.get(id)||0, esc:(nEsc.get(id)||[]).length,
    idents: [...new Set((nSnap.get(id)||[]).map(s=>s.identificador_afd))]
  }))
  const comEsc = linhas.filter(l=>l.esc>0).length
  const comMar = linhas.filter(l=>l.mar>0).length
  const comCad = linhas.filter(l=>l.cad>0).length
  if(comEsc===linhas.length) ambosEscala++
  if(comMar===linhas.length) ambosBatendo++; else if(comMar===1) soUmBatendo++; else nenhumBatendo++
  if(comCad===linhas.length) ambosCadastrados++
  console.log(`\n${g.nome.trim()} ${mesma?'[MESMA UNIDADE]':'[unidades diferentes]'}`)
  for(const l of linhas)
    console.log(`   mat ${String(l.mat).padEnd(9)} ${String(l.unid).slice(0,20).padEnd(20)} cadastros_no_relogio=${l.cad} (com_bio=${l.bio}) vinculos=${l.vin} batidas60d=${l.mar} escalas09=${l.esc} ident=${l.idents.join('/')||'-'}`)
}
console.log(`\n=== RESUMO ===`)
console.log(`grupos: ${grupos.length}`)
console.log(`  as duas matriculas com escala em 09/2026: ${ambosEscala}`)
console.log(`  as duas com batida nos ultimos 60d: ${ambosBatendo} | so uma: ${soUmBatendo} | nenhuma: ${nenhumBatendo}`)
console.log(`  as duas com algum cadastro em relogio: ${ambosCadastrados}`)
