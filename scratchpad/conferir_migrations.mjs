import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});const t=await r.text();if(!r.ok){console.error(r.status,t.slice(0,200));return[]}return JSON.parse(t)}

console.log('--- 20260826230000: chaves de politica ---')
console.log(JSON.stringify(await q(`configuracoes_globais?select=chave,valor&chave=like.coletor_auto_update*`)))

console.log('\n--- 20260826210000: efeitos (ja estavam la) ---')
const pse=await q(`escala_diaria?select=id&escala_mensal_id=eq.8c3cc05f-b5c2-4ed6-9b8c-0ba5b58acfb2`)
const fagPat=await q(`escala_diaria?select=dia&escala_mensal_id=eq.1b1863df-65be-4270-af82-068f89c6e0a6&order=dia.asc`)
const fagTra=await q(`escala_diaria?select=dia&escala_mensal_id=eq.7114182d-be8d-491f-a7d6-609fd99e4ec4&order=dia.asc`)
console.log('CLEONEIDE/PSE linhas =', pse.length, '(esperado 0)')
console.log('FAGNER PATRIMONIO =', fagPat.map(r=>r.dia).join(','), '| TRANSPORTE =', fagTra.map(r=>r.dia).join(','))

console.log('\n--- alvo do teste do trigger: ERIKA, dobra adjacente em 09/2026 ---')
const ems=await q(`escala_mensal?select=id,setor_id,setores(dicionario_setores(nome))&servidor_id=eq.53609&mes=eq.9&ano=eq.2026`)
const erika=await q(`servidores?select=id,nome&matricula=eq.53609`)
if(erika.length){
  const e=await q(`escala_mensal?select=id,setores(dicionario_setores(nome))&servidor_id=eq.${erika[0].id}&mes=eq.9&ano=eq.2026`)
  for(const x of e){
    const d=await q(`escala_diaria?select=id,dia,categoria,dicionario_turnos(codigo,slots)&escala_mensal_id=eq.${x.id}&dia=eq.2`)
    d.forEach(r=>console.log(` ${x.setores?.dicionario_setores?.nome} | dia ${r.dia} ${r.categoria} ${r.dicionario_turnos?.codigo} slots=${JSON.stringify(r.dicionario_turnos?.slots)} | id=${r.id}`))
  }
}
