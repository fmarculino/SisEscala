// Servidor Externo (escalado numa unidade, lotado em outra): ele consegue bater ponto na unidade
// onde foi escalado? SOMENTE LEITURA.
import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
const q=async p=>{const r=await fetch(`${U}/rest/v1/${p}`,{headers:H});if(!r.ok){console.error('ERRO',p,r.status,(await r.text()).slice(0,250));process.exit(1)}return r.json()}
const pag=async(t,f)=>{const o=[];for(let i=0;;i+=1000){const r=await fetch(`${U}/rest/v1/${t}${f}&order=id`,{headers:{...H,Range:`${i}-${i+999}`}});const g=await r.json();o.push(...g);if(g.length<1000)break}return o}
const lotes=async(ids,fn)=>{const o=[];for(let i=0;i<ids.length;i+=100)o.push(...await fn(ids.slice(i,i+100)));return o}

const unis=Object.fromEntries((await q(`unidades?select=id,nome`)).map(u=>[u.id,u.nome]))
const devs=await q(`dispositivos_rep?select=id,nome,unidade_id,ativo,coletor_host&ativo=eq.true`)
const ds=await q(`dispositivos_rep_setores?select=dispositivo_id,setor_id&limit=5000`)
const setoresDoDev=id=>new Set(ds.filter(x=>x.dispositivo_id===id).map(x=>x.setor_id))

for(const [mes,ano] of [[9,2026]]){
  const em=await pag('escala_mensal',`?select=servidor_id,unidade_id,setor_id,mes,ano&mes=eq.${mes}&ano=eq.${ano}`)
  const ids=[...new Set(em.map(e=>e.servidor_id))]
  const servs=await lotes(ids,b=>q(`servidores?select=id,nome,matricula,unidade_id,setor_id,status&id=in.(${b.join(',')})`))
  const byId=Object.fromEntries(servs.map(s=>[s.id,s]))
  const ext=em.filter(e=>byId[e.servidor_id]&&byId[e.servidor_id].unidade_id!==e.unidade_id)
  const extIds=[...new Set(ext.map(e=>e.servidor_id))]
  console.log(`=== ${String(mes).padStart(2,'0')}/${ano}: ${em.length} escalas, ${ids.length} servidores ===`)
  console.log(`  SERVIDORES EXTERNOS: ${extIds.length} pessoas em ${ext.length} escalas\n`)
  if(!extIds.length) continue

  // snapshot de todos os dispositivos, so para os externos
  const snap={}
  for(const d of devs) snap[d.id]=Object.fromEntries(
    (await pag('rep_usuarios_dispositivo',`?select=servidor_id,tem_biometria&dispositivo_id=eq.${d.id}`)).filter(u=>u.servidor_id).map(u=>[u.servidor_id,u]))

  const res={pronto:[],semBioDestino:[],semCadastroDestino:[],semRelogioDestino:[],semBioNenhum:[]}
  for(const e of ext){
    const s=byId[e.servidor_id]
    // relogios que atendem o SETOR da escala, na unidade da escala
    const alvo=devs.filter(d=>d.unidade_id===e.unidade_id).filter(d=>{const S=setoresDoDev(d.id);return S.size===0||S.has(e.setor_id)})
    // relogios de casa onde ele tem digital
    const casa=devs.filter(d=>snap[d.id][e.servidor_id]?.tem_biometria)
    const item={s,destino:unis[e.unidade_id],alvo:alvo.map(d=>d.nome),casa:casa.map(d=>d.nome)}
    if(!alvo.length){res.semRelogioDestino.push(item);continue}
    const cad=alvo.filter(d=>snap[d.id][e.servidor_id])
    const bio=alvo.filter(d=>snap[d.id][e.servidor_id]?.tem_biometria)
    if(bio.length===alvo.length)res.pronto.push(item)
    else if(!cad.length)res.semCadastroDestino.push(item)
    else if(!casa.length)res.semBioNenhum.push(item)
    else res.semBioDestino.push(item)
  }
  const P=(k,rot)=>{console.log(`  ${rot}: ${res[k].length}`)
    for(const i of res[k].slice(0,12)) console.log(`      ${String(i.s.matricula).padEnd(8)} ${i.s.nome.padEnd(38)} -> ${i.destino} [${i.alvo.join('/')}]  digital em: ${i.casa.join('/')||'NENHUM'}`)
    if(res[k].length>12)console.log(`      ... +${res[k].length-12}`)}
  P('pronto',            '✅ consegue bater no destino          ')
  P('semBioDestino',     '🔴 tem digital em CASA, falta no DESTINO')
  P('semCadastroDestino','🟡 nem cadastro no relogio do destino ')
  P('semBioNenhum',      '🔴 sem digital em lugar nenhum        ')
  P('semRelogioDestino', 'ℹ️ destino sem relogio no setor       ')
}
