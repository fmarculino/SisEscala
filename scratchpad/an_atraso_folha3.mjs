import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p,pag=1000){const o=[];for(let f=0;;f+=pag){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+pag-1}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,300));break}const g=await r.json();o.push(...g);if(g.length<pag)break}return o}
const RE=/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i
const jo=await qAll('jornadas?select=id,nome,horas_totais,intervalo_minutos')
const J=new Map(jo.map(j=>[j.id,j]))
console.log('=== TODAS AS JORNADAS E O QUE O REGEX EXTRAI ===')
for(const j of jo.sort((a,b)=>a.nome.localeCompare(b.nome))){
  const m=j.nome.match(RE)
  console.log(`  ${j.nome.padEnd(20)} h_totais=${String(j.horas_totais).padStart(4)} int=${String(j.intervalo_minutos).padStart(3)} -> ${m?`${m[1]}:${m[2]||'00'} as ${m[3]}:${m[4]||'00'}`:'*** NAO PARSEIA (vira 08:00-17:00) ***'}`)
}
const em=await qAll('escala_mensal?select=id,servidor_id,jornada_id,mes,ano,ativo&ano=eq.2026')
const at=em.filter(e=>e.ativo!==false)
console.log('\n=== ESCALAS ATIVAS COM JORNADA NAO-PARSEAVEL, POR COMPETENCIA ===')
const porMes=new Map()
at.forEach(e=>{const n=J.get(e.jornada_id)?.nome||'';if(n.match(RE))return;const k=`${String(e.mes).padStart(2,'0')}/${e.ano}`;const a=porMes.get(k)||{n:0,nomes:new Set(),sv:new Set()};a.n++;a.nomes.add(n);a.sv.add(e.servidor_id);porMes.set(k,a)})
;[...porMes.entries()].sort().forEach(([k,v])=>console.log(`  ${k}: ${v.n} escalas, ${v.sv.size} servidores, jornadas: ${[...v.nomes].join(' / ')}`))
const fp9=await qAll('folha_ponto?select=id,mes,ano,status&ano=eq.2026&mes=eq.9')
console.log(`\nfolhas ja geradas para 09/2026: ${fp9.length}`)
const fpAll=await qAll('folha_ponto?select=mes,ano,status&ano=eq.2026')
const c=new Map(); fpAll.forEach(f=>{const k=`${String(f.mes).padStart(2,'0')}/${f.ano} ${f.status}`;c.set(k,(c.get(k)||0)+1)})
console.log('folhas por competencia/status: '+[...c.entries()].sort().map(([k,v])=>`${k}=${v}`).join(' | '))
