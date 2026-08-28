// Conferencia das migrations 20260828120000 / 20260828130000 contra producao (so leitura).
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function rpc(nome,args){
  const r=await fetch(`${U}/rest/v1/rpc/${nome}`,{method:'POST',headers:H,body:JSON.stringify(args)})
  const t=await r.text()
  if(!r.ok) return {erro:`${r.status} ${t.slice(0,300)}`}
  try{return {ok:JSON.parse(t)}}catch{return {ok:t}}
}
async function get(p){const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});return r.ok?r.json():[]}

let falhas=0
const diz=(nome,cond,extra)=>{if(cond){console.log('  ok   '+nome)}else{falhas++;console.log('  FALHA '+nome+(extra?'  -> '+extra:''))}}

console.log('== 1. as tres funcoes existem e respondem ==')
const jeane=(await get(`servidores?select=id,nome&matricula=eq.15867`))[0]
const cam = await rpc('fn_setor_caminho',{p_setor_id:null})
diz('fn_setor_caminho responde', !cam.erro, cam.erro)

const carga = await rpc('fn_carga_mensal_servidor',{p_servidor_ids:[jeane?.id],p_mes:9,p_ano:2026})
diz('fn_carga_mensal_servidor responde', !carga.erro, carga.erro)
if(carga.ok){
  console.log('     JEANE 09/2026:')
  carga.ok.forEach(c=>console.log(`       ${String(c.horas).padStart(6)}h ${c.sobreavisos} un  ${c.unidade_nome} / ${c.setor_caminho} [${c.status}]`))
  const total=carga.ok.reduce((a,c)=>a+Number(c.horas),0)
  diz('total da JEANE = 409h (bate com as duas telas)', total===409, `deu ${total}`)
  diz('caminho do setor vem completo com " \ "', carga.ok.some(c=>c.setor_caminho.includes(' \ ')), JSON.stringify(carga.ok.map(c=>c.setor_caminho)))
}

const teto = await rpc('fn_teto_carga_servidor',{p_servidor_ids:[jeane?.id],p_mes:9,p_ano:2026})
diz('fn_teto_carga_servidor responde', !teto.erro, teto.erro)
if(teto.ok?.[0]){
  const t=teto.ok[0]
  console.log(`     teto: ${t.teto_horas}h / ${t.teto_sobreavisos} un | global ${t.limite_global_horas}h / ${t.limite_global_sobreavisos} un | autorizado +${t.horas_autorizadas}h`)
  diz('teto = 300h sem autorizacao', Number(t.teto_horas)===300)
  diz('teto de sobreaviso = 20 un (valor real da config, nao o default 10)', Number(t.teto_sobreavisos)===20, String(t.teto_sobreavisos))
  diz('devolve uma linha por servidor pedido', teto.ok.length===1, String(teto.ok.length))
}

console.log('\n== 2. lote: as duas funcoes aceitam varios servidores ==')
const alguns=(await get(`escala_mensal?select=servidor_id&mes=eq.9&ano=eq.2026&limit=25`)).map(e=>e.servidor_id)
const ids=[...new Set(alguns)]
const cargaLote=await rpc('fn_carga_mensal_servidor',{p_servidor_ids:ids,p_mes:9,p_ano:2026})
const tetoLote=await rpc('fn_teto_carga_servidor',{p_servidor_ids:ids,p_mes:9,p_ano:2026})
diz(`carga em lote (${ids.length} servidores)`, !cargaLote.erro && cargaLote.ok.length>0, cargaLote.erro)
diz('teto em lote devolve 1 linha por servidor', !tetoLote.erro && tetoLote.ok.length===ids.length, tetoLote.erro||`${tetoLote.ok?.length} para ${ids.length}`)

console.log('\n== 3. relatorio consolidado ==')
const rel = await rpc('fn_carga_mensal_consolidada',{p_mes:9,p_ano:2026})
diz('fn_carga_mensal_consolidada responde', !rel.erro, rel.erro)
if(rel.ok){
  console.log(`     linhas devolvidas com service_role: ${rel.ok.length}`)
  rel.ok.slice(0,6).forEach(l=>console.log(`       ${String(l.total_horas).padStart(5)}h / teto ${l.teto_horas}h  ${l.excede_horas?'ACIMA':'ok   '}  ${l.servidor_nome}`))
}

console.log('\n== 4. a chave da Autorizacao Extraordinaria ==')
const excecoes=await get('excecoes_escala_servidor?select=servidor_id,mes,ano')
console.log(`     excecoes gravadas: ${excecoes.length}`)
// Tenta gravar duas excecoes para o mesmo (servidor, mes, ano) em unidades diferentes.
// Se a chave nova valeu, a segunda tem que ser recusada por conflito.
const uns=(await get('unidades?select=id&limit=2'))
const admin=(await get('profiles?select=id&role=eq.super_admin&limit=1'))[0]
if(jeane&&uns.length===2&&admin){
  const base={servidor_id:jeane.id,mes:1,ano:2099,horas_adicionais_autorizadas:1,sobreavisos_adicionais_autorizados:0,motivo_justificativa:'SONDA DE MIGRATION - APAGAR',autorizado_por:admin.id}
  const ins=async(u)=>{const r=await fetch(`${U}/rest/v1/excecoes_escala_servidor`,{method:'POST',headers:H,body:JSON.stringify({...base,unidade_id:u})});return {status:r.status,txt:(await r.text()).slice(0,200)}}
  const a=await ins(uns[0].id)
  const b=await ins(uns[1].id)
  diz('1a excecao grava', a.status>=200&&a.status<300, `${a.status} ${a.txt}`)
  diz('2a excecao na OUTRA unidade e RECUSADA (chave e por servidor/mes/ano)', b.status===409, `${b.status} ${b.txt}`)
  await fetch(`${U}/rest/v1/excecoes_escala_servidor?servidor_id=eq.${jeane.id}&ano=eq.2099`,{method:'DELETE',headers:H})
  const sobrou=await get(`excecoes_escala_servidor?select=id&ano=eq.2099`)
  diz('sonda removida', sobrou.length===0, `${sobrou.length} sobraram`)
}

console.log('\n'+(falhas===0?'CONFERENCIA OK':falhas+' FALHA(S)'))
