import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERR',r.status,(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
async function count(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Prefer:'count=exact',Range:'0-0'}});return r.headers.get('content-range')}

for(const [m,a] of [[9,2026],[8,2026],[7,2026]]){
  console.log(`\n=== folha_ponto ${m}/${a} ===`)
  console.log(' count exato:', await count(`folha_ponto?select=id&mes=eq.${m}&ano=eq.${a}`))
  // simula EXATAMENTE o que a action faz (sem Range, sem paginacao)
  const r=await fetch(`${U}/rest/v1/folha_ponto?select=id,status,servidor_id,escala_mensal_id&mes=eq.${m}&ano=eq.${a}`,{headers:H})
  const semPag=await r.json()
  console.log(' sem paginacao (como a action):', semPag.length)
  console.log(` escala_mensal ${m}/${a} ativas:`, await count(`escala_mensal?select=id&mes=eq.${m}&ano=eq.${a}&ativo=eq.true`))
}

// O caso relatado
const srv=await q('servidores?select=id,nome,matricula,unidade_id,setor_id&matricula=eq.40002')
console.log('\n=== ALDENIR (mat 40002) ===',JSON.stringify(srv))
for(const s of srv){
  const esc=await q(`escala_mensal?select=id,mes,ano,status,ativo,unidade_id,setor_id&servidor_id=eq.${s.id}&mes=eq.9&ano=eq.2026`)
  console.log(' escalas 09/2026:',JSON.stringify(esc))
  const fp=await q(`folha_ponto?select=id,status,mes,ano,escala_mensal_id,gerado_em,total_horas_normais&servidor_id=eq.${s.id}`)
  console.log(' folhas:',JSON.stringify(fp))
}
