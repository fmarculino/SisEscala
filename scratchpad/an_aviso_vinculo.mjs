import { env } from './_env.mjs'
import { vinculosForaDoEscopo, descreverVinculosForaDoEscopo } from './_sim/vinculosDoUsuario.js'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,200));const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const unis=await q('unidades?select=id,nome');const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const setores=await q('setores?select=id,unidade_id')
const mapa=new Map(setores.map(s=>[s.id,s.unidade_id]))
const srvs=(await q('servidores?select=id,nome,matricula,cpf,unidade_id,status,mesclado_em_servidor_id'))
  .filter(s=>s.status==='Ativo'&&!s.mesclado_em_servidor_id)
  .map(s=>({...s,unidade_nome:un[s.unidade_id]}))
const profs=await q('profiles?select=id,full_name,role,ativo,servidor_id,acesso_todas_unidades')
const pu=await q('profile_unidades?select=profile_id,unidade_id')
const ps=await q('profile_setores?select=profile_id,setor_id')
const uPor={},sPor={}
for(const x of pu)(uPor[x.profile_id]=uPor[x.profile_id]||[]).push(x.unidade_id)
for(const x of ps)(sPor[x.profile_id]=sPor[x.profile_id]||[]).push(x.setor_id)

console.log('=== SIMULANDO O AVISO em todas as contas vinculadas ===')
let comAviso=0, total=0
for(const p of profs){
  if(!p.servidor_id) continue
  total++
  const fora=vinculosForaDoEscopo(p.servidor_id, srvs,
    {acessoTodasUnidades:!!p.acesso_todas_unidades, unidadeIds:uPor[p.id]||[], setorIds:sPor[p.id]||[]}, mapa)
  if(!fora.length) continue
  comAviso++
  console.log(`\n  ${p.full_name} | ${p.role} | ativo=${p.ativo}`)
  console.log(`    ${descreverVinculosForaDoEscopo(fora)}`)
}
console.log(`\ncontas vinculadas a um servidor: ${total}`)
console.log(`contas em que o aviso apareceria: ${comAviso}`)
