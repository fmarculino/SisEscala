import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const j=async u=>(await fetch(u,{headers:H})).json()
for(const [m,a] of [[8,2026],[9,2026]]){
  // exatamente o que autoGenerateMissingTimesheets faz hoje (sem paginar)
  const scales=await j(`${U}/rest/v1/escala_mensal?select=id&mes=eq.${m}&ano=eq.${a}&ativo=eq.true`)
  const sheets=await j(`${U}/rest/v1/folha_ponto?select=escala_mensal_id,status&mes=eq.${m}&ano=eq.${a}`)
  const mapa=new Set(sheets.map(s=>s.escala_mensal_id))
  const faltando=scales.filter(s=>!mapa.has(s.id))
  // dessas, quantas JA TEM folha de verdade (seria sobrescrita como Rascunho)?
  const todas=[];for(let f=0;;f+=1000){const g=await j(`${U}/rest/v1/folha_ponto?select=escala_mensal_id,status&mes=eq.${m}&ano=eq.${a}&order=id.asc&limit=1000&offset=${f}`);todas.push(...g);if(g.length<1000)break}
  const real=new Map(todas.map(s=>[s.escala_mensal_id,s.status]))
  const vitimas=faltando.filter(s=>real.has(s.id))
  const porStatus={};for(const v of vitimas){const st=real.get(v.id);porStatus[st]=(porStatus[st]||0)+1}
  console.log(`${m}/${a}: escalas vistas ${scales.length} | folhas vistas ${sheets.length} (reais ${todas.length})`)
  console.log(`   "faltando folha" segundo o codigo atual: ${faltando.length}`)
  console.log(`   DESSAS, ja tem folha e seriam REBAIXADAS a Rascunho: ${vitimas.length}`, JSON.stringify(porStatus))
}
