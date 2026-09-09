import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,200));const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const SETOR='0dd13187-24af-4d58-b106-0e5c67de59d3'   // POLO II - VELHA MARABÁ
const CAF  ='fc046b26-c42e-4354-aa9d-e2e46945f956'   // CAF (pai)
const unis=await q('unidades?select=id,nome');const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const SMS=unis.find(u=>u.nome.startsWith('SMS'))?.id

console.log('=== quem TEM escopo para o setor POLO II - VELHA MARABA ===')
const ps=await q(`profile_setores?select=profile_id&setor_id=in.(${SETOR},${CAF})`)
const ids=[...new Set(ps.map(x=>x.profile_id))]
for(const id of ids){
  const p=(await q(`profiles?select=id,full_name,role,ativo,acesso_todos_setores,acesso_todas_unidades&id=eq.${id}`))[0]
  if(p) console.log(`  ${p.full_name} | ${p.role} | ativo=${p.ativo}`)
}
console.log(`(por vinculo direto ao setor ou ao CAF: ${ids.length})`)

console.log('\n=== coordenadores da SMS com acesso a TODOS os setores ===')
const pu=await q(`profile_unidades?select=profile_id&unidade_id=eq.${SMS}`)
let n=0
for(const x of [...new Set(pu.map(y=>y.profile_id))]){
  const p=(await q(`profiles?select=full_name,role,ativo,acesso_todos_setores&id=eq.${x}`))[0]
  if(p && p.acesso_todos_setores && p.ativo){ console.log(`  ${p.full_name} | ${p.role}`); n++ }
}
console.log(`(total: ${n})`)

console.log('\n=== o responsavel ATUAL do terminal ===')
const l=(await q(`profiles?select=full_name,role,ativo,acesso_todas_unidades,acesso_todos_setores&id=eq.1f7df621-a552-441c-8416-8e3f4ed07edf`))[0]
console.log(` ${l.full_name} | ${l.role} | ativo=${l.ativo} | todas_unidades=${l.acesso_todas_unidades} | todos_setores=${l.acesso_todos_setores}`)
const lu=await q(`profile_unidades?select=unidade_id&profile_id=eq.1f7df621-a552-441c-8416-8e3f4ed07edf`)
console.log(` unidades: ${lu.map(x=>un[x.unidade_id]).join(', ')||'(nenhuma)'}`)
