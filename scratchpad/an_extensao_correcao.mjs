import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function all(path){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${path}`,{headers:{...H,Range:`${f}-${f+999}`}});const j=await r.json();if(!Array.isArray(j))throw new Error(JSON.stringify(j));out.push(...j);if(j.length<1000)break}return out}

const ems = await all('escala_mensal?select=id,servidor_id,mes,ano,unidade_id,status&mes=eq.9&ano=eq.2026&order=id')
const byId = new Map(ems.map(e=>[e.id,e]))
console.log('escalas 09/2026:', ems.length)

const eds = await all('escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_entrada_origem,presenca_saida_em,presenca_saida_origem,presenca_intervalo_saida_em,presenca_intervalo_retorno_em&order=id')
const doMes = eds.filter(d=>byId.has(d.escala_mensal_id))
console.log('linhas escala_diaria 09/2026:', doMes.length)

const passados = doMes.filter(d=>d.dia<17)
const soUm = passados.filter(d=>(!!d.presenca_entrada_em)!==(!!d.presenca_saida_em))
const porCat = {}
for(const d of soUm){const k=d.categoria;porCat[k]=(porCat[k]||0)+1}
console.log('\nDIAS PASSADOS com APENAS UM extremo (entrada XOR saida):', soUm.length, JSON.stringify(porCat))
const soSaida = soUm.filter(d=>!d.presenca_entrada_em && d.presenca_saida_em)
console.log('  destes, so SAIDA (padrao "batida capturada pelo turno errado"):', soSaida.length,
  ' | origem rep:', soSaida.filter(d=>d.presenca_saida_origem==='rep').length)
const soSaidaPlantao = soSaida.filter(d=>d.categoria==='Plantão')
console.log('  so SAIDA em PLANTAO:', soSaidaPlantao.length)

// dias com 2+ linhas de escala e batidas disputadas
const porServDia = new Map()
for(const d of passados){const em=byId.get(d.escala_mensal_id);const k=`${em.servidor_id}|${d.dia}`
  if(!porServDia.has(k))porServDia.set(k,[]);porServDia.get(k).push(d)}
const multi=[...porServDia.entries()].filter(([,v])=>v.length>1)
console.log('\npares (servidor,dia) com 2+ linhas de escala:', multi.length)
const multiComParcial = multi.filter(([,v])=>v.some(d=>(!!d.presenca_entrada_em)!==(!!d.presenca_saida_em)))
console.log('  destes, com alguma linha de um extremo so:', multiComParcial.length)
fs.writeFileSync('scratchpad/_multi.json', JSON.stringify(multiComParcial.map(([k,v])=>({k,v:v.map(d=>({id:d.id,cat:d.categoria,dia:d.dia,e:d.presenca_entrada_em,s:d.presenca_saida_em}))})),null,1))
