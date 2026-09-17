// FASE 4 - mede e CLASSIFICA os casos de 09/2026 antes de tocar em qualquer coisa.
// Somente leitura. Nao escreve tratamento, nao reconcilia.
import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function all(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});const j=await r.json();if(!Array.isArray(j))throw new Error(p+' -> '+JSON.stringify(j));o.push(...j);if(j.length<1000)break}return o}
const rpc=async(n,b)=>{const r=await fetch(`${U}/rest/v1/rpc/${n}`,{method:'POST',headers:H,body:JSON.stringify(b)});return r.ok?await r.json():null}
const hhmm=(iso)=>new Date(new Date(iso).getTime()-3*3600e3).toISOString().slice(5,16).replace('T',' ')

const ems=await all('escala_mensal?select=id,servidor_id,mes,ano,status,unidade_id,setor_id,servidores(nome,matricula)&mes=eq.9&ano=eq.2026&order=id')
const byId=new Map(ems.map(e=>[e.id,e]))
const eds=(await all('escala_diaria?select=id,escala_mensal_id,dia,categoria,dicionario_turnos_id,presenca_entrada_em,presenca_saida_em,presenca_entrada_marcacao_id,presenca_saida_marcacao_id,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,dicionario_turnos(codigo)&order=id')).filter(d=>byId.has(d.escala_mensal_id))

const HOJE=17
const porServDia=new Map()
for(const d of eds){ if(d.dia>=HOJE) continue
  const em=byId.get(d.escala_mensal_id); const k=`${em.servidor_id}|${d.dia}`
  if(!porServDia.has(k))porServDia.set(k,[]); porServDia.get(k).push(d) }

const casos=[]
for(const [k,linhas] of porServDia){
  if(linhas.length<2) continue
  const soSaida=linhas.filter(d=>!d.presenca_entrada_em && d.presenca_saida_em)
  const completas=linhas.filter(d=>d.presenca_entrada_em && d.presenca_saida_em)
  if(soSaida.length>=1 && completas.length>=1) casos.push({k,linhas,soSaida,completas})
}
console.log(`PADRAO em 09/2026 (dias < ${HOJE}): ${casos.length} pares (servidor, dia)\n`)

// Classifica: a batida da linha "so saida" esta mais perto do slot de ENTRADA de outro turno?
const cls={chegada_antecipada:[], provavel_esqueceu_entrada:[], indeterminado:[], ja_tratado:[]}
for(const c of casos){
  const [servId,dia]=c.k.split('|')
  const em=byId.get(c.soSaida[0].escala_mensal_id)
  const data=`2026-09-${String(dia).padStart(2,'0')}`
  const blocos=await rpc('fn_blocos_previstos_dia',{p_servidor_id:servId,p_data:data})
  const linhaSS=c.soSaida[0]
  const marcId=linhaSS.presenca_saida_marcacao_id
  const ts=new Date(linhaSS.presenca_saida_em).getTime()

  // ja existe tratamento sobre essa batida?
  const tr=marcId?await all(`marcacoes_tratamentos?select=tipo&marcacao_id=eq.${marcId}`):[]
  if(tr.length){ cls.ja_tratado.push({...c,info:'ja tem tratamento'}); continue }

  // distancia ao slot onde ESTA (saida do proprio bloco) vs entrada de OUTRO bloco
  let distAtual=null, distOutraEntrada=null, outroCodigo=null
  for(const b of (blocos||[])){
    const ids=b.escala_diaria_ids||[]
    if(ids.includes(linhaSS.id)){
      if(b.fim_previsto) distAtual=Math.abs(ts-new Date(b.fim_previsto).getTime())/60000
    } else {
      if(b.inicio_previsto){
        const d=Math.abs(ts-new Date(b.inicio_previsto).getTime())/60000
        if(distOutraEntrada===null||d<distOutraEntrada){ distOutraEntrada=d; outroCodigo=b.codigo||'?' }
      }
    }
  }
  const linha={servidor:em.servidores?.nome, mat:em.servidores?.matricula, dia:+dia,
    turnoSS:`${linhaSS.categoria} ${linhaSS.dicionario_turnos?.codigo||''}`.trim(),
    batida:hhmm(linhaSS.presenca_saida_em), distAtual:distAtual!==null?Math.round(distAtual):null,
    distOutraEntrada:distOutraEntrada!==null?Math.round(distOutraEntrada):null, outroCodigo,
    edId:linhaSS.id, marcId, status:em.status}

  if(distOutraEntrada!==null && distAtual!==null && distOutraEntrada<distAtual) cls.chegada_antecipada.push(linha)
  else if(distAtual!==null) cls.provavel_esqueceu_entrada.push(linha)
  else cls.indeterminado.push(linha)
}

for(const [nome,arr] of Object.entries(cls)){
  console.log(`\n=== ${nome.toUpperCase()}: ${arr.length} ===`)
  arr.slice(0,12).forEach(x=>console.log('  ',JSON.stringify(x)))
}
fs.writeFileSync('scratchpad/_fase4_casos.json',JSON.stringify(cls,null,1))
console.log('\ngravado: scratchpad/_fase4_casos.json')
