// Dos casos do padrao, quantos a PROJECAO ja resolve? Usa a previa read-only da v2.49.0.
import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const rpc=async(n,b)=>{const r=await fetch(`${U}/rest/v1/rpc/${n}`,{method:'POST',headers:H,body:JSON.stringify(b)});return r.ok?await r.json():{erro:r.status,msg:await r.text().catch(()=>'')}}
const q=async p=>(await fetch(`${U}/rest/v1/${p}`,{headers:H})).json()
const L=iso=>iso?new Date(new Date(iso).getTime()-3*3600e3).toISOString().slice(5,16).replace('T',' '):'—'

const cls=JSON.parse(fs.readFileSync('scratchpad/_fase4_casos.json','utf8'))
const alvos=[...cls.chegada_antecipada,...cls.provavel_esqueceu_entrada]

// agrupa por (servidor, dia) -> precisa do servidor_id, que esta na escala_mensal da linha
const pares=new Map()
for(const a of alvos){
  const ed=(await q(`escala_diaria?select=escala_mensal_id,dia&id=eq.${a.edId}`))[0]
  const em=(await q(`escala_mensal?select=id,servidor_id&id=eq.${ed.escala_mensal_id}`))[0]
  pares.set(`${em.servidor_id}|${ed.dia}`,{servidor:em.servidor_id,dia:ed.dia,nome:a.servidor,mat:a.mat,emId:em.id})
}
console.log(`${pares.size} pares (servidor, dia) distintos\n`)

let soAcrescenta=0, comTroca=0, semGanho=0
const lista=[]
for(const p of pares.values()){
  const data=`2026-09-${String(p.dia).padStart(2,'0')}`
  const prev=await rpc('fn_reconciliacao_pendente_escala',{p_escala_mensal_ids:[p.emId]})
  if(prev?.erro){ console.log(`  ! ${p.nome} dia ${p.dia}: RPC ${prev.erro}`); continue }
  const doDia=(prev||[]).filter(x=>x.dia===p.dia)
  if(!doDia.length){ semGanho++; continue }
  const ganhos=doDia.filter(x=>x.valor_atual===null&&x.valor_novo!==null)
  const trocas=doDia.filter(x=>x.valor_atual!==null&&x.valor_novo!==null&&x.valor_atual!==x.valor_novo)
  const perdas=doDia.filter(x=>x.valor_atual!==null&&x.valor_novo===null)
  if(ganhos.length&&!trocas.length&&!perdas.length){
    soAcrescenta++
    lista.push({nome:p.nome,mat:p.mat,dia:p.dia,servidor:p.servidor,
      ganhos:ganhos.map(g=>`${g.campo}: — -> ${L(g.valor_novo)}`)})
  } else if(trocas.length||perdas.length){ comTroca++
    lista.push({nome:p.nome,mat:p.mat,dia:p.dia,servidor:p.servidor,TROCA:true,
      detalhe:doDia.map(g=>`${g.campo}: ${L(g.valor_atual)} -> ${L(g.valor_novo)}`)})
  } else semGanho++
}
console.log(`SO ACRESCENTA (seguro):        ${soAcrescenta}`)
console.log(`com TROCA ou PERDA (humano):   ${comTroca}`)
console.log(`sem ganho nenhum:              ${semGanho}`)
console.log('\n' + JSON.stringify(lista,null,1))
fs.writeFileSync('scratchpad/_fase4_reconciliavel.json',JSON.stringify(lista,null,1))
