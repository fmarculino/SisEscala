// Diagnostico da troca de relogio do CCE-01 (06/09/2026). SO LEITURA em producao.
// Mostra o sintoma: snapshot vazio + vinculos vigentes = ninguem sera reenviado.
// Ver docs/planos/2026-09-06-troca-de-relogio-e-ciclo-de-vida-do-cadastro-rep.md
import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1',K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json',Prefer:'count=exact'}
async function q(p,r0='0-49'){const r=await fetch(`${U}/${p}`,{headers:{...H,Range:r0}});const t=await r.text();if(!r.ok){console.error('ERRO',p.slice(0,90),r.status,t.slice(0,250));return{rows:[],count:null}}return{rows:JSON.parse(t),count:r.headers.get('content-range')}}
const CCE='8a85f2e8-f06a-4301-83c9-ec8881e9d3e9'
console.log('=== TODAS as sincronizacoes do CCE desde 05/09 ===')
const s=await q(`rep_sincronizacoes?dispositivo_id=eq.${CCE}&iniciada_em=gte.2026-09-05&select=iniciada_em,status,nsr_inicial,nsr_final,linhas_recebidas,linhas_novas,linhas_duplicadas,marcacoes_criadas,marcacoes_orfas,coletor_versao,mensagem_erro&order=iniciada_em.asc`)
s.rows.forEach(r=>console.log(' ',JSON.stringify(r)))
console.log('\n=== fila de cadastro CCE detalhada ===')
const f=await q(`rep_cadastros_fila?dispositivo_id=eq.${CCE}&select=status,device_user_id,processado_em,erro,created_at,servidor_id&order=created_at.asc`, '0-999')
const byday={};f.rows.forEach(r=>{const k=(r.created_at||'').slice(0,10)+' '+r.status;byday[k]=(byday[k]||0)+1})
console.log(JSON.stringify(byday,null,1))
console.log('\n=== vinculos CCE detalhe ===')
const v=await q(`rep_vinculos_servidor?dispositivo_id=eq.${CCE}&select=servidor_id,identificador_afd,tem_biometria,vigente_de,vigente_ate,created_at&order=created_at.asc`, '0-999')
console.log(' primeiros 3:',JSON.stringify(v.rows.slice(0,3)))
console.log(' com biometria:',v.rows.filter(x=>x.tem_biometria).length,'de',v.rows.length)
console.log('\n=== servidores lotados nos setores do CCE (Ativos) ===')
const ds=await q(`dispositivos_rep_setores?dispositivo_id=eq.${CCE}&select=setor_id`)
const ids=ds.rows.map(x=>x.setor_id)
const serv=await q(`servidores?status=eq.Ativo&setor_id=in.(${ids.join(',')})&select=id,nome,matricula,cpf,pis_pasep,setor_id&order=nome`,'0-999')
console.log(' total ativos lotados:',serv.count)
const semCpf=serv.rows.filter(x=>!(x.cpf||'').replace(/\D/g,''))
console.log(' sem CPF:',semCpf.length)
const vs=new Set(v.rows.filter(x=>!x.vigente_ate).map(x=>x.servidor_id))
console.log(' com vinculo vigente:',serv.rows.filter(x=>vs.has(x.id)).length)
console.log(' SEM vinculo vigente:',serv.rows.filter(x=>!vs.has(x.id)).length)
