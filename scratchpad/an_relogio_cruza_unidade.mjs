import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERR',r.status,p.slice(0,80),(await r.text()).slice(0,200));return out}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}

const uni=await q('unidades?select=id,nome,ativo')
const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))
const set=await q('setores?select=id,unidade_id,parent_id,ativo,dicionario_setores(nome)')
const sn=Object.fromEntries(set.map(s=>[s.id,{...s,nome:s.dicionario_setores?.nome||'?'}]))
const caminho=id=>{const p=[];let c=sn[id],g=0;while(c&&g++<10){p.unshift(c.nome);c=c.parent_id?sn[c.parent_id]:null}return p.join(' \ ')}

const disp=await q('dispositivos_rep?select=id,nome,unidade_id,ativo,ponto_valido_desde,endereco_ip,ultimo_contato_em')
const ds=await q('dispositivos_rep_setores?select=dispositivo_id,setor_id')
const porDisp={};for(const r of ds)(porDisp[r.dispositivo_id]=porDisp[r.dispositivo_id]||[]).push(r.setor_id)

console.log('=== RELOGIOS COM "CB"/CARLOS BARRETO ===')
for(const d of disp.filter(d=>/CB|CARLOS/i.test(d.nome)))
  console.log(` ${d.nome} | unidade=${un[d.unidade_id]} | ativo=${d.ativo} | setores=${(porDisp[d.id]||[]).length||'TODA A UNIDADE'} | ip=${d.endereco_ip} | contato=${d.ultimo_contato_em}`)

console.log('\n=== SETORES "MORADA NOVA" ===')
for(const s of set.filter(s=>/MORADA NOVA/i.test(s.dicionario_setores?.nome||'')))
  console.log(` ${un[s.unidade_id]} :: ${caminho(s.id)} | ativo=${s.ativo} | id=${s.id}`)

console.log('\n=== PARQUE: total ===')
console.log(` unidades=${uni.length} setores=${set.length} dispositivos=${disp.length} (ativos ${disp.filter(d=>d.ativo).length})`)
const semSetor=disp.filter(d=>d.ativo&&!(porDisp[d.id]||[]).length).length
console.log(` relogios ativos "toda a unidade": ${semSetor} | com setores listados: ${disp.filter(d=>d.ativo).length-semSetor}`)
const fora=ds.filter(r=>{const d=disp.find(x=>x.id===r.dispositivo_id);return d&&sn[r.setor_id]&&sn[r.setor_id].unidade_id!==d.unidade_id})
console.log(` vinculos dispositivo->setor de OUTRA unidade hoje: ${fora.length}`)
