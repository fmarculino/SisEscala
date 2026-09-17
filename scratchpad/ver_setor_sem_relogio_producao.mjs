import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const AN=E.NEXT_PUBLIC_SUPABASE_ANON_KEY
async function rpc(f,b,k=K){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:{apikey:k,Authorization:`Bearer ${k}`,'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();return{ok:r.ok,status:r.status,body:t}}
let f=0;const ok=(c,m)=>{console.log(`${c?' ok  ':'FALHA'} ${m}`);if(!c)f++}

const r1=await rpc('fn_setores_sem_relogio',{p_mes:null,p_ano:null})
ok(r1.ok,`fn_setores_sem_relogio executa (HTTP ${r1.status})`)
if(!r1.ok){console.log(r1.body.slice(0,200));process.exit(1)}
const orfaos=JSON.parse(r1.body)
console.log(`\n=== ${orfaos.length} SETOR(ES) SEM RELOGIO EM PRODUCAO ===`)
for(const o of orfaos)
  console.log(` ${String(o.lotados).padStart(3)} lot / ${String(o.escalados).padStart(3)} esc | ${o.unidade_nome}\n     ${o.setor_caminho}\n     forca ${o.forca_sugestao}: ${o.sugestao||'(sem sugestao)'}`)

// a sugestao de um deles, em detalhe
if(orfaos.length){
  const r2=await rpc('fn_relogios_sugeridos_para_setor',{p_setor_id:orfaos[0].setor_id})
  ok(r2.ok,`fn_relogios_sugeridos_para_setor executa`)
  if(r2.ok){const s=JSON.parse(r2.body)
    console.log(`\n=== SUGESTOES PARA "${orfaos[0].setor_caminho}" ===`)
    for(const x of s) console.log(`   forca ${x.forca}  ${x.dispositivo_nome} — ${x.motivo}`)}
}
// fn_setor_sem_relogio concorda
if(orfaos.length){
  const r3=await rpc('fn_setor_sem_relogio',{p_setor_id:orfaos[0].setor_id})
  ok(r3.ok && r3.body==='true', `fn_setor_sem_relogio concorda com a lista (-> ${r3.body})`)
}
// anon fora das quatro
if(AN){
  for(const [fn,arg] of [['fn_setores_sem_relogio',{p_mes:null,p_ano:null}],['fn_relogios_sugeridos_para_setor',{p_setor_id:'00000000-0000-0000-0000-000000000000'}],['fn_setor_sem_relogio',{p_setor_id:'00000000-0000-0000-0000-000000000000'}],['fn_vincular_setor_a_relogios',{p_setor_id:'00000000-0000-0000-0000-000000000000',p_dispositivo_ids:[]}]]){
    const a=await rpc(fn,arg,AN); ok(a.status===401,`anon recebe 401 em ${fn} (recebeu ${a.status})`)
  }
}
// guard: nenhum relogio informado
const r4=await rpc('fn_vincular_setor_a_relogios',{p_setor_id:orfaos[0]?.setor_id||'00000000-0000-0000-0000-000000000000',p_dispositivo_ids:[]})
ok(!r4.ok && /Nenhum relogio informado|nao encontrado/i.test(r4.body), `recusa lista vazia -> ${r4.body.slice(0,70)}`)
console.log(f?`\n${f} FALHA(S)`:'\nMIGRATION 20260915140000 OK em producao');process.exit(f?1:0)
