// Prototipo do painel "quem esta escalado onde nao consegue bater". Valida os numeros ANTES de
// escrever a migration. SOMENTE LEITURA.
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
const q=async p=>{const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok){console.error('ERRO',p,r.status,(await r.text()).slice(0,200));process.exit(1)}return r.json()}
const pag=async(t,f)=>{const o=[];for(let i=0;;i+=1000){const r=await fetch(`${U}/rest/v1/${t}${f}&order=id`,{headers:{...H,Range:`${i}-${i+999}`}});const g=await r.json();o.push(...g);if(g.length<1000)break}return o}
const lotes=async(ids,fn)=>{const o=[];for(let i=0;i<ids.length;i+=100)o.push(...await fn(ids.slice(i,i+100)));return o}
const MES=9,ANO=2026

const unis=Object.fromEntries((await q(`unidades?select=id,nome`)).map(u=>[u.id,u.nome]))
const devs=await q(`dispositivos_rep?select=id,nome,unidade_id&ativo=eq.true`)
const ds=await q(`dispositivos_rep_setores?select=dispositivo_id,setor_id&limit=5000`)
const setDev=id=>new Set(ds.filter(x=>x.dispositivo_id===id).map(x=>x.setor_id))
const snap={}
for(const d of devs) snap[d.id]=Object.fromEntries((await pag('rep_usuarios_dispositivo',`?select=servidor_id,tem_biometria&dispositivo_id=eq.${d.id}`)).filter(u=>u.servidor_id).map(u=>[u.servidor_id,u]))

const em=await pag('escala_mensal',`?select=id,servidor_id,unidade_id,setor_id&mes=eq.${MES}&ano=eq.${ANO}`)
// dias reais por escala (categoria != Sobreaviso)
const dias={}
for(let i=0;i<em.length;i+=50){
  const b=em.slice(i,i+50)
  for(const r of await q(`escala_diaria?select=escala_mensal_id,dia,categoria&escala_mensal_id=in.(${b.map(e=>e.id).join(',')})&limit=5000`)){
    if(!r.categoria||r.categoria==='Sobreaviso')continue
    ;(dias[r.escala_mensal_id] ||= []).push(r.dia)
  }
}
const ids=[...new Set(em.map(e=>e.servidor_id))]
const servs=await lotes(ids,b=>q(`servidores?select=id,nome,matricula,unidade_id,setor_id,status&id=in.(${b.join(',')})`))
const byId=Object.fromEntries(servs.map(s=>[s.id,s]))

const linhas=[]
for(const e of em){
  const s=byId[e.servidor_id]; if(!s||s.status!=='Ativo')continue
  const d=(dias[e.id]||[]).sort((a,b)=>a-b); if(!d.length)continue   // sem dia lancado = nao conta
  const alvo=devs.filter(x=>x.unidade_id===e.unidade_id).filter(x=>{const S=setDev(x.id);return S.size===0||S.has(e.setor_id)})
  const bio=alvo.filter(x=>snap[x.id][s.id]?.tem_biometria)
  const cad=alvo.filter(x=>snap[x.id][s.id])
  let sit
  if(!alvo.length)sit='sem_relogio_no_setor'
  else if(bio.length===alvo.length)sit='ok'
  else if(!cad.length)sit='fora_do_relogio'
  else if(!bio.length)sit='sem_biometria'
  else sit='parcial'
  const ondeBate=devs.filter(x=>snap[x.id][s.id]?.tem_biometria).map(x=>unis[x.unidade_id])
  linhas.push({s,externo:s.unidade_id!==e.unidade_id,uni:unis[e.unidade_id],sit,
    primeiro:Math.min(...d),ndias:d.length,ondeBate:[...new Set(ondeBate)]})
}
console.log(`=== ${String(MES).padStart(2,'0')}/${ANO}: ${linhas.length} escalas com dia lancado ===\n`)
const ag={};for(const l of linhas)ag[l.sit]=(ag[l.sit]||0)+1
console.log('POR SITUACAO:',JSON.stringify(ag,null,0))
const naoBate=linhas.filter(l=>l.sit!=='ok')
console.log(`\nNAO CONSEGUEM BATER ONDE ESTAO ESCALADOS: ${naoBate.length} (${new Set(naoBate.map(l=>l.s.id)).size} pessoas)`)
console.log(`   destes, EXTERNOS (lotados em outra unidade): ${naoBate.filter(l=>l.externo).length}`)
console.log(`   destes, que JA BATEM em alguma outra unidade: ${naoBate.filter(l=>l.ondeBate.length).length}  <- so falta cadastrar a digital no destino`)
console.log('\nPOR UNIDADE DA ESCALA:')
const pu={};for(const l of naoBate)pu[l.uni]=(pu[l.uni]||0)+1
for(const [k,v] of Object.entries(pu).sort((a,b)=>b[1]-a[1]).slice(0,12))console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log('\nEXTERNOS QUE NAO BATEM (o caso que motivou):')
for(const l of naoBate.filter(l=>l.externo).sort((a,b)=>a.primeiro-b.primeiro))
  console.log(`  dia ${String(l.primeiro).padStart(2)} | ${String(l.s.matricula).padEnd(8)} ${l.s.nome.padEnd(38)} -> ${l.uni} | ${l.sit} | bate em: ${l.ondeBate.join(', ')||'NENHUMA'}`)
