import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
async function q(p){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,200));const g=await r.json();out.push(...g);if(g.length<1000)break}return out}
async function rpc(f,b){const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});const t=await r.text();return {status:r.status,body:t.slice(0,200)}}
const loc=s=>s?new Date(new Date(s).getTime()-3*3600e3).toISOString().replace('T',' ').slice(0,16):'—'

console.log('=== 1. fn_confirmar_presenca EXECUTA (matricula inexistente, nao escreve nada) ===')
const r1=await rpc('fn_confirmar_presenca',{p_matricula:'__NAO_EXISTE__',p_pin_servidor:'000000',p_coordenador_id:null,p_momento_simulado:null})
console.log(' HTTP', r1.status, '->', r1.body)

console.log('\n=== 2. fn_registrar_ponto_terminal_local EXECUTA (o caminho que seta o GUC) ===')
const t=(await q('terminais_locais?select=id,nome'))[0]
const r2=await rpc('fn_registrar_ponto_terminal_local',{p_terminal_id:t.id,p_matricula:'__NAO_EXISTE__',p_pin_servidor:'000000'})
console.log(' HTTP', r2.status, '->', r2.body)

console.log('\n=== 3. recusas "Sem permissao" desde a aplicacao ===')
const rec=await q(`logs_tentativas_presenca?select=data_hora_tentativa,nome_servidor_detectado&mensagem_erro=ilike.*Sem permiss*&data_hora_tentativa=gte.2026-09-09&order=data_hora_tentativa`)
console.log(' total hoje:', rec.length)
for(const x of rec) console.log('  ', loc(x.data_hora_tentativa), x.nome_servidor_detectado)

console.log('\n=== 4. os 5 dias de 08/09 no CAF foram recuperados? ===')
const SETOR='0dd13187-24af-4d58-b106-0e5c67de59d3'
const srvs=(await q('servidores?select=id,nome,matricula,setor_id,status')).filter(s=>s.setor_id===SETOR&&s.status==='Ativo')
const ems=await q(`escala_mensal?select=id,servidor_id&ano=eq.2026&mes=eq.9&servidor_id=in.(${srvs.map(s=>s.id).join(',')})`)
const eds=await q(`escala_diaria?select=escala_mensal_id,dia,presenca_entrada_em,presenca_saida_em,presenca_entrada_origem&escala_mensal_id=in.(${ems.map(e=>e.id).join(',')})&dia=eq.8`)
const nome=Object.fromEntries(srvs.map(s=>[s.id,s.nome]))
const emS=Object.fromEntries(ems.map(e=>[e.id,e.servidor_id]))
for(const d of eds) console.log(`  ${nome[emS[d.escala_mensal_id]]?.slice(0,30).padEnd(31)} ent ${loc(d.presenca_entrada_em)} (${d.presenca_entrada_origem||'—'})  sai ${loc(d.presenca_saida_em)}`)

console.log('\n=== 5. batidas do CAF hoje ===')
const m=await q(`marcacoes_ponto?select=ocorrido_em,origem,observacao&setor_id=eq.${SETOR}&ocorrido_em=gte.2026-09-09&order=ocorrido_em`)
console.log(' total:', m.length)
for(const x of m) console.log('  ', loc(x.ocorrido_em), x.origem, x.observacao? '| PENDENTE: '+x.observacao.slice(0,45) : '| aceita direto')
