import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,300));break}const g=await r.json();o.push(...g);if(g.length<1000)break}return o}
async function q1(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});return r.ok?r.json():[]}

// A) corte de 1000: quantas linhas cada relatorio SEM paginacao perderia
console.log('== A) Corte silencioso de 1000 linhas (armadilha 8) ==')
for(const [m,a] of [[7,2026],[8,2026],[9,2026]]){
  const n=(await q1(`escala_mensal?select=id&mes=eq.${m}&ano=eq.${a}`)).length
  const nf=(await q1(`escala_mensal?select=id&mes=eq.${m}&ano=eq.${a}&status=eq.Fechada`)).length
  console.log(`  ${m}/${a}: escala_mensal=${n>=1000?'>=1000 (paginado)':n} | Fechada=${nf}`)
}
const em9=await qAll('escala_mensal?select=id,servidor_id,unidade_id,setor_id,jornada_id,status&mes=eq.9&ano=eq.2026')
console.log(`  09/2026 real: ${em9.length} escala_mensal -> consolidado/rh (sem paginar) veem 1000 = ${(100*1000/em9.length).toFixed(0)}% do mes`)
const ed9all=await qAll('escala_diaria?select=id,escala_mensal_id&order=id')
const ids9=new Set(em9.map(e=>e.id))
console.log(`  09/2026 escala_diaria: ${ed9all.filter(l=>ids9.has(l.escala_mensal_id)).length} linhas -> distribuicao (sem paginar) ve 1000`)

// B) Regular bruto x liquido no painel
const jo=await qAll('jornadas?select=id,nome,horas_totais,intervalo_minutos')
const dt=await qAll('dicionario_turnos?select=id,codigo,horas_computadas')
const J=new Map(jo.map(j=>[j.id,j])),T=new Map(dt.map(t=>[t.id,t])),EM=new Map(em9.map(e=>[e.id,e]))
const ed9=(await qAll('escala_diaria?select=id,dia,escala_mensal_id,categoria,dicionario_turnos_id&order=id')).filter(l=>ids9.has(l.escala_mensal_id))
let br=0,li=0,semJ=0
for(const l of ed9){ if(l.categoria!=='Regular')continue
  const e=EM.get(l.escala_mensal_id),t=T.get(l.dicionario_turnos_id),j=J.get(e.jornada_id)
  const h=Number(t?.horas_computadas)||0; br+=h
  if(!j){semJ++;li+=h;continue}
  li+=Math.min(h,Number(j.horas_totais)-Number(j.intervalo_minutos||0)/60)
}
console.log(`\n== B) Regular 09/2026: painel=${Math.round(br)}h | relatorio consolidado/grade=${Math.round(li)}h | diferenca=${Math.round(br-li)}h (${((br-li)/br*100).toFixed(1)}%) | linhas sem jornada=${semJ}`)

// C) sobreposicao entre setores (armadilha 23)
const chave=new Map()
for(const l of ed9){const e=EM.get(l.escala_mensal_id);const k=`${e.servidor_id}|${l.dia}|${l.categoria}`;const a=chave.get(k)||[];a.push({em:e,l});chave.set(k,a)}
const dups=[...chave.entries()].filter(([,v])=>v.length>1)
console.log(`\n== C) Mesmo servidor+dia+categoria em MAIS DE UMA escala (09/2026): ${dups.length} ocorrencias ==`)
const sv=await qAll('servidores?select=id,nome,matricula'); const SV=new Map(sv.map(s=>[s.id,s]))
const un=await qAll('unidades?select=id,nome'); const UN=new Map(un.map(u=>[u.id,u.nome]))
const porServ=new Map()
dups.forEach(([k,v])=>{const sid=k.split('|')[0];porServ.set(sid,(porServ.get(sid)||0)+1)})
;[...porServ.entries()].forEach(([sid,n])=>console.log(`  ${SV.get(sid)?.nome} (${SV.get(sid)?.matricula}): ${n} dia(s) contados 2x`))
let horasDup=0
dups.forEach(([,v])=>{v.slice(1).forEach(x=>horasDup+=Number(T.get(x.l.dicionario_turnos_id)?.horas_computadas)||0)})
console.log(`  horas contadas em duplicidade: ${Math.round(horasDup)}h`)

// D) Sobreaviso: horas somadas ao lado de trabalho
console.log(`\n== D) Sobreaviso 09/2026: 2616h somadas no mesmo grafico das horas trabalhadas (a grade e fn_carga_mensal_servidor EXCLUEM sobreaviso da carga) ==`)

// E) status das escalas por mes (o subtitulo "N fechadas")
console.log('\n== E) "Escalas Ativas" — grandezas misturadas ==')
for(const [m,a] of [[8,2026],[9,2026]]){
  const e=await qAll(`escala_mensal?select=id,unidade_id,setor_id,status&mes=eq.${m}&ano=eq.${a}`)
  console.log(`  ${m}/${a}: card mostra ${new Set(e.map(x=>`${x.unidade_id}|${x.setor_id}`)).size} (pares unidade|setor) e "${e.filter(x=>x.status==='Fechada').length} fechadas" (linhas por servidor, de ${e.length})`)
}
