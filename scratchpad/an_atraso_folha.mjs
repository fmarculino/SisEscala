// Medicao de apoio ao estudo de 04/09/2026 (folha de ponto: HH:MM, noturno, atraso/compensacao).
// SOMENTE LEITURA. Espelha parseJornadaNome + o bloco de hora extra de folha-ponto/actions.ts.
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p,pag=1000){const o=[];for(let f=0;;f+=pag){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+pag-1}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,300));break}const g=await r.json();o.push(...g);if(g.length<pag)break}return o}

// ---- copia fiel de parseJornadaNome (folha-ponto/actions.ts:44) ----
const RE=/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i
function parse(nome){
  if(!nome) return {ok:false,sh:8,sm:0,eh:17,em:0}
  const m=nome.match(RE)
  if(!m) return {ok:false,sh:8,sm:0,eh:17,em:0}
  return {ok:true,sh:+m[1],sm:m[2]?+m[2]:0,eh:+m[3],em:m[4]?+m[4]:0}
}
const min=(hhmm)=>{if(!hhmm||!/^\d{1,2}:\d{2}/.test(hhmm))return null;const[a,b]=hhmm.split(':');return +a*60+ +b}

console.log('=== 1. JORNADAS: quantas o regex resolve ===')
const jo=await qAll('jornadas?select=id,nome,horas_totais,intervalo_minutos')
const jbad=jo.filter(j=>!parse(j.nome).ok)
console.log(`jornadas cadastradas: ${jo.length} | NAO resolvidas pelo regex: ${jbad.length}`)
jbad.slice(0,15).forEach(j=>console.log(`   NAO PARSEIA -> "${j.nome}" (horas_totais=${j.horas_totais})`))

const em=await qAll('escala_mensal?select=id,servidor_id,jornada_id,mes,ano,ativo&ano=eq.2026&mes=in.(8,9)')
const J=new Map(jo.map(j=>[j.id,j]))
const emBad=em.filter(e=>e.ativo!==false&&!parse(J.get(e.jornada_id)?.nome).ok)
console.log(`escala_mensal 08+09/2026 ativas: ${em.filter(e=>e.ativo!==false).length} | com jornada que NAO parseia: ${emBad.length}`)

console.log('\n=== 2. FOLHAS 08/2026: atraso, saida antecipada e o padrao "compensou saindo depois" ===')
const fp=await qAll('folha_ponto?select=id,servidor_id,status,total_horas_normais,total_horas_extras_50,total_horas_extras_100,total_faltas,registros&mes=eq.8&ano=eq.2026',200)
console.log(`folhas 08/2026: ${fp.length}`)

const sv=new Map((await qAll('servidores?select=id,nome,matricula')).map(s=>[s.id,s]))
const TOL=5 // Art.58 §1: variacao <=5min por marcacao. Uso como piso pra nao contar ruido.

let diasComPar=0, diasAtraso=0, minAtraso=0, diasSaidaAnt=0, minSaidaAnt=0
let diasPadrao=0, minPadraoExtra=0, minPadraoCompensavel=0
let diasExtraSemAtraso=0, minExtraSemAtraso=0
let minNoturno=0, diasNoturno=0
let semJornadaNoRegistro=0
const porPessoa=new Map()
const exemplos=[]

