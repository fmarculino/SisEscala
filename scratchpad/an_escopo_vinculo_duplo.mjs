import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,250));const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const unis=await q('unidades?select=id,nome');const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const setores=await q('setores?select=id,unidade_id');const setUni=Object.fromEntries(setores.map(s=>[s.id,s.unidade_id]))
const srvs=await q('servidores?select=id,nome,matricula,cpf,status,unidade_id,setor_id,mesclado_em_servidor_id')
const profs=await q('profiles?select=id,full_name,role,ativo,servidor_id,acesso_todas_unidades,acesso_todos_setores')
const pu=await q('profile_unidades?select=profile_id,unidade_id')
const ps=await q('profile_setores?select=profile_id,setor_id')

const uniPorProf={},setPorProf={}
for(const x of pu)(uniPorProf[x.profile_id]=uniPorProf[x.profile_id]||new Set()).add(x.unidade_id)
for(const x of ps)(setPorProf[x.profile_id]=setPorProf[x.profile_id]||new Set()).add(x.setor_id)

// cadastros ATIVOS por CPF (ignorando mesclados)
const porCpf={}
for(const s of srvs){ if(!s.cpf||s.status!=='Ativo'||s.mesclado_em_servidor_id) continue
  (porCpf[s.cpf]=porCpf[s.cpf]||[]).push(s) }
const multi=Object.entries(porCpf).filter(([,v])=>v.length>1)
console.log('CPFs com 2+ cadastros ativos:', multi.length)

const srvById=Object.fromEntries(srvs.map(s=>[s.id,s]))
console.log('\n=== CONTAS DE USUARIO cujo dono tem MAIS DE UM VINCULO ===')
let comConta=0, escopoParcial=0
const linhas=[]
for(const [cpf,lista] of multi){
  const p=profs.find(x=>x.servidor_id && lista.some(s=>s.id===x.servidor_id))
  if(!p) continue
  comConta++
  if(p.acesso_todas_unidades) continue     // enxerga tudo, nao ha lacuna
  const escopoU=uniPorProf[p.id]||new Set()
  const escopoS=setPorProf[p.id]||new Set()
  // unidades dos vinculos que o escopo NAO cobre (nem por unidade, nem por setor vinculado)
  const faltando=lista.filter(s=>{
    if(escopoU.has(s.unidade_id)) return false
    for(const sid of escopoS) if(setUni[sid]===s.unidade_id) return false
    return true })
  if(!faltando.length) continue
  escopoParcial++
  const dono=srvById[p.servidor_id]
  linhas.push({p,lista,faltando,dono})
}
console.log(`com conta de usuario: ${comConta}`)
console.log(`ESCOPO NAO COBRE algum dos vinculos: ${escopoParcial}`)
for(const L of linhas){
  console.log(`\n  ${L.p.full_name} | ${L.p.role} | ativo=${L.p.ativo}`)
  console.log(`    conta aponta para: mat ${L.dono?.matricula} (${un[L.dono?.unidade_id]})`)
  for(const s of L.lista) console.log(`    vinculo mat ${s.matricula}: ${un[s.unidade_id]}${L.faltando.includes(s)?'   <-- FORA DO ESCOPO DA CONTA':''}`)
}
