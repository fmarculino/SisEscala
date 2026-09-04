// Parte 2 da medicao (04/09/2026). SOMENTE LEITURA.
// Foco: (a) impacto do regex que nao entende "ÁS" (A agudo) na hora extra ja paga;
//       (b) padrao atraso+extra separando as jornadas que parseiam das que nao parseiam;
//       (c) de onde vem a "saida antecipada".
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p,pag=1000){const o=[];for(let f=0;;f+=pag){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+pag-1}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,300));break}const g=await r.json();o.push(...g);if(g.length<pag)break}return o}
const RE=/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i
function parse(nome){if(!nome)return{ok:false,sh:8,sm:0,eh:17,em:0};const m=nome.match(RE);if(!m)return{ok:false,sh:8,sm:0,eh:17,em:0};return{ok:true,sh:+m[1],sm:m[2]?+m[2]:0,eh:+m[3],em:m[4]?+m[4]:0}}
const min=h=>{if(!h||!/^\d{1,2}:\d{2}/.test(h))return null;const[a,b]=h.split(':');return +a*60+ +b}
const hm=m=>`${Math.floor(m/60)}:${String(Math.round(m%60)).padStart(2,'0')}`

const jo=await qAll('jornadas?select=id,nome,horas_totais')
const J=new Map(jo.map(j=>[j.id,j]))
const em=await qAll('escala_mensal?select=id,servidor_id,jornada_id,mes,ano,ativo&ano=eq.2026')
const EMj=new Map()   // servidor|mes/ano -> nome da jornada
em.filter(e=>e.ativo!==false).forEach(e=>EMj.set(`${e.servidor_id}|${e.mes}`,J.get(e.jornada_id)?.nome||''))
const sv=new Map((await qAll('servidores?select=id,nome,matricula')).map(s=>[s.id,s]))

const fp=await qAll('folha_ponto?select=id,servidor_id,mes,status,registros&mes=in.(6,7,8)&ano=eq.2026',200)
console.log(`folhas 06+07+08/2026: ${fp.length}`)
const TOL=5

// (a) impacto do regex nas jornadas com "ÁS"
console.log('\n=== A. JORNADAS QUE O REGEX NAO ENTENDE -> previsto vira 08:00-17:00 ===')
let aDias=0,aExtra=0,aExtraDias=0; const aPessoas=new Set(); const aEx=[]
for(const f of fp){
  const jnFolha=EMj.get(`${f.servidor_id}|${f.mes}`)||''
  for(const r of (Array.isArray(f.registros)?f.registros:[])){
    if(!r.turno_codigo||r.afastamento||r.feriado) continue
    const jn=r.jornada_nome||jnFolha
    if(parse(jn).ok) continue
    aDias++
    const he=Number(r.hora_extra_minutos)||0
    if(he>0){aExtraDias++;aExtra+=he;aPessoas.add(f.servidor_id)
      if(aEx.length<10)aEx.push(`${sv.get(f.servidor_id)?.matricula} ${String(sv.get(f.servidor_id)?.nome).slice(0,26).padEnd(26)} ${String(f.mes).padStart(2,'0')}/26 dia ${String(r.dia).padStart(2,'0')} | "${jn}" | ${r.entrada}->${r.saida} | extra ${he}min (${r.hora_extra_tipo}) | origem ${r.origem_entrada||'-'}/${r.origem_saida||'-'}`)}
  }
}
console.log(`dias de trabalho com jornada nao-parseavel: ${aDias}`)
console.log(`   destes, com hora extra gravada: ${aExtraDias} dias, ${hm(aExtra)}, ${aPessoas.size} pessoas`)
aEx.forEach(l=>console.log('   '+l))

// (b) padrao atraso+extra, SO nas jornadas que parseiam (previsto confiavel)
console.log('\n=== B. ATRASO x EXTRA no mesmo dia (so jornadas parseaveis) ===')
for(const mes of [6,7,8]){
  let dias=0,atrasoDias=0,minAtraso=0,padrao=0,extraPadrao=0,compensavel=0,extraLimpa=0,extraLimpaDias=0
  const pess=new Set()
  for(const f of fp.filter(x=>x.mes===mes)){
    const jnFolha=EMj.get(`${f.servidor_id}|${f.mes}`)||''
    for(const r of (Array.isArray(f.registros)?f.registros:[])){
      if(!r.turno_codigo||r.afastamento||r.feriado) continue
      const jn=r.jornada_nome||jnFolha; const p=parse(jn); if(!p.ok) continue
      const e=min(r.entrada),s=min(r.saida); if(e===null||s===null) continue
      dias++
      const pe=p.sh*60+p.sm; let ps=p.eh*60+p.em; if(ps<=pe)ps+=1440
      let sf=s; if(sf<e)sf+=1440
      const atraso=Math.max(0,e-pe), he=Number(r.hora_extra_minutos)||0
      if(atraso>TOL){atrasoDias++;minAtraso+=atraso}
      if(atraso>TOL&&he>0){padrao++;extraPadrao+=he;compensavel+=Math.min(atraso,he,120);pess.add(f.servidor_id)}
      else if(he>0){extraLimpaDias++;extraLimpa+=he}
    }
  }
  console.log(`${String(mes).padStart(2,'0')}/2026: ${dias} dias com par | atraso>5min: ${atrasoDias} dias (${hm(minAtraso)})`)
  console.log(`         padrao atraso+extra: ${padrao} dias, extra ${hm(extraPadrao)}, compensavel ${hm(compensavel)}, ${pess.size} pessoas`)
  console.log(`         extra sem atraso: ${extraLimpaDias} dias, ${hm(extraLimpa)}`)
}

// (c) saida antecipada: de onde vem
console.log('\n=== C. SAIDA ANTECIPADA 08/2026 (so jornadas parseaveis) — top jornadas ===')
const porJor=new Map()
for(const f of fp.filter(x=>x.mes===8)){
  const jnFolha=EMj.get(`${f.servidor_id}|8`)||''
  for(const r of (Array.isArray(f.registros)?f.registros:[])){
    if(!r.turno_codigo||r.afastamento||r.feriado) continue
    const jn=r.jornada_nome||jnFolha; const p=parse(jn); if(!p.ok) continue
    const e=min(r.entrada),s=min(r.saida); if(e===null||s===null) continue
    const pe=p.sh*60+p.sm; let ps=p.eh*60+p.em; if(ps<=pe)ps+=1440
    let sf=s; if(sf<e)sf+=1440
    const ant=Math.max(0,ps-sf); if(ant<=TOL) continue
    const a=porJor.get(jn)||{d:0,m:0}; a.d++; a.m+=ant; porJor.set(jn,a)
  }
}
;[...porJor.entries()].sort((x,y)=>y[1].m-x[1].m).slice(0,8).forEach(([k,v])=>console.log(`   ${k.padEnd(16)} ${String(v.d).padStart(4)} dias  ${hm(v.m).padStart(8)}  (media ${Math.round(v.m/v.d)}min)`))

// (d) quantas folhas de 08/2026 estao FECHADAS (nao da pra recalcular sem reabrir)
console.log('\n=== D. STATUS DAS FOLHAS 08/2026 ===')
const st=new Map(); fp.filter(x=>x.mes===8).forEach(f=>st.set(f.status,(st.get(f.status)||0)+1))
console.log('   '+[...st.entries()].map(([k,v])=>`${k}: ${v}`).join(' | '))
const comp=await qAll('configuracoes_globais?select=chave,valor&chave=eq.competencias_encerradas')
console.log('   competencias encerradas: '+JSON.stringify(comp[0]?.valor))
