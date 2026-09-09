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
const grupos = JSON.parse(fs.readFileSync('scratchpad/_dup_ids.json','utf8')).filter(g=>g.mesma)
const ids = grupos.flatMap(g=>g.ids)
const em = await q(`escala_mensal?select=id,servidor_id,mes,ano,status&servidor_id=in.(${ids.join(',')})&ano=eq.2026&mes=in.(8,9)`)
const fp = em.length? await q(`folha_ponto?select=escala_mensal_id,status&escala_mensal_id=in.(${em.map(e=>e.id).join(',')})`):[]
const cnt=(arr,k)=>arr.reduce((a,x)=>(a[x[k]]=(a[x[k]]||0)+1,a),{})
console.log('escala_mensal (08 e 09/2026) dos 10 grupos, por competencia e status:')
for(const mes of [8,9]){
  const e = em.filter(x=>x.mes===mes)
  console.log(`  ${String(mes).padStart(2,'0')}/2026: ${e.length} escalas ->`, cnt(e,'status'))
  const f = fp.filter(x=>e.some(y=>y.id===x.escala_mensal_id))
  console.log(`            ${f.length} folhas ->`, cnt(f,'status'))
}
const cg = await q('configuracoes_globais?select=chave,valor&chave=like.*competencia*')
console.log('\ncompetencias encerradas:', JSON.stringify(cg).slice(0,300))
