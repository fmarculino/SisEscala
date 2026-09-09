import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,250));const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const unis=await q('unidades?select=id,nome');const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const setores=await q('setores?select=id,unidade_id,parent_id,dicionario_setores(nome)')
const st={};for(const x of setores) st[x.id]={nome:x.dicionario_setores?.nome,parent:x.parent_id,uni:x.unidade_id}
const cam=id=>{const p=[];let c=id,g=0;while(c&&st[c]&&g++<10){p.unshift(st[c].nome);c=st[c].parent}return p.join(' \ ')}

console.log('=== CADASTROS DE SERVIDOR (LUCILIA) ===')
const srv=await q(`servidores?select=id,nome,matricula,cpf,status,unidade_id,setor_id&nome=ilike.*LUCILIA LIMA AZEVEDO*`)
for(const s of srv) console.log(` mat ${s.matricula} | ${s.status} | ${un[s.unidade_id]} / ${cam(s.setor_id)} | cpf ${s.cpf} | id ${s.id}`)

console.log('\n=== PROFILE (usuario do sistema) ===')
const P='1f7df621-a552-441c-8416-8e3f4ed07edf'
const p=(await q(`profiles?select=*&id=eq.${P}`))[0]
console.log(` ${p.full_name} | role=${p.role} | ativo=${p.ativo}`)
console.log(` acesso_todas_unidades=${p.acesso_todas_unidades} | acesso_todos_setores=${p.acesso_todos_setores}`)
console.log(` servidor_id=${p.servidor_id || '(NENHUM)'}`)
if(p.servidor_id){ const s=srv.find(x=>x.id===p.servidor_id); console.log(`   -> aponta para a matricula ${s?s.matricula:'(cadastro de outra pessoa?)'}`) }

console.log('\n=== ESCOPO CADASTRADO (profile_unidades / profile_setores) ===')
const pu=await q(`profile_unidades?select=unidade_id&profile_id=eq.${P}`)
console.log(' unidades:', pu.length? pu.map(x=>un[x.unidade_id]).join(' | ') : '(nenhuma)')
const ps=await q(`profile_setores?select=setor_id&profile_id=eq.${P}`)
console.log(' setores:')
for(const x of ps) console.log(`   - ${un[st[x.setor_id]?.uni]} / ${cam(x.setor_id)}`)
