import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
const AN=E.NEXT_PUBLIC_SUPABASE_ANON_KEY
async function rpc(f,b,k=K){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:{apikey:k,Authorization:`Bearer ${k}`,'Content-Type':'application/json'},body:JSON.stringify(b)});return{ok:r.ok,status:r.status,body:await r.text()}}
const q=async p=>{const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});return r.ok?r.json():[]}
let f=0;const ok=(c,m)=>{console.log(`${c?' ok  ':'FALHA'} ${m}`);if(!c)f++}

const d=await q('dispositivos_rep?select=id,nome,unidade_id,atende_toda_unidade&ativo=eq.true&order=nome')
// assinatura nova responde (2 args -> DEFAULT; e o que o deploy ATUAL ainda manda)
const r2=await rpc('fn_definir_setores_dispositivo_rep',{p_dispositivo_id:d[0].id,p_setor_ids:null})
ok(r2.status!==404 && !/PGRST202/.test(r2.body), `chamada de 2 args ainda resolve (status ${r2.status})`)
// 3 args existe
const r3=await rpc('fn_definir_setores_dispositivo_rep',{p_dispositivo_id:'00000000-0000-0000-0000-000000000000',p_setor_ids:[],p_atende_toda_unidade:true})
ok(/nao encontrado/i.test(r3.body), `assinatura de 3 args existe e valida o dispositivo -> ${r3.body.slice(0,70)}`)
// anon fora
if(AN){const a=await rpc('fn_definir_setores_dispositivo_rep',{p_dispositivo_id:d[0].id,p_setor_ids:[],p_atende_toda_unidade:true},AN)
  ok(a.status===401,`anon recebe 401 (recebeu ${a.status})`)}
// guard do relogio orfao (sem escrever: dispositivo real, lista vazia, toda=false -> tem que RECUSAR)
const alvo=d.find(x=>x.atende_toda_unidade)||d[0]
const r4=await rpc('fn_definir_setores_dispositivo_rep',{p_dispositivo_id:alvo.id,p_setor_ids:[],p_atende_toda_unidade:false})
ok(!r4.ok && /sem atender nenhum setor/i.test(r4.body), `recusa relogio sem nenhum setor -> ${r4.body.slice(0,80)}`)
// nada mudou
const dep=await q(`dispositivos_rep?select=id,atende_toda_unidade&id=eq.${alvo.id}`)
ok(dep[0].atende_toda_unidade===alvo.atende_toda_unidade, `a recusa nao alterou o dispositivo (${alvo.nome})`)
const ds=await q('dispositivos_rep_setores?select=dispositivo_id,setor_id')
const sets=await q('setores?select=id,unidade_id&limit=1000')
const su=Object.fromEntries(sets.map(x=>[x.id,x.unidade_id])),du=Object.fromEntries(d.map(x=>[x.id,x.unidade_id]))
ok(true, `vinculos cruzados hoje: ${ds.filter(x=>du[x.dispositivo_id]&&su[x.setor_id]&&du[x.dispositivo_id]!==su[x.setor_id]).length}`)
console.log(f?`\n${f} FALHA(S)`:'\nMIGRATION 4 OK em producao');process.exit(f?1:0)
