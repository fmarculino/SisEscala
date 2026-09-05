import fs from 'fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function qAll(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});if(!r.ok){console.error('ERRO',r.status,(await r.text()).slice(0,300));break}const g=await r.json();o.push(...g);if(g.length<1000)break}return o}
const MES=9,ANO=2026,HOJE=5

const em=await qAll(`escala_mensal?select=id,servidor_id,unidade_id,setor_id,status&mes=eq.${MES}&ano=eq.${ANO}`)
const ids=new Set(em.map(e=>e.id)); const EM=new Map(em.map(e=>[e.id,e]))
console.log('== KPI "Escalas Ativas" ==')
console.log('  linhas escala_mensal no mes (1 por servidor):',em.length)
console.log('  pares unidade|setor distintos (o que o card MOSTRA):',new Set(em.map(e=>`${e.unidade_id}|${e.setor_id}`)).size)
console.log('  "fechadas" que o subtitulo mostra (linhas, nao pares):',em.filter(e=>e.status==='Fechada').length)
console.log('  pares unidade|setor com TODAS as linhas fechadas:',(()=>{const m=new Map();em.forEach(e=>{const k=`${e.unidade_id}|${e.setor_id}`;const a=m.get(k)||{t:0,f:0};a.t++;if(e.status==='Fechada')a.f++;m.set(k,a)});return [...m.values()].filter(a=>a.t===a.f).length})())
console.log('  status distintos:',JSON.stringify(em.reduce((a,e)=>{a[e.status||'null']=(a[e.status||'null']||0)+1;return a},{})))

const ed=(await qAll(`escala_diaria?select=id,dia,escala_mensal_id,categoria&dia=eq.${HOJE}&order=id`)).filter(l=>ids.has(l.escala_mensal_id))
const naoSob=ed.filter(l=>l.categoria!=='Sobreaviso')
console.log('\n== KPI "Em servico hoje" (dia '+HOJE+') ==')
console.log('  linhas contadas (o que o card MOSTRA):',naoSob.length)
console.log('  servidores DISTINTOS:',new Set(naoSob.map(l=>EM.get(l.escala_mensal_id).servidor_id)).size)
console.log('  por categoria:',JSON.stringify(naoSob.reduce((a,l)=>{a[l.categoria]=(a[l.categoria]||0)+1;return a},{})))

const ev=await qAll(`servidores_eventos?select=id,servidor_id,data_inicio,data_fim,periodo_tipo,hora_inicio,slots,tipos_eventos(nome)&data_inicio=lte.2026-09-05&data_fim=gte.2026-09-05`)
console.log('\n== KPI "Afastados Agora" ==')
console.log('  eventos contados (o que o card MOSTRA):',ev.length)
console.log('  servidores DISTINTOS:',new Set(ev.map(e=>e.servidor_id)).size)
console.log('  parciais (por horas ou por slot):',ev.filter(e=>e.periodo_tipo==='horas'||e.hora_inicio||(e.slots&&e.slots.length)).length)
console.log('  tipos:',JSON.stringify(ev.reduce((a,e)=>{const n=e.tipos_eventos?.nome||'?';a[n]=(a[n]||0)+1;return a},{})))

const sv=await qAll('servidores?select=id,status')
console.log('\n== KPI "Servidores" ==')
console.log('  status:',JSON.stringify(sv.reduce((a,s)=>{a[s.status||'null']=(a[s.status||'null']||0)+1;return a},{})))
const un=await qAll('unidades?select=id,ativo'); const se=await qAll('setores?select=id,ativo')
console.log('  unidades ativas:',un.filter(u=>u.ativo).length,'de',un.length,'| setores ativos:',se.filter(s=>s.ativo).length,'de',se.length)
