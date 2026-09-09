import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error(r.status,(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
const t=await q(`logs_tentativas_presenca?select=coordenador_id,coordenador_nome,unidade_nome,setor_nome,data_hora_tentativa&mensagem_erro=ilike.*Sem permiss*`)
const porCoord={}
for(const x of t){const k=`${x.coordenador_nome||'(sem nome)'} | ${x.coordenador_id||'(sem id)'}`;porCoord[k]=(porCoord[k]||0)+1}
console.log('=== COORDENADOR QUE ATIVOU O TERMINAL ===')
for(const [k,n] of Object.entries(porCoord).sort((a,b)=>b[1]-a[1])) console.log(` ${String(n).padStart(3)} ${k}`)
console.log('\nunidade_nome/setor_nome gravados no log:', JSON.stringify([...new Set(t.map(x=>`${x.unidade_nome}|${x.setor_nome}`))]))

const ids=[...new Set(t.map(x=>x.coordenador_id).filter(Boolean))]
for(const id of ids){
  const p=(await q(`profiles?select=id,full_name,role,acesso_todas_unidades,acesso_todos_setores,ativo&id=eq.${id}`))[0]
  if(!p){console.log('\nprofile',id,'NAO ENCONTRADO');continue}
  console.log(`\n=== PERFIL ${p.full_name} (${p.email}) ===`)
  console.log(`  role=${p.role} | todas_unidades=${p.acesso_todas_unidades} | todos_setores=${p.acesso_todos_setores} | ativo=${p.ativo}`)
  const pu=await q(`profile_unidades?select=unidade_id,unidades(nome)&profile_id=eq.${id}`)
  console.log('  unidades vinculadas:', pu.length ? pu.map(x=>x.unidades?.nome).join(' | ') : '(NENHUMA)')
  const ps=await q(`profile_setores?select=setor_id&profile_id=eq.${id}`)
  console.log('  setores vinculados:', ps.length)
  if(ps.length){
    const ids2=ps.map(x=>x.setor_id)
    const st=await q(`setores?select=id,unidade_id,dicionario_setores(nome)&id=in.(${ids2.join(',')})`)
    for(const x of st) console.log('    -', x.dicionario_setores?.nome, x.id)
  }
}
console.log('\n=== os 3 setores das pessoas recusadas ===')
for(const sid of ['0dd13187-24af-4d58-b106-0e5c67de59d3','e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf','fc046b26-c42e-4354-aa9d-e2e46945f956']){
  const s=(await q(`setores?select=id,unidade_id,parent_id,ativo,dicionario_setores(nome)&id=eq.${sid}`))[0]
  console.log(` ${sid} -> ${s?.dicionario_setores?.nome} (ativo=${s?.ativo}, parent=${s?.parent_id})`)
}