for(const f of fp){
  const regs=Array.isArray(f.registros)?f.registros:[]
  for(const r of regs){
    if(!r.turno_codigo||r.afastamento||r.feriado) continue
    const e=min(r.entrada), s=min(r.saida)
    if(e===null||s===null) continue
    diasComPar++
    const p=parse(r.jornada_nome||'')
    if(!r.jornada_nome) semJornadaNoRegistro++
    const pe=p.sh*60+p.sm
    let ps=p.eh*60+p.em; if(ps<=pe) ps+=1440
    let sFim=s; if(sFim<e) sFim+=1440           // cruza meia-noite
    const atraso=Math.max(0,e-pe)
    const exced=Math.max(0,sFim-ps)
    const antecSaida=Math.max(0,ps-sFim)
    if(atraso>TOL){diasAtraso++;minAtraso+=atraso}
    if(antecSaida>TOL){diasSaidaAnt++;minSaidaAnt+=antecSaida}
    const he=Number(r.hora_extra_minutos)||0
    if(atraso>TOL&&he>0){
      diasPadrao++; minPadraoExtra+=he; minPadraoCompensavel+=Math.min(atraso,he,120)
      if(exemplos.length<12)exemplos.push({nome:sv.get(f.servidor_id)?.nome,mat:sv.get(f.servidor_id)?.matricula,dia:r.dia,jor:r.jornada_nome,ent:r.entrada,sai:r.saida,atraso,he,orig:`${r.origem_entrada||'-'}/${r.origem_saida||'-'}`})
      const k=f.servidor_id; const a=porPessoa.get(k)||{d:0,he:0}; a.d++; a.he+=he; porPessoa.set(k,a)
    }
    if(atraso<=TOL&&he>0){diasExtraSemAtraso++;minExtraSemAtraso+=he}
    // noturno: sobreposicao do intervalo trabalhado com 22h-05h (sem intervalo intrajornada)
    let n=0
    for(let t=e;t<sFim;t++){const h=Math.floor((t%1440)/60);if(h>=22||h<5)n++}
    if(n>0){diasNoturno++;minNoturno+=n}
  }
}
const hm=m=>`${Math.floor(m/60)}:${String(Math.round(m%60)).padStart(2,'0')}`
console.log(`dias com entrada E saida: ${diasComPar} | registros sem jornada_nome: ${semJornadaNoRegistro}`)
console.log(`ATRASO na entrada (>${TOL}min): ${diasAtraso} dias, ${hm(minAtraso)} (media ${Math.round(minAtraso/(diasAtraso||1))}min/dia)`)
console.log(`SAIDA ANTECIPADA (>${TOL}min): ${diasSaidaAnt} dias, ${hm(minSaidaAnt)}`)
console.log(`>>> PADRAO "chegou atrasado E saiu depois do previsto" (hoje pago como EXTRA): ${diasPadrao} dias`)
console.log(`    hora extra gerada nesses dias: ${hm(minPadraoExtra)} | compensavel (min(atraso,extra,120)): ${hm(minPadraoCompensavel)}`)
console.log(`    pessoas envolvidas: ${porPessoa.size}`)
console.log(`extra SEM atraso na entrada (extra "limpa"): ${diasExtraSemAtraso} dias, ${hm(minExtraSemAtraso)}`)
console.log(`NOTURNO (22h-05h) dentro do par entrada/saida: ${diasNoturno} dias, ${hm(minNoturno)}`)
console.log('\n  exemplos do padrao:')
exemplos.forEach(x=>console.log(`   ${x.mat} ${String(x.nome).slice(0,28).padEnd(28)} dia ${String(x.dia).padStart(2,'0')} | ${String(x.jor).padEnd(14)} | ${x.ent}->${x.sai} | atraso ${x.atraso}min | extra ${x.he}min | origem ${x.orig}`))

console.log('\n=== 3. ARREDONDAMENTO: decimal gravado vs minutos reais ===')
let divergentes=0, piorErro=0
for(const f of fp){
  const regs=Array.isArray(f.registros)?f.registros:[]
  let m50=0,m100=0
  for(const r of regs){const he=Number(r.hora_extra_minutos)||0;if(he>0){if(r.hora_extra_tipo==='100%')m100+=he;else m50+=he}}
  const grav50=Math.round(Number(f.total_horas_extras_50||0)*60)
  if(m50>0&&grav50!==m50){divergentes++;piorErro=Math.max(piorErro,Math.abs(grav50-m50))}
}
console.log(`folhas em que (total_horas_extras_50 x 60) != soma dos minutos dos dias: ${divergentes} de ${fp.length} | pior erro: ${piorErro} min`)

console.log('\n=== 4. ABONO (regime_abono) ===')
const ev=await qAll('servidores_eventos?select=servidor_id,data_inicio,data_fim,periodo_tipo,regime_abono,minutos_afastamento,tipos_eventos(nome)')
const noMes=ev.filter(e=>e.data_inicio<='2026-08-31'&&e.data_fim>='2026-08-01')
const ab=noMes.filter(e=>e.regime_abono!=='a_compensar')
const ac=noMes.filter(e=>e.regime_abono==='a_compensar')
console.log(`eventos que tocam 08/2026: ${noMes.length} | abonados: ${ab.length} | a_compensar: ${ac.length}`)
console.log(`   por horas (periodo_tipo='horas'): ${noMes.filter(e=>e.periodo_tipo==='horas').length}`)
