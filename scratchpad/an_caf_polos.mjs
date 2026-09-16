import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERR',r.status,(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
async function rpc(f,b){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();if(!r.ok){console.error('RPC',f,r.status,t.slice(0,300));return null}return JSON.parse(t)}
const uni=await q('unidades?select=id,nome,ativo');const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const set=await q('setores?select=id,unidade_id,parent_id,ativo,dicionario_setores(nome)')
const sn=Object.fromEntries(set.map(s=>[s.id,{...s,nome:s.dicionario_setores?.nome||'?'}]))
const caf=set.find(s=>/^CAF/i.test(sn[s.id].nome))
const polos=set.filter(s=>s.parent_id===caf.id)
const srv=await q('servidores?select=id,nome,matricula,status,setor_id&status=eq.Ativo')
const mc=await q('marcacoes_ponto?select=servidor_id,dispositivo_id&origem=eq.rep&servidor_id=not.is.null&ocorrido_em=gte.2026-08-01')
const bate={};for(const m of mc)(bate[m.servidor_id]=bate[m.servidor_id]||new Set()).add(m.dispositivo_id)
const disp=await q('dispositivos_rep?select=id,nome,unidade_id,ativo');const dn=Object.fromEntries(disp.map(d=>[d.id,d.nome]))
const rud=await q('rep_usuarios_dispositivo?select=dispositivo_id,servidor_id,tem_biometria&servidor_id=not.is.null')
const noRel={};for(const r of rud)(noRel[r.servidor_id]=noRel[r.servidor_id]||[]).push(r)
console.log('=== RAMO CAF: um polo por linha ===')
for(const p of [caf,...polos]){
  const gente=srv.filter(s=>s.setor_id===p.id)
  console.log(`\n-- ${sn[p.id].nome}  (${gente.length} lotados ativos)`)
  for(const g of gente){
    const cad=(noRel[g.id]||[]).map(r=>`${dn[r.dispositivo_id]}${r.tem_biometria?'+bio':''}`).join(', ')||'NENHUM RELOGIO'
    const bat=[...(bate[g.id]||[])].map(d=>dn[d]).join(', ')||'zero batidas'
    console.log(`   ${g.matricula} ${g.nome.slice(0,32).padEnd(32)} cadastro: ${cad.padEnd(40)} batidas 08+09: ${bat}`)
  }
}
const cb=disp.find(d=>/USF-CB/.test(d.nome))
console.log('\n=== fn_cobertura_ponto_dispositivo do REP-iDClass-USF-CB (09/2026) ===')
const cov=await rpc('fn_cobertura_ponto_dispositivo',{p_dispositivo_id:cb.id,p_mes:9,p_ano:2026})
if(cov){const st={};for(const c of cov)st[c.situacao]=(st[c.situacao]||0)+1
  console.log(' universo:',cov.length,JSON.stringify(st))
  console.log(' algum do POLO MORADA NOVA aparece?',cov.some(c=>/JAMESON|EWERTON/i.test(c.servidor_nome||''))?'SIM':'NAO')}
