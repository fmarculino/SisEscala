import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p,pag=1000){const o=[];for(let f=0;;f+=pag){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+pag-1}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,300));break}const g=await r.json();o.push(...g);if(g.length<pag)break}return o}
const RE=/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i
const min=h=>{if(!h||!/^\d{1,2}:\d{2}/.test(h))return null;const[a,b]=h.split(':');return +a*60+ +b}
const hm=m=>`${Math.floor(m/60)}:${String(Math.round(m%60)).padStart(2,'0')}`
const jo=await qAll('jornadas?select=id,nome'); const J=new Map(jo.map(j=>[j.id,j]))
const em=await qAll('escala_mensal?select=id,servidor_id,jornada_id,mes,ano,ativo&ano=eq.2026&mes=eq.8')
const semJor=em.filter(e=>e.ativo!==false&&!e.jornada_id)
console.log(`08/2026: escalas ativas ${em.filter(e=>e.ativo!==false).length} | SEM jornada_id: ${semJor.length}`)
const setSem=new Set(semJor.map(e=>e.servidor_id))
const fp=await qAll('folha_ponto?select=id,servidor_id,registros&mes=eq.8&ano=eq.2026',200)
let semJorComFolha=0, semJorDiasTrab=0, semJorNomeVazio=0
for(const f of fp.filter(x=>setSem.has(x.servidor_id))){
  semJorComFolha++
  for(const r of (Array.isArray(f.registros)?f.registros:[])){
    if(!r.turno_codigo||r.afastamento||r.feriado) continue
    semJorDiasTrab++; if(!r.jornada_nome) semJorNomeVazio++
  }
}
console.log(`   destes, com folha gerada: ${semJorComFolha} | dias de trabalho na folha: ${semJorDiasTrab} | sem jornada_nome no registro: ${semJorNomeVazio}`)

console.log('\n=== COMPLETUDE DO DIA (Art.7 §5: sem registro completo nao compensa) — 08/2026 ===')
let tot=0,quatro=0,doisSo=0,parcial=0, atrasoReal=0, atrasoManual=0, atrasoTot=0
for(const f of fp){
  for(const r of (Array.isArray(f.registros)?f.registros:[])){
    if(!r.turno_codigo||r.afastamento||r.feriado) continue
    tot++
    const n=[r.entrada,r.saida_intervalo,r.retorno_intervalo,r.saida].filter(Boolean).length
    if(n===4)quatro++; else if(n===2&&r.entrada&&r.saida)doisSo++; else parcial++
    const p=(r.jornada_nome||'').match(RE); if(!p) continue
    const e=min(r.entrada); if(e===null) continue
    const pe=(+p[1])*60+(p[2]?+p[2]:0)
    if(e-pe>5){atrasoTot++; if(r.origem_entrada==='real')atrasoReal++; else atrasoManual++}
  }
}
console.log(`dias de trabalho: ${tot} | com os 4 registros: ${quatro} | so entrada+saida: ${doisSo} | incompletos: ${parcial}`)
console.log(`dias com atraso>5min: ${atrasoTot} | entrada de origem 'real' (batida): ${atrasoReal} | manual/outra: ${atrasoManual}`)

console.log('\n=== ONDE MAIS A FOLHA MOSTRA HORA EM DECIMAL (grep-like nos totais gravados) ===')
const amostra=await qAll('folha_ponto?select=total_horas_normais,total_horas_extras_50,total_horas_extras_100&mes=eq.8&ano=eq.2026&total_horas_extras_50=gt.0&limit=8')
amostra.slice(0,8).forEach(a=>console.log(`   normais=${a.total_horas_normais} extra50=${a.total_horas_extras_50} (=${hm(Math.round(a.total_horas_extras_50*60))}) extra100=${a.total_horas_extras_100}`))
