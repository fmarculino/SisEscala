// Confere se o relogio do CCE tem cadastro que nao e do CCE (06/09/2026). SO LEITURA.
// PAGINA todas as consultas: rep_usuarios_dispositivo tem 3,4 mil linhas e o PostgREST
// corta em 1000 EM SILENCIO (CLAUDE.md armadilha 8).
import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1',K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});const t=await r.text();if(!r.ok)throw new Error(p.slice(0,90)+' '+r.status+' '+t.slice(0,200));const pg=JSON.parse(t);out.push(...pg);if(pg.length<1000)break}return out}
const CCE='8a85f2e8-f06a-4301-83c9-ec8881e9d3e9', HMM='f248c6d1-952b-42de-b53b-11738625deff'
const hmm=(await q('dispositivos_rep?select=id,nome,unidade_id,endereco_ip,coletor_host,coletor_ip,coletor_versao,ultimo_contato_em&ativo=eq.true')).filter(d=>d.unidade_id===HMM)
console.log('=== dispositivos do HMM e quem os coleta ===')
for(const d of hmm) console.log(` ${d.nome.padEnd(22)} rele=${d.endereco_ip.padEnd(15)} maquina=${(d.coletor_host||'?').padEnd(16)} ${(d.coletor_ip||'?').padEnd(15)} v${d.coletor_versao} ult=${(d.ultimo_contato_em||'').slice(0,16)}`)
const s=await q(`rep_usuarios_dispositivo?dispositivo_id=eq.${CCE}&select=atualizado_em&order=atualizado_em.desc`)
console.log(`\nsnapshot do CCE: ${s.length} linhas, lido em ${s[0]?.atualizado_em}`)
const todos=await q('rep_usuarios_dispositivo?select=dispositivo_id,identificador_afd')
const idsCCE=new Set(todos.filter(x=>x.dispositivo_id===CCE).map(x=>x.identificador_afd))
console.log('\n=== sobreposicao com os outros relogios do HMM ===')
for(const d of hmm){ if(d.id===CCE) continue
  const meus=todos.filter(x=>x.dispositivo_id===d.id)
  console.log(` ${d.nome}: ${meus.length} cadastros, ${meus.filter(x=>idsCCE.has(x.identificador_afd)).length} deles tambem no CCE`)
}
