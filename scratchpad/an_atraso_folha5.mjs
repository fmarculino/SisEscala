import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p,pag=1000){const o=[];for(let f=0;;f+=pag){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+pag-1}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,300));break}const g=await r.json();o.push(...g);if(g.length<pag)break}return o}
const RE=/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i
const min=h=>{if(!h||!/^\d{1,2}:\d{2}/.test(h))return null;const[a,b]=h.split(':');return +a*60+ +b}
const hm=m=>`${Math.floor(m/60)}:${String(Math.round(m%60)).padStart(2,'0')}`
const fp=await qAll('folha_ponto?select=id,servidor_id,mes,status,registros&mes=eq.9&ano=eq.2026',200)
const sv=new Map((await qAll('servidores?select=id,nome,matricula')).map(s=>[s.id,s]))
let semJor=0,semJorExtra=0,semJorExtraDias=0,tot=0,atr=0,minAtr=0,padrao=0,extraPadrao=0,comp=0
const pess=new Set(), ex=[]
for(const f of fp){
  for(const r of (Array.isArray(f.registros)?f.registros:[])){
    if(!r.turno_codigo||r.afastamento||r.feriado) continue
    tot++
    const p=(r.jornada_nome||'').match(RE)
    const he=Number(r.hora_extra_minutos)||0
    if(!p){semJor++; if(he>0){semJorExtraDias++;semJorExtra+=he; if(ex.length<6)ex.push(`${sv.get(f.servidor_id)?.matricula} ${String(sv.get(f.servidor_id)?.nome).slice(0,24)} dia ${r.dia} jornada="${r.jornada_nome||'(vazia)'}" ${r.entrada}->${r.saida} extra ${he}min`)} ; continue}
    const e=min(r.entrada),s=min(r.saida); if(e===null||s===null) continue
    const pe=(+p[1])*60+(p[2]?+p[2]:0)
    const atraso=Math.max(0,e-pe)
    if(atraso>5){atr++;minAtr+=atraso}
    if(atraso>5&&he>0){padrao++;extraPadrao+=he;comp+=Math.min(atraso,he,120);pess.add(f.servidor_id)}
  }
}
console.log(`09/2026 (competencia ABERTA, ${fp.length} folhas): ${tot} dias de trabalho`)
console.log(`  dias cuja jornada NAO resolve o previsto (vira 08:00-17:00): ${semJor}`)
console.log(`     destes, com hora extra ja gravada: ${semJorExtraDias} dias, ${hm(semJorExtra)}`)
ex.forEach(l=>console.log('     '+l))
console.log(`  atraso>5min: ${atr} dias (${hm(minAtr)})`)
console.log(`  padrao atraso+extra: ${padrao} dias | extra ${hm(extraPadrao)} | compensavel ${hm(comp)} | ${pess.size} pessoas`)
