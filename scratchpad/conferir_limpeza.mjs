import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function all(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error(r.status,(await r.text()).slice(0,200));break}const g=await r.json();o.push(...g);if(g.length<1000)break}return o}

// 1) nenhum par cross-setor com slots sobrepostos
const ems=await all(`escala_mensal?select=id,servidor_id,mes,ano,setor_id,servidores(nome,matricula),setores(dicionario_setores(nome))`)
const byId=Object.fromEntries(ems.map(e=>[e.id,e]))
const eds=(await all(`escala_diaria?select=escala_mensal_id,dia,categoria,dicionario_turnos(codigo,slots)`)).filter(r=>byId[r.escala_mensal_id])
const map=new Map()
for(const ed of eds){const em=byId[ed.escala_mensal_id];const k=`${em.servidor_id}|${em.mes}/${em.ano}|${ed.dia}`;(map.get(k)||map.set(k,[]).get(k)).push({ed,em})}
let sobre=0
for(const [,rows] of map) for(let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++){
  const a=rows[i],b=rows[j]; if(a.em.id===b.em.id) continue
  const sa=a.ed.dicionario_turnos?.slots||[],sb=b.ed.dicionario_turnos?.slots||[]
  if(sa.some(s=>sb.includes(s))){sobre++;console.log('  AINDA SOBREPOSTO:',a.em.servidores?.nome,a.em.mes+'/'+a.em.ano,'dia',a.ed.dia)}
}
console.log(`1) pares cross-setor com slots sobrepostos: ${sobre}  (esperado 0)`)

// 2) FAGNER
const f=(await all(`escala_diaria?select=dia,dicionario_turnos(codigo),presenca_entrada_em,presenca_saida_em,presenca_entrada_origem,presenca_saida_origem,escala_mensal_id&escala_mensal_id=in.(7114182d-be8d-491f-a7d6-609fd99e4ec4,1b1863df-65be-4270-af82-068f89c6e0a6)&order=dia.asc`))
const nome=id=>id==='1b1863df-65be-4270-af82-068f89c6e0a6'?'PATRIMONIO':'TRANSPORTE'
console.log('\n2) FAGNER 08/2026:')
for(const s of ['PATRIMONIO','TRANSPORTE']) console.log(`   ${s.padEnd(11)}`, f.filter(r=>nome(r.escala_mensal_id)===s).map(r=>r.dia).join(','))
console.log('   dias 3-7 (PATRIMONIO) apos reconciliacao:')
f.filter(r=>nome(r.escala_mensal_id)==='PATRIMONIO').forEach(r=>console.log(`     dia ${r.dia} ${r.dicionario_turnos?.codigo}  ent=${String(r.presenca_entrada_em).slice(11,19)}(${r.presenca_entrada_origem||'-'})  sai=${String(r.presenca_saida_em).slice(11,19)}(${r.presenca_saida_origem||'-'})`))

// 3) CLEONEIDE PSE vazio
const pse=await all(`escala_diaria?select=id&escala_mensal_id=eq.8c3cc05f-b5c2-4ed6-9b8c-0ba5b58acfb2`)
const esus=await all(`escala_diaria?select=dia&escala_mensal_id=eq.54e3702b-d4cf-45b3-8965-7ba10cc1fef9&order=dia.asc`)
console.log(`\n3) CLEONEIDE: linhas no PSE = ${pse.length} (esperado 0) | no E-SUS = ${esus.length} dias`)

// 4) nenhuma batida real desconsiderada
const tr=await all(`marcacoes_tratamentos?select=marcacao_id,marcacoes_ponto(sintetica,origem)&justificativa=like.*20260826210000*`)
const reais=tr.filter(t=>t.marcacoes_ponto?.sintetica!==true||t.marcacoes_ponto?.origem!=='ajuste_coordenador')
console.log(`4) tratamentos criados = ${tr.length} | sobre batida REAL = ${reais.length} (esperado 0)`)
