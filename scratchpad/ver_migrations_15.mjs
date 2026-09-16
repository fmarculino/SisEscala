import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function rpc(f,b,hdr=H){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:hdr,body:JSON.stringify(b)});return {ok:r.ok,status:r.status,body:await r.text()}}
let falhas=0
const ok=(c,m)=>{console.log(`${c?' ok ':'FALHA'}  ${m}`);if(!c)falhas++}

// 1. coluna existe?
const d=await (await fetch(`${U}/rest/v1/dispositivos_rep?select=id,nome,unidade_id,atende_toda_unidade&ativo=eq.true&order=nome`,{headers:H})).json()
ok(Array.isArray(d)&&d.length>0&&'atende_toda_unidade' in d[0], `coluna atende_toda_unidade presente (${d.length} relogios ativos)`)
const toda=d.filter(x=>x.atende_toda_unidade).length
ok(toda+(d.length-toda)===d.length, `backfill: ${toda} "toda a unidade" + ${d.length-toda} com lista = ${d.length}`)

// 2. predicado novo responde
const s=await (await fetch(`${U}/rest/v1/setores?select=id,unidade_id&limit=1`,{headers:H})).json()
const r1=await rpc('fn_dispositivo_atende_setor',{p_dispositivo_id:d[0].id,p_setor_id:s[0].id,p_unidade_id:s[0].unidade_id})
ok(r1.ok, `fn_dispositivo_atende_setor executa (HTTP ${r1.status}) -> ${r1.body}`)

// 3. anon nao executa
const anon=E.NEXT_PUBLIC_SUPABASE_ANON_KEY
if(anon){const r2=await rpc('fn_dispositivo_atende_setor',{p_dispositivo_id:d[0].id,p_setor_id:s[0].id,p_unidade_id:s[0].unidade_id},{apikey:anon,Authorization:`Bearer ${anon}`,'Content-Type':'application/json'})
  ok(!r2.ok&&r2.status===401, `anon recebe 401 (recebeu ${r2.status})`)}

// 4. cobertura do relogio do CB continua funcionando
const cb=d.find(x=>/USF-CB/.test(x.nome))
const r3=await rpc('fn_cobertura_ponto_dispositivo',{p_dispositivo_id:cb.id,p_mes:9,p_ano:2026})
ok(r3.ok, `fn_cobertura_ponto_dispositivo do ${cb.nome} executa -> ${r3.ok?JSON.parse(r3.body).length+' pessoa(s)':r3.body.slice(0,120)}`)

// 5. nenhum vinculo cruzado ainda
const ds=await (await fetch(`${U}/rest/v1/dispositivos_rep_setores?select=dispositivo_id,setor_id`,{headers:H})).json()
const sets=await (await fetch(`${U}/rest/v1/setores?select=id,unidade_id&limit=1000`,{headers:H})).json()
const su=Object.fromEntries(sets.map(x=>[x.id,x.unidade_id])), du=Object.fromEntries(d.map(x=>[x.id,x.unidade_id]))
const cruz=ds.filter(x=>du[x.dispositivo_id]&&su[x.setor_id]&&du[x.dispositivo_id]!==su[x.setor_id]).length
ok(cruz===0, `vinculos cruzados: ${cruz} (esperado 0 - nada vinculado ainda)`)

console.log(falhas? `\n${falhas} FALHA(S)`:'\nTUDO OK');process.exit(falhas?1:0)
