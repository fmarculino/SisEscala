// 04/09/2026 — SOMENTE LEITURA. As "horas normais" da folha incluem o intervalo?
// Questionamento do RH: folha mostra 210h onde eles esperam ~160h.
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p,pag=1000){const o=[];for(let f=0;;f+=pag){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+pag-1}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,200));break}const g=await r.json();o.push(...g);if(g.length<pag)break}return o}

const jo=await qAll('jornadas?select=id,nome,horas_totais,intervalo_minutos')
const J=new Map(jo.map(j=>[j.nome,j]))
console.log('=== CATALOGO: horas_totais e o VAO (com intervalo) ou a carga LIQUIDA? ===')
jo.sort((a,b)=>a.nome.localeCompare(b.nome)).slice(0,30).forEach(j=>{
  const m=j.nome.replace(/[ÀÁàá]/g,'a').match(/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:as|a)\s*(\d{1,2})/i)
  let vao=null
  if(m){let ini=+m[1],fim=+m[3];vao=fim-ini;if(vao<=0)vao+=24}
  const liq=Number(j.horas_totais)-(Number(j.intervalo_minutos)||0)/60
  console.log(`  ${j.nome.padEnd(14)} horas_totais=${String(j.horas_totais).padStart(4)} intervalo=${String(j.intervalo_minutos).padStart(3)}min | vao pelo nome=${vao} | liquida=${liq}  ${vao===Number(j.horas_totais)?'-> horas_totais = VAO (inclui intervalo)':'-> DIVERGE'}`)
})

console.log('\n=== A FOLHA DA CAPTURA (AMONY JAMILLY, mat. 68709, 08/2026) ===')
const sv=(await qAll('servidores?select=id,nome,matricula&matricula=eq.68709'))[0]
if(sv){
  const fp=(await qAll(`folha_ponto?select=id,mes,ano,total_horas_normais,registros&servidor_id=eq.${sv.id}&mes=eq.8&ano=eq.2026`))[0]
  const regs=Array.isArray(fp?.registros)?fp.registros:[]
  const dias=regs.filter(r=>r.turno_codigo)
  const porJor=new Map()
  dias.forEach(r=>porJor.set(r.jornada_nome||'(vazio)',(porJor.get(r.jornada_nome||'(vazio)')||0)+1))
  console.log(`  ${sv.nome} | dias com turno: ${dias.length}`)
  let bruto=0,liquido=0
  for(const [nome,qtd] of porJor){
    const j=J.get(nome)
    const b=(Number(j?.horas_totais)||8)*qtd
    const l=((Number(j?.horas_totais)||8)-(Number(j?.intervalo_minutos)||0)/60)*qtd
    bruto+=b; liquido+=l
    console.log(`    ${qtd} dias x "${nome}" (${j?.horas_totais}h, intervalo ${j?.intervalo_minutos}min) -> bruto ${b}h | liquido ${l}h`)
  }
  console.log(`  TOTAL gravado na folha: ${fp?.total_horas_normais}h`)
  console.log(`  bruto (com intervalo):  ${bruto}h   <- o que a folha mostra`)
  console.log(`  liquido (sem intervalo): ${liquido}h  <- o que o RH espera`)
}

console.log('\n=== O SISTEMA JA USA AS DUAS DEFINICOES EM TELAS DIFERENTES? ===')
console.log('  escala/carga mensal (fn_carga_mensal_servidor e calculateTotals):')
console.log('    Regular -> LEAST(horas_computadas, jornada.horas_totais - intervalo_minutos/60)  [LIQUIDA]')
console.log('  folha de ponto (horasNormaisDoDia):')
console.log('    soma jornadas.horas_totais por dia com turno                                     [BRUTA]')

console.log('\n=== TAMANHO DA DIFERENCA EM 08/2026 (todas as folhas) ===')
const em=await qAll('escala_mensal?select=id,jornada_id&ativo=is.true')
const JI=new Map(jo.map(j=>[j.id,j]))
const EM=new Map(em.map(e=>[e.id,JI.get(e.jornada_id)]))
const fps=await qAll('folha_ponto?select=escala_mensal_id,total_horas_normais,registros&mes=eq.8&ano=eq.2026',200)
let somaBruto=0,somaLiquido=0,folhas=0
for(const f of fps){
  const regs=Array.isArray(f.registros)?f.registros:[]
  const jorFolha=EM.get(f.escala_mensal_id)
  let b=0,l=0
  for(const r of regs){
    if(!r.turno_codigo) continue
    const j=J.get(r.jornada_nome)||jorFolha
    const ht=Number(j?.horas_totais)||8, iv=(Number(j?.intervalo_minutos)||0)/60
    b+=ht; l+=Math.max(0,ht-iv)
  }
  if(b>0){folhas++;somaBruto+=b;somaLiquido+=l}
}
console.log(`  ${folhas} folhas | bruto ${somaBruto.toFixed(0)}h | liquido ${somaLiquido.toFixed(0)}h | diferenca ${(somaBruto-somaLiquido).toFixed(0)}h (${((1-somaLiquido/somaBruto)*100).toFixed(1)}%)`)
