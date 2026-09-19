import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function pag(p) { const o=[]; for(let f=0;;f+=1000){ const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}}); if(!r.ok) throw new Error(r.status+await r.text()); const x=await r.json(); o.push(...x); if(x.length<1000) break } return o }
const disp = Object.fromEntries((await pag('dispositivos_rep?select=id,nome')).map(d=>[d.id,d.nome]))

const s = await pag('rep_sincronizacoes?select=id,dispositivo_id,iniciada_em,linhas_recebidas,marcacoes_criadas,marcacoes_orfas,status&linhas_recebidas=gte.400&order=iniciada_em.desc')
console.log(`sincronizacoes com >=400 linhas: ${s.length}`)
const comDono = s.filter(x => (x.marcacoes_criadas||0) - (x.marcacoes_orfas||0) > 0)
console.log(`  com marcacao COM DONO: ${comDono.length}`)
console.log(`  somente orfas/zero:    ${s.length - comDono.length}`)
console.log('\n  top 15 por "com dono":')
for (const x of comDono.sort((a,b)=>(b.marcacoes_criadas-b.marcacoes_orfas)-(a.marcacoes_criadas-a.marcacoes_orfas)).slice(0,15))
  console.log(`   ${x.iniciada_em.slice(0,19)} ${String(disp[x.dispositivo_id]||'').padEnd(28)} linhas=${x.linhas_recebidas} criadas=${x.marcacoes_criadas} orfas=${x.marcacoes_orfas} comDono=${x.marcacoes_criadas-x.marcacoes_orfas}`)
