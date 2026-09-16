// Confere a consulta NOVA de getServidoresFolhaPonto contra producao, unidade a unidade.
// Sai com codigo 1 se qualquer asercao falhar.
import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'}
let falhas=0
const ok=(c,m)=>{console.log(`${c?'  OK  ':' FALHA'} ${m}`);if(!c)falhas++}
async function pag(url){const out=[];for(let f=0;;f+=1000){const r=await fetch(`${url}&limit=1000&offset=${f}`,{headers:H});if(!r.ok){console.error('ERR',r.status,(await r.text()).slice(0,200));process.exit(1)}const g=await r.json();out.push(...g);if(g.length<1000)break}return out}

const MES=9,ANO=2026
const uni=await pag(`${U}/rest/v1/unidades?select=id,nome&order=id.asc`)
const un=Object.fromEntries(uni.map(u=>[u.id,u.nome]))

// verdade: todas as folhas da competencia, paginadas, com a unidade da escala
const todas=await pag(`${U}/rest/v1/folha_ponto?select=id,escala_mensal_id&mes=eq.${MES}&ano=eq.${ANO}&order=id.asc`)
const em=await pag(`${U}/rest/v1/escala_mensal?select=id,unidade_id&mes=eq.${MES}&ano=eq.${ANO}&order=id.asc`)
const eu=Object.fromEntries(em.map(e=>[e.id,e.unidade_id]))
const verdadePorUni={}
for(const f of todas){const u=eu[f.escala_mensal_id];if(u)verdadePorUni[u]=(verdadePorUni[u]||0)+1}

console.log(`\n=== folha_ponto ${MES}/${ANO}: verdade ${todas.length} ===\n`)
const sel=encodeURIComponent('id,escala_mensal!inner(unidade_id,setor_id)')
let somaNova=0
for(const [uid,esperado] of Object.entries(verdadePorUni).sort((a,b)=>b[1]-a[1])){
  // caminho NOVO: embed !inner filtrado por unidade + paginacao ordenada
  const novo=await pag(`${U}/rest/v1/folha_ponto?select=${sel}&mes=eq.${MES}&ano=eq.${ANO}&escala_mensal.unidade_id=eq.${uid}&order=id.asc`)
  const ids=new Set(novo.map(f=>f.id))
  somaNova+=ids.size
  ok(ids.size===esperado && novo.length===esperado,
     `${String(esperado).padStart(4)} esperadas | consulta nova ${String(novo.length).padStart(4)} (${ids.size} distintas)  ${un[uid]}`)
}
ok(somaNova===todas.length,`soma das unidades ${somaNova} == total real ${todas.length}`)

// o caso relatado
const ald='c0d11d0e-0a06-4bf8-8f99-e9dbfecccf4b'
const hiroshi='36abf7d9-6b28-4890-8c4c-676bbcd048c0'
const h=await pag(`${U}/rest/v1/folha_ponto?select=${sel}&mes=eq.${MES}&ano=eq.${ANO}&escala_mensal.unidade_id=eq.${hiroshi}&order=id.asc`)
ok(h.some(f=>f.id===ald),'folha do ALDENIR (mat 40002) aparece na USF HIROSHI MATSUDA')

// o caminho ANTIGO deixava 289 de fora
const r=await fetch(`${U}/rest/v1/folha_ponto?select=id&mes=eq.${MES}&ano=eq.${ANO}`,{headers:H})
const antigo=await r.json()
ok(antigo.length===1000 && todas.length>1000,`caminho antigo continua cortando: ${antigo.length} de ${todas.length}`)

console.log(falhas?`\n${falhas} FALHA(S)`:'\nTUDO OK')
process.exit(falhas?1:0)
