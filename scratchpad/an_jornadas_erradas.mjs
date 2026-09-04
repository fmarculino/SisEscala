// 04/09/2026 — SOMENTE LEITURA. Alcance das 3 jornadas com horas_totais divergente do vao.
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p,pag=1000){const o=[];for(let f=0;;f+=pag){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+pag-1}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,200));break}const g=await r.json();o.push(...g);if(g.length<pag)break}return o}
const jo=await qAll('jornadas?select=id,nome,horas_totais,intervalo_minutos')
const alvo=['08H ÀS 17H','09H ÀS 18H','10H ÀS 19H']
const J=jo.filter(j=>alvo.includes(j.nome))
console.log('=== AS TRES ===')
J.forEach(j=>{
  const m=j.nome.match(/(\d{1,2})H\s*\S+\s*(\d{1,2})H/)
  let vao=+m[2]-+m[1]; if(vao<=0)vao+=24
  console.log(`  ${j.nome}: horas_totais=${j.horas_totais} intervalo=${j.intervalo_minutos}min | vao=${vao}h | trabalho pelo vao-intervalo=${vao-(j.intervalo_minutos||0)/60}h`)
})
const ids=new Set(J.map(j=>j.id))
const em=await qAll('escala_mensal?select=id,servidor_id,jornada_id,mes,ano,ativo,status')
const usa=em.filter(e=>e.ativo!==false&&ids.has(e.jornada_id))
console.log(`\n=== ESCALAS ATIVAS QUE USAM (todas as competencias) ===`)
const porComp=new Map()
usa.forEach(e=>{const k=`${String(e.mes).padStart(2,'0')}/${e.ano}`;const a=porComp.get(k)||{n:0,sv:new Set(),jor:new Set()};a.n++;a.sv.add(e.servidor_id);a.jor.add(jo.find(j=>j.id===e.jornada_id).nome);porComp.set(k,a)})
if(porComp.size===0) console.log('  NENHUMA escala ativa usa essas jornadas')
;[...porComp.entries()].sort().forEach(([k,v])=>console.log(`  ${k}: ${v.n} escalas, ${v.sv.size} servidores | ${[...v.jor].join(', ')}`))
console.log(`\n=== SERVIDORES COM ESSA JORNADA NO CADASTRO (fora da escala) ===`)
const tj=await qAll('servidores_jornadas_temporarias?select=servidor_id,jornada_id,data_inicio,data_fim')
console.log(`  jornadas temporarias apontando para elas: ${tj.filter(t=>ids.has(t.jornada_id)).length}`)
console.log(`\n=== FOLHAS QUE JA GRAVARAM ESSE NOME NO REGISTRO ===`)
const fp=await qAll('folha_ponto?select=mes,ano,status,registros&ano=eq.2026',200)
const cont=new Map()
for(const f of fp){for(const r of (Array.isArray(f.registros)?f.registros:[])){if(alvo.includes(r.jornada_nome)){const k=`${String(f.mes).padStart(2,'0')}/${f.ano} ${f.status}`;cont.set(k,(cont.get(k)||0)+1)}}}
if(cont.size===0) console.log('  nenhuma folha de 2026 tem dia com essas jornadas')
;[...cont.entries()].sort().forEach(([k,v])=>console.log(`  ${k}: ${v} dias`))
