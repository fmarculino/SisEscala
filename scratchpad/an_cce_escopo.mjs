// Confere se quem esta no relogio do CCE pertence mesmo ao CCE (06/09/2026). SO LEITURA.
// Nome de setor sozinho nao identifica setor: monta o CAMINHO completo pelo parent_id.
import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1',K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});const t=await r.text();if(!r.ok)throw new Error(p.slice(0,90)+' '+r.status+' '+t.slice(0,250));const pg=JSON.parse(t);out.push(...pg);if(pg.length<1000)break}return out}
const CCE='8a85f2e8-f06a-4301-83c9-ec8881e9d3e9'

// arvore inteira, sem filtrar por unidade (um pai noutra unidade truncaria o caminho)
const setores=await q('setores?select=id,parent_id,unidade_id,ativo,dicionario_setores(nome)')
const mapa=Object.fromEntries(setores.map(s=>[s.id,s]))
const unids=Object.fromEntries((await q('unidades?select=id,nome')).map(u=>[u.id,u.nome]))
function caminho(id){const p=[];let cur=mapa[id],guard=0;while(cur&&guard++<10){p.unshift(cur.dicionario_setores?.nome||'?');cur=cur.parent_id?mapa[cur.parent_id]:null}return p.join(' \ ')}

const ds=await q(`dispositivos_rep_setores?dispositivo_id=eq.${CCE}&select=setor_id`)
console.log('=== SETORES ATENDIDOS PELO RELOGIO CCE-01 ===')
for(const {setor_id} of ds){const s=mapa[setor_id];console.log(` ${(unids[s.unidade_id]||'?').slice(0,30).padEnd(32)} ${caminho(setor_id)}${s.ativo===false?'  (INATIVO)':''}`)}

const snap=await q(`rep_usuarios_dispositivo?dispositivo_id=eq.${CCE}&select=identificador_afd,nome_no_device,tem_biometria,servidor_id,origem_match`)
const ids=[...new Set(snap.map(x=>x.servidor_id).filter(Boolean))]
const serv=ids.length?await q(`servidores?id=in.(${ids.join(',')})&select=id,nome,matricula,status,unidade_id,setor_id`):[]
const mapS=Object.fromEntries(serv.map(s=>[s.id,s]))
const setDisp=new Set(ds.map(x=>x.setor_id))

console.log(`\n=== OS ${snap.length} CADASTROS QUE ESTAO NO RELOGIO AGORA ===`)
let fora=0,semDono=0
for(const u of snap.sort((a,b)=>(a.nome_no_device||'').localeCompare(b.nome_no_device||''))){
  const s=mapS[u.servidor_id]
  if(!s){semDono++;console.log(` ?? ${(u.nome_no_device||'').padEnd(45)} ident=${u.identificador_afd}  << NAO RESOLVE PARA NENHUM SERVIDOR`);continue}
  const dentro=setDisp.has(s.setor_id)
  if(!dentro)fora++
  console.log(` ${dentro?'ok':'XX'} ${s.nome.slice(0,44).padEnd(45)} ${String(s.matricula).padEnd(9)} ${s.status.padEnd(8)} ${unids[s.unidade_id]===undefined?'?':(unids[s.unidade_id]||'').slice(0,20).padEnd(22)} ${caminho(s.setor_id)}`)
}
console.log(`\n  fora do escopo do dispositivo: ${fora}   sem dono: ${semDono}   total: ${snap.length}`)
