import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function cnt(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Prefer:'count=exact',Range:'0-0'}});return Number((r.headers.get('content-range')||'/0').split('/')[1])}
const casos=[
  ['/relatorios/rh (previsao)      ','escala_mensal?select=id'],
  ['/relatorios/rh (fechadas)      ','escala_mensal?select=id&status=eq.Fechada'],
  ['/relatorios/consolidado 09/2026','escala_mensal?select=id&mes=eq.9&ano=eq.2026'],
  ['/relatorios/consolidado 08/2026','escala_mensal?select=id&mes=eq.8&ano=eq.2026'],
  ['/relatorios/plantao-sob 2026   ','escala_mensal?select=id&ano=eq.2026'],
  ['/relatorios/distribuicao 09/26 ','escala_diaria?select=id,escala_mensal!inner(mes,ano)&categoria=eq.Plant%C3%A3o&escala_mensal.mes=eq.9&escala_mensal.ano=eq.2026'],
  ['/relatorios/distribuicao 08/26 ','escala_diaria?select=id,escala_mensal!inner(mes,ano)&categoria=eq.Plant%C3%A3o&escala_mensal.mes=eq.8&escala_mensal.ano=eq.2026'],
]
console.log('tela                             linhas reais   o relatorio ve   perda')
for(const [n,p] of casos){
  const t=await cnt(p); const v=Math.min(t,1000)
  console.log(`${n} ${String(t).padStart(9)} ${String(v).padStart(15)} ${t>1000?String(`${t-v} (${((1-v/t)*100).toFixed(0)}%)`).padStart(14):'—'.padStart(14)}`)
}
