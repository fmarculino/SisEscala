// Conferencia da mudanca de 04/09/2026. SOMENTE LEITURA.
// Pergunta central: com ZERO decisoes tomadas, o rodape novo muda algum valor?
import fs from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const C = require('./_sim/calculoDia.js')
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p,pag=1000){const o=[];for(let f=0;;f+=pag){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+pag-1}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,300));break}const g=await r.json();o.push(...g);if(g.length<pag)break}return o}
const isFalta=(o)=>!!o&&o.includes('FALTA')&&!o.includes('AGUARDANDO')
const hm=C.formatarMinutosHHMM

const jo=await qAll('jornadas?select=id,nome,horas_totais'); const J=new Map(jo.map(j=>[j.id,j]))
const em=await qAll('escala_mensal?select=id,jornada_id&ativo=is.true')
const EM=new Map(em.map(e=>[e.id,J.get(e.jornada_id)]))

for (const [mes,rot] of [[8,'08/2026 (fechada como Revisada)'],[9,'09/2026 (aberta)']]) {
  const fp=await qAll(`folha_ponto?select=id,servidor_id,escala_mensal_id,mes,ano,total_horas_extras_50,total_horas_extras_100,total_faltas,registros&mes=eq.${mes}&ano=eq.2026`,200)
  let divExtra=0,piorDivMin=0,divFaltas=0
  let totAtraso=0,totNoturno=0,totPend=0,folhasComPend=0,totCompensavel=0,totAbono=0
  for(const f of fp){
    const jor=EM.get(f.escala_mensal_id)
    const regs=Array.isArray(f.registros)?f.registros:[]
    const t=C.totaisFolha(regs,{horasNormaisPorDia:jor?.horas_totais||8,jornadaNome:jor?.nome,ano:2026,mes,isFaltaDefinitiva:isFalta})
    const gravado50=Math.round(Number(f.total_horas_extras_50||0)*60)
    const gravado100=Math.round(Number(f.total_horas_extras_100||0)*60)
    const d=Math.abs((t.extra50Minutos+t.extra100Minutos)-(gravado50+gravado100))
    if(d>1){divExtra++;piorDivMin=Math.max(piorDivMin,d)}
    if(t.faltas!==(f.total_faltas||0))divFaltas++
    totAtraso+=t.atrasoMinutos; totNoturno+=t.noturnoMinutos; totAbono+=t.abonoMinutos
    if(t.pendentesCompensacao.length){folhasComPend++;totPend+=t.pendentesCompensacao.length;totCompensavel+=t.compensavelPendenteMinutos}
  }
  console.log(`\n=== ${rot} — ${fp.length} folhas ===`)
  console.log(`  TOTAL DE EXTRA muda em: ${divExtra} folhas (pior diferenca ${piorDivMin} min) | faltas divergentes: ${divFaltas}`)
  console.log(`  indicadores NOVOS: atraso ${hm(totAtraso)} | noturno ${hm(totNoturno)} | abono ${hm(totAbono)} (0 esperado: campo so existe em folha regerada)`)
  console.log(`  a decidir: ${totPend} dias em ${folhasComPend} folhas | abateria ate ${hm(totCompensavel)} de hora extra`)
}
