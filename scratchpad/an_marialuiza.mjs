import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const rpc=async(n,b)=>{const r=await fetch(`${U}/rest/v1/rpc/${n}`,{method:'POST',headers:H,body:JSON.stringify(b)});return r.ok?await r.json():{erro:r.status}}
const q=async p=>(await fetch(`${U}/rest/v1/${p}`,{headers:H})).json()
const L=iso=>iso?new Date(new Date(iso).getTime()-3*3600e3).toISOString().slice(5,16).replace('T',' '):null

const s=(await q('servidores?select=id,nome,matricula&matricula=eq.7617'))[0]
console.log('servidor:',s.nome, s.matricula)
const ems=await q(`escala_mensal?select=id&servidor_id=eq.${s.id}&mes=eq.9&ano=eq.2026`)
for(const em of ems){
  const eds=await q(`escala_diaria?select=id,dia,categoria,presenca_entrada_em,presenca_saida_em,presenca_entrada_marcacao_id,presenca_saida_marcacao_id,dicionario_turnos(codigo)&escala_mensal_id=eq.${em.id}&dia=eq.14`)
  eds.forEach(d=>console.log(`  linha ${d.categoria} ${d.dicionario_turnos?.codigo}: entrada=${L(d.presenca_entrada_em)} saida=${L(d.presenca_saida_em)}`))
}
console.log('\nbatidas 13-16/09:')
const mp=await q(`marcacoes_ponto?select=id,ocorrido_em,origem&servidor_id=eq.${s.id}&ocorrido_em=gte.2026-09-13T00:00:00-03:00&ocorrido_em=lt.2026-09-16T00:00:00-03:00&order=ocorrido_em`)
mp.forEach(m=>console.log(`  ${L(m.ocorrido_em)}  ${m.origem}  ${m.id}`))
console.log('\nblocos previstos 14/09:')
const b=await rpc('fn_blocos_previstos_dia',{p_servidor_id:s.id,p_data:'2026-09-14'})
;(b||[]).forEach(x=>console.log(`  ${x.codigo||'?'}  ${L(x.inicio_previsto)} -> ${L(x.fim_previsto)}  linhas=${(x.escala_diaria_ids||[]).length}`))
console.log('\nprojecao 14/09:')
const pj=await rpc('fn_projecao_marcacoes_dia',{p_servidor_id:s.id,p_data:'2026-09-14'})
;(pj||[]).forEach(x=>console.log(`  ${x.escala_diaria_id}: entrada=${L(x.entrada_em)} saida=${L(x.saida_em)}`))
