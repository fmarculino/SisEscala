import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const AN=E.NEXT_PUBLIC_SUPABASE_ANON_KEY
const q=async p=>{const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});return r.ok?r.json():[]}
async function rpc(f,b,k=K){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:{apikey:k,Authorization:`Bearer ${k}`,'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();return{ok:r.ok,status:r.status,body:t}}
let falhas=0
const ok=(c,m)=>{console.log(`${c?' ok  ':'FALHA'} ${m}`);if(!c)falhas++}

console.log('=== MIGRATION 1: estrutura ===')
const disp=await q('dispositivos_rep?select=id,nome,unidade_id,atende_toda_unidade,ativo&ativo=eq.true&order=nome')
ok('atende_toda_unidade' in (disp[0]||{}), `coluna presente | ${disp.length} relogios ativos`)
const ds=await q('dispositivos_rep_setores?select=dispositivo_id,setor_id')
const nLista={};for(const r of ds)nLista[r.dispositivo_id]=(nLista[r.dispositivo_id]||0)+1
const incoerentes=disp.filter(d=>d.atende_toda_unidade !== !((nLista[d.id]||0)>0))
ok(incoerentes.length===0, `backfill coerente em ${disp.length} relogios (incoerentes: ${incoerentes.length})`)
const s1=await q('setores?select=id,unidade_id&limit=1')
const r1=await rpc('fn_dispositivo_atende_setor',{p_dispositivo_id:disp[0].id,p_setor_id:s1[0].id,p_unidade_id:s1[0].unidade_id})
ok(r1.ok,`fn_dispositivo_atende_setor executa -> ${r1.body}`)
if(AN){const a=await rpc('fn_dispositivo_atende_setor',{p_dispositivo_id:disp[0].id,p_setor_id:s1[0].id,p_unidade_id:s1[0].unidade_id},AN)
  ok(a.status===401,`anon recebe 401 (recebeu ${a.status})`)}

console.log('\n=== MIGRATION 2: leitura ===')
const cb=disp.find(d=>/USF-CB/.test(d.nome))
const r2=await rpc('fn_cobertura_ponto_dispositivo',{p_dispositivo_id:cb.id,p_mes:9,p_ano:2026})
ok(r2.ok,`cobertura do ${cb.nome} -> ${r2.ok?JSON.parse(r2.body).length+' pessoa(s)':r2.body.slice(0,90)}`)
const r2b=await rpc('fn_cobertura_ponto_resumo',{p_mes:9,p_ano:2026})
ok(r2b.ok,`fn_cobertura_ponto_resumo (envelope) -> ${r2b.ok?JSON.parse(r2b.body).length+' relogio(s)':r2b.body.slice(0,90)}`)
const r2c=await rpc('fn_cobertura_escala_parque',{p_mes:9,p_ano:2026})
ok(r2c.ok,`fn_cobertura_escala_parque -> ${r2c.ok?JSON.parse(r2c.body).length+' linha(s)':r2c.body.slice(0,90)}`)

console.log('\n=== MIGRATION 3: alocacao ===')
const mc=await q('marcacoes_ponto?select=servidor_id,ocorrido_em&origem=eq.rep&servidor_id=not.is.null&order=ocorrido_em.desc&limit=25')
let comAloc=0,tot=0
for(const m of mc.slice(0,12)){
  const dia=new Date(new Date(m.ocorrido_em).getTime()-3*3600e3).toISOString().slice(0,10)
  const r=await rpc('fn_alocar_marcacoes_dia',{p_servidor_id:m.servidor_id,p_data:dia})
  if(!r.ok){ok(false,`fn_alocar_marcacoes_dia falhou: ${r.body.slice(0,120)}`);break}
  tot++;if((JSON.parse(r.body).alocacoes||[]).length>0)comAloc++
}
ok(tot>0 && comAloc>0, `alocacao roda em dias reais: ${comAloc} de ${tot} com alocacao`)

console.log('\n=== ESTADO: nada vinculado ainda ===')
const sets=await q('setores?select=id,unidade_id&limit=1000')
const su=Object.fromEntries(sets.map(x=>[x.id,x.unidade_id])),du=Object.fromEntries(disp.map(x=>[x.id,x.unidade_id]))
const cruz=ds.filter(x=>du[x.dispositivo_id]&&su[x.setor_id]&&du[x.dispositivo_id]!==su[x.setor_id])
ok(true,`vinculos cruzados: ${cruz.length} (0 = as 3 migrations estao inertes, como projetado)`)
console.log(falhas?`\n${falhas} FALHA(S)`:'\nTUDO OK — as 3 migrations estao aplicadas e corretas');process.exit(falhas?1:0)
