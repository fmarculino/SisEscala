// FASE 4 - aplica reconciliacao SOMENTE nos pares (servidor, dia) em que ela e ACRESCIMO PURO.
//
// 🚨 Lista FECHADA e pre-condicao dura: se o estado tiver mudado desde o ensaio, ABORTA sem
// escrever. Reconciliacao em massa esta proibida (armadilha 46: medido em 03/09/2026, massa deu
// 4 ganhos contra 43 trocas e 7 perdas).
//
// Par com TROCA ou PERDA nao entra aqui de proposito -- decidir que uma batida sai do passo e
// juizo sobre a conduta do servidor, e isso e do RH, na tela.
import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const rpc=async(n,b)=>{const r=await fetch(`${U}/rest/v1/rpc/${n}`,{method:'POST',headers:H,body:JSON.stringify(b)});return r.ok?await r.json():null}
const q=async p=>(await fetch(`${U}/rest/v1/${p}`,{headers:H})).json()
const L=iso=>iso?new Date(new Date(iso).getTime()-3*3600e3).toISOString().slice(5,16).replace('T',' '):'—'
const CAMPOS=[['entrada_em','presenca_entrada_em'],['int_saida_em','presenca_intervalo_saida_em'],
  ['int_ret_em','presenca_intervalo_retorno_em'],['saida_em','presenca_saida_em']]

const APLICAR = process.argv.includes('--aplicar')
const { soGanho } = JSON.parse(fs.readFileSync('scratchpad/_fase4_ensaio.json','utf8'))
console.log(`${soGanho.length} pares na lista fechada${APLICAR?'  [APLICANDO]':'  [ENSAIO — use --aplicar]'}\n`)

const delta = async (serv, dia) => {
  const data=`2026-09-${String(dia).padStart(2,'0')}`
  const proj=await rpc('fn_projecao_marcacoes_dia',{p_servidor_id:serv,p_data:data})
  if(!proj?.length) return null
  const eds=await q(`escala_diaria?select=id,categoria,presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em&id=in.(${proj.map(x=>x.escala_diaria_id).join(',')})`)
  const byId=new Map(eds.map(e=>[e.id,e]))
  const g=[],t=[],p=[]
  for(const pr of proj){ const ed=byId.get(pr.escala_diaria_id); if(!ed) continue
    for(const [cp,ce] of CAMPOS){ const novo=pr[cp]||null, atual=ed[ce]||null
      if(novo===atual) continue
      if(atual===null) g.push(`${ed.categoria}.${ce}: — -> ${L(novo)}`)
      else if(novo===null) p.push(`${ed.categoria}.${ce}: ${L(atual)} -> —`)
      else t.push(`${ed.categoria}.${ce}: ${L(atual)} -> ${L(novo)}`) } }
  return {g,t,p}
}

let aplicados=0, abortados=0
for(const c of soGanho){
  const antes=await delta(c.serv,c.dia)
  if(!antes){ console.log(`  ABORTA ${c.nome} dia ${c.dia}: sem projecao`); abortados++; continue }
  // PRE-CONDICAO: continua sendo acrescimo puro, e com os MESMOS ganhos do ensaio?
  if(antes.t.length||antes.p.length){
    console.log(`  ABORTA ${c.nome} dia ${c.dia}: deixou de ser acrescimo puro (trocas=${antes.t.length} perdas=${antes.p.length})`)
    abortados++; continue }
  if(antes.g.length!==c.ganhos.length){
    console.log(`  ABORTA ${c.nome} dia ${c.dia}: o ensaio previa ${c.ganhos.length} ganho(s), agora sao ${antes.g.length}`)
    abortados++; continue }

  console.log(`  ${c.nome} (${c.mat}) dia ${c.dia}: ${antes.g.join(' | ')}`)
  if(!APLICAR) continue

  const r=await rpc('fn_reconciliar_marcacoes_dia',{p_servidor_id:c.serv,p_data:`2026-09-${String(c.dia).padStart(2,'0')}`})
  const depois=await delta(c.serv,c.dia)
  if(depois && (depois.g.length||depois.t.length||depois.p.length)){
    console.log(`    XX  sobrou divergencia depois de aplicar: ${JSON.stringify(depois)}`)
  } else {
    console.log(`    OK  aplicado (status=${r?.status}, linhas=${r?.atualizadas})`)
    aplicados++
  }
}
console.log(`\n${APLICAR?`aplicados: ${aplicados}`:'ensaio'} | abortados: ${abortados}`)
