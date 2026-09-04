// Conferencia da mudanca de horas normais (04/09/2026). SOMENTE LEITURA.
// Simula o codigo novo + a correcao de cadastro das 3 jornadas, e responde:
//   (a) 08/2026 muda? (nao pode)   (b) quanto 09/2026 muda?
import fs from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const C = require('./_sim/cargaDiaria.js')
const D = require('./_sim/calculoDia.js')
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p,pag=1000){const o=[];for(let f=0;;f+=pag){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+pag-1}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,200));break}const g=await r.json();o.push(...g);if(g.length<pag)break}return o}

const jo=await qAll('jornadas?select=id,nome,horas_totais,intervalo_minutos')
// aplica na simulacao a correcao de cadastro da migration 20260904110000
const CORRIGE={'08H ÀS 17H':9,'09H ÀS 18H':9,'10H ÀS 19H':9}
const J=new Map(jo.map(j=>[j.nome,{...j,horas_totais:CORRIGE[j.nome]??j.horas_totais}]))
const JI=new Map(jo.map(j=>[j.id,J.get(j.nome)]))
const em=await qAll('escala_mensal?select=id,jornada_id&ativo=is.true')
const EM=new Map(em.map(e=>[e.id,JI.get(e.jornada_id)]))

for(const mes of [8,9]){
  const fp=await qAll(`folha_ponto?select=escala_mensal_id,total_horas_normais,registros&mes=eq.${mes}&ano=eq.2026`,200)
  const liquidas=D.horasNormaisLiquidasVigente(mes,2026)
  let novo=0,gravado=0,folhas=0,mudaram=0,piorDif=0
  for(const f of fp){
    const regs=Array.isArray(f.registros)?f.registros:[]
    const jorFolha=EM.get(f.escala_mensal_id)
    const carga=C.montarCargaPorJornada([...J.values()],liquidas)
    const padrao=C.horasNormaisDaJornada(jorFolha,liquidas)
    let n=0
    for(const r of regs) if(r.turno_codigo) n+=C.horasNormaisDoDia(r,carga,padrao)
    if(n===0) continue
    folhas++; novo+=n; gravado+=Number(f.total_horas_normais)||0
    const dif=Math.abs(n-(Number(f.total_horas_normais)||0))
    if(dif>0.01){mudaram++;piorDif=Math.max(piorDif,dif)}
  }
  console.log(`\n=== ${String(mes).padStart(2,'0')}/2026 — regra liquida vigente: ${liquidas ? 'SIM' : 'NAO'} ===`)
  console.log(`  ${folhas} folhas | gravado hoje ${gravado.toFixed(0)}h -> com o codigo novo ${novo.toFixed(0)}h`)
  console.log(`  folhas cujo total MUDA: ${mudaram} (pior diferenca ${piorDif.toFixed(1)}h)`)
  if(mes===8&&mudaram>0) console.log('  ⚠️ ATENCAO: 08/2026 nao deveria mudar!')
}
