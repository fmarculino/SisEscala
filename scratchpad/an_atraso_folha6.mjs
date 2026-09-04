import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p,pag=1000){const o=[];for(let f=0;;f+=pag){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+pag-1}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,300));break}const g=await r.json();o.push(...g);if(g.length<pag)break}return o}
const RE=/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i
const min=h=>{if(!h||!/^\d{1,2}:\d{2}/.test(h))return null;const[a,b]=h.split(':');return +a*60+ +b}
const jo=await qAll('jornadas?select=id,nome'); const J=new Map(jo.map(j=>[j.id,j]))
const em=await qAll('escala_mensal?select=servidor_id,jornada_id,mes,ano,ativo&ano=eq.2026&mes=eq.9')
const EMj=new Map(); em.filter(e=>e.ativo!==false).forEach(e=>EMj.set(e.servidor_id,J.get(e.jornada_id)?.nome||''))
const fp=await qAll('folha_ponto?select=id,servidor_id,registros&mes=eq.9&ano=eq.2026',200)
let semNome=0, escalaTemJornada=0, escalaSemJornada=0, bateComEscala=0, naoBate=0
const naoBateEx=[]
for(const f of fp){
  const jEsc=EMj.get(f.servidor_id)||''
  for(const r of (Array.isArray(f.registros)?f.registros:[])){
    if(!r.turno_codigo||r.afastamento||r.feriado) continue
    if(r.jornada_nome) continue
    semNome++
    if(jEsc){escalaTemJornada++}else{escalaSemJornada++;continue}
    const p=jEsc.match(RE); if(!p) continue
    const he=Number(r.hora_extra_minutos)||0
    const e=min(r.entrada), s=min(r.saida); if(e===null||s===null) continue
    let ps=(+p[3])*60+(p[4]?+p[4]:0); const pe=(+p[1])*60+(p[2]?+p[2]:0); if(ps<=pe)ps+=1440
    let sf=s; if(sf<e)sf+=1440
    const esperado=Math.max(0,sf-ps)
    // tolerancia CLT absorve <=5min isolado
    const esperadoTol = esperado<=5?0:esperado
    if(Math.abs(esperadoTol-he)<=1) bateComEscala++
    else {naoBate++; if(naoBateEx.length<8)naoBateEx.push(`dia ${r.dia} jorn_escala="${jEsc}" ${r.entrada}->${r.saida} | extra gravada ${he}min | esperado por essa jornada ${esperadoTol}min`)}
  }
}
console.log(`09/2026 dias de trabalho com jornada_nome VAZIA no registro: ${semNome}`)
console.log(`   escala_mensal TEM jornada vinculada: ${escalaTemJornada} | escala SEM jornada: ${escalaSemJornada}`)
console.log(`   extra gravada BATE com a jornada da escala: ${bateComEscala} | nao bate: ${naoBate}`)
naoBateEx.forEach(l=>console.log('     '+l))
