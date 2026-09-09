import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,250));const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const unis=await q('unidades?select=id,nome');const un=Object.fromEntries(unis.map(u=>[u.id,u.nome]))
const setores=await q('setores?select=id,unidade_id,parent_id,dicionario_setores(nome)')
const st={};for(const x of setores) st[x.id]={nome:x.dicionario_setores?.nome,parent:x.parent_id,uni:x.unidade_id}
const cam=id=>{const p=[];let c=id,g=0;while(c&&st[c]&&g++<10){p.unshift(st[c].nome);c=st[c].parent}return p.join(' \ ')}
const t=(await q(`terminais_locais?select=responsavel_coordenador_id,setor_id,unidade_id,updated_at`))[0]
const W=t.responsavel_coordenador_id
const p=(await q(`profiles?select=full_name,role,acesso_todas_unidades,acesso_todos_setores&id=eq.${W}`))[0]
console.log('=== RESPONSAVEL ATUAL ===')
console.log(` ${p.full_name} | todas_unidades=${p.acesso_todas_unidades} | todos_setores=${p.acesso_todos_setores}`)
console.log(` terminal atualizado em: ${new Date(new Date(t.updated_at).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,19)} (local)`)
const pu=await q(`profile_unidades?select=unidade_id&profile_id=eq.${W}`)
console.log(' unidades:', pu.map(x=>un[x.unidade_id]).join(' | ')||'(nenhuma)')
const ps=await q(`profile_setores?select=setor_id&profile_id=eq.${W}`)
console.log(' setores:'); for(const x of ps) console.log(`   - ${cam(x.setor_id)}`)
const escopoS=new Set(ps.map(x=>x.setor_id)), escopoU=new Set(pu.map(x=>x.unidade_id))

console.log('\n=== as 9 pessoas que batem nesse terminal: cobertas? ===')
const srvs=await q('servidores?select=id,nome,matricula,unidade_id,setor_id,status')
const mats=['67836','69155','68771','61533','57127','52705']
const alvo=srvs.filter(s=>s.setor_id===t.setor_id && s.status==='Ativo')
console.log(` lotados no setor do terminal: ${alvo.length}`)
for(const s of alvo){
  const okU=escopoU.has(s.unidade_id)&&p.acesso_todos_setores
  const okS=escopoS.has(s.setor_id)
  console.log(`   ${okS||okU?'OK ':'FORA'} ${s.nome.slice(0,32).padEnd(33)} ${cam(s.setor_id)}`)
}
