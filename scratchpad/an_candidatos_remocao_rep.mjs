// Candidatos REAIS a remocao do relogio (06/09/2026). SO LEITURA em producao.
// Criterio: no snapshot do equipamento e NAO pertence a ele - lotacao UNIAO escala,
// menos rep_administradores_parque. Pelo criterio de lotacao pura daria 140 (125 sao
// Servidor Externo, que bate ponto ali legitimamente). Medido: 15.
import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1',K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});const t=await r.text();if(!r.ok){console.error('ERRO',p.slice(0,90),r.status,t.slice(0,200));return out}const pg=JSON.parse(t);out.push(...pg);if(pg.length<1000)break}return out}
const disp=await q('dispositivos_rep?select=id,nome,unidade_id&ativo=eq.true&order=nome')
const snap=await q('rep_usuarios_dispositivo?select=dispositivo_id,servidor_id')
const serv=await q('servidores?select=id,nome,matricula,status,unidade_id,setor_id')
const mapS=Object.fromEntries(serv.map(s=>[s.id,s]))
const ds=await q('dispositivos_rep_setores?select=dispositivo_id,setor_id')
const setoresPorDisp={}; ds.forEach(r=>{(setoresPorDisp[r.dispositivo_id]=setoresPorDisp[r.dispositivo_id]||new Set()).add(r.setor_id)})
const adm=await q('rep_administradores_parque?select=servidor_id')
const admSet=new Set(adm.map(a=>a.servidor_id))
// escalas dos ultimos 3 meses por (servidor, unidade)
const em=await q('escala_mensal?select=servidor_id,unidade_id,mes,ano&ano=eq.2026&mes=in.(7,8,9)')
const escalaUn={}; em.forEach(e=>{(escalaUn[e.servidor_id]=escalaUn[e.servidor_id]||new Set()).add(e.unidade_id)})

console.log('=== CANDIDATOS REAIS A REMOCAO (no snapshot do relogio, mas nao pertencem: nao-Ativo OU lotado fora E sem escala naquela unidade em 07-09/2026 E nao e admin do parque) ===')
let tot=0; const det={}
for(const u of snap){
  if(!u.servidor_id) continue
  const s=mapS[u.servidor_id]; if(!s) continue
  const d=disp.find(x=>x.id===u.dispositivo_id); if(!d) continue
  if(admSet.has(s.id)) continue
  let motivo=null
  if(s.status!=='Ativo') motivo='status='+s.status
  else {
    const sets=setoresPorDisp[d.id]
    const dentro=sets?sets.has(s.setor_id):(s.unidade_id===d.unidade_id)
    const temEscala=(escalaUn[s.id]||new Set()).has(d.unidade_id)
    if(!dentro && !temEscala) motivo='lotado fora e sem escala aqui'
  }
  if(motivo){ (det[d.nome]=det[d.nome]||[]).push(`${s.nome} [${s.matricula}] ${motivo}`); tot++ }
}
for(const [k,v] of Object.entries(det)) console.log(`  ${k}: ${v.length}\n     ${v.slice(0,10).join('\n     ')}${v.length>10?`\n     ... +${v.length-10}`:''}`)
console.log('  TOTAL:',tot)
console.log('\n=== admins do parque ===', admSet.size)
console.log('=== fila de remocao existente ===')
const rf=await q('rep_remocoes_fila?select=status')
const a={};rf.forEach(r=>a[r.status]=(a[r.status]||0)+1);console.log(JSON.stringify(a))
