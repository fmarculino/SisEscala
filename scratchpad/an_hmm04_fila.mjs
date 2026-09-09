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
const disp = (await q(`dispositivos_rep?select=id,nome&unidade_id=eq.${uni.id}&order=nome`)).filter(d=>d.nome.includes('HMM-'))

console.log('=== FILA DE CADASTRO (rep_cadastros_fila) por dispositivo ===')
for (const d of disp) {
  const f = await q(`rep_cadastros_fila?select=status,erro,processado_em,created_at,servidor_id&dispositivo_id=eq.${d.id}`)
  const por = {}
  for (const x of f) por[x.status] = (por[x.status]||0)+1
  console.log(`\n${d.nome}: ${f.length} linhas`, JSON.stringify(por))
  const erros = {}
  for (const x of f.filter(x=>x.status==='falhou')) { const e=(x.erro||'').slice(0,90); erros[e]=(erros[e]||0)+1 }
  for (const [e,n] of Object.entries(erros).sort((a,b)=>b[1]-a[1]).slice(0,8)) console.log(`   falhou x${n}: ${e}`)
  const pend = f.filter(x=>x.status==='pendente')
  if (pend.length) console.log(`   pendente mais antigo: ${pend.map(x=>x.created_at).sort()[0]}`)
  const env2 = f.filter(x=>x.status==='enviado').map(x=>x.processado_em).filter(Boolean).sort()
  if (env2.length) console.log(`   enviados: primeiro ${env2[0]} ultimo ${env2[env2.length-1]}`)
}

console.log('\n=== COPIAS DE BIOMETRIA (rep_biometria_copias) ultimas 72h ===')
const desde = new Date(Date.now()-72*3600e3).toISOString()
const cop = await q(`rep_biometria_copias?select=origem_id,destino_id,status,erro,created_at&created_at=gte.${desde}`)
const nomes = Object.fromEntries((await q(`dispositivos_rep?select=id,nome`)).map(d=>[d.id,d.nome]))
const agg = {}
for (const c of cop) { const k=`${nomes[c.origem_id]} -> ${nomes[c.destino_id]} [${c.status}]`; agg[k]=(agg[k]||0)+1 }
for (const [k,n] of Object.entries(agg).sort((a,b)=>b[1]-a[1])) console.log(`${n.toString().padStart(4)} ${k}`)
const falhas = cop.filter(c=>c.status==='falhou')
const fe={}; for(const c of falhas){ const e=(c.erro||'').slice(0,110); fe[e]=(fe[e]||0)+1 }
for (const [e,n] of Object.entries(fe).sort((a,b)=>b[1]-a[1]).slice(0,10)) console.log(`   falha x${n}: ${e}`)
