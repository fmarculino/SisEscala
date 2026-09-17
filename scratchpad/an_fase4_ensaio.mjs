// ENSAIO ANTES/DEPOIS da Fase 4, campo a campo, SEM ESCREVER NADA.
// Compara fn_projecao_marcacoes_dia (o que a reconciliacao aplicaria) com o que esta gravado.
import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const rpc=async(n,b)=>{const r=await fetch(`${U}/rest/v1/rpc/${n}`,{method:'POST',headers:H,body:JSON.stringify(b)});return r.ok?await r.json():null}
const q=async p=>(await fetch(`${U}/rest/v1/${p}`,{headers:H})).json()
const L=iso=>iso?new Date(new Date(iso).getTime()-3*3600e3).toISOString().slice(5,16).replace('T',' '):'—'

const CAMPOS=[['entrada_em','presenca_entrada_em'],['int_saida_em','presenca_intervalo_saida_em'],
  ['int_ret_em','presenca_intervalo_retorno_em'],['saida_em','presenca_saida_em']]

const cls=JSON.parse(fs.readFileSync('scratchpad/_fase4_casos.json','utf8'))
const alvos=[...cls.chegada_antecipada,...cls.provavel_esqueceu_entrada]
const pares=new Map()
for(const a of alvos){
  const ed=(await q(`escala_diaria?select=escala_mensal_id,dia&id=eq.${a.edId}`))[0]
  const em=(await q(`escala_mensal?select=id,servidor_id,status&id=eq.${ed.escala_mensal_id}`))[0]
  pares.set(`${em.servidor_id}|${ed.dia}`,{serv:em.servidor_id,dia:ed.dia,nome:a.servidor,mat:a.mat,status:em.status})
}

const soGanho=[], comTroca=[], semNada=[]
for(const p of pares.values()){
  const data=`2026-09-${String(p.dia).padStart(2,'0')}`
  const proj=await rpc('fn_projecao_marcacoes_dia',{p_servidor_id:p.serv,p_data:data})
  if(!proj||!proj.length){ semNada.push(p); continue }
  const ids=proj.map(x=>x.escala_diaria_id)
  const eds=await q(`escala_diaria?select=id,categoria,dia,presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em,dicionario_turnos(codigo)&id=in.(${ids.join(',')})`)
  const byId=new Map(eds.map(e=>[e.id,e]))
  const ganhos=[],trocas=[],perdas=[]
  for(const pr of proj){
    const ed=byId.get(pr.escala_diaria_id); if(!ed) continue
    for(const [cp,ce] of CAMPOS){
      const novo=pr[cp]||null, atual=ed[ce]||null
      if(novo===atual) continue
      const rot=`${ed.categoria} ${ed.dicionario_turnos?.codigo||''} ${ce.replace('presenca_','')}`
      if(atual===null&&novo!==null) ganhos.push(`${rot}: — -> ${L(novo)}`)
      else if(atual!==null&&novo===null) perdas.push(`${rot}: ${L(atual)} -> —`)
      else trocas.push(`${rot}: ${L(atual)} -> ${L(novo)}`)
    }
  }
  const reg={...p,ganhos,trocas,perdas}
  if(ganhos.length&&!trocas.length&&!perdas.length) soGanho.push(reg)
  else if(trocas.length||perdas.length) comTroca.push(reg)
  else semNada.push(reg)
}
console.log(`SO ACRESCENTA (reconciliar e seguro): ${soGanho.length}`)
console.log(`com TROCA/PERDA (decisao humana):     ${comTroca.length}`)
console.log(`ja em dia (nada a fazer):             ${semNada.length}`)
console.log('\n--- SO ACRESCENTA ---')
soGanho.forEach(x=>console.log(`  ${x.nome} (${x.mat}) dia ${x.dia} [${x.status}]  ${x.ganhos.join(' | ')}`))
console.log('\n--- COM TROCA/PERDA ---')
comTroca.forEach(x=>console.log(`  ${x.nome} (${x.mat}) dia ${x.dia} [${x.status}]\n      ganhos: ${x.ganhos.join(' | ')||'—'}\n      trocas: ${x.trocas.join(' | ')||'—'}\n      perdas: ${x.perdas.join(' | ')||'—'}`))
fs.writeFileSync('scratchpad/_fase4_ensaio.json',JSON.stringify({soGanho,comTroca,semNada},null,1))
