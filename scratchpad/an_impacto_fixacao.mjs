import fs from 'node:fs'
const env=Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
async function all(p){const o=[];for(let f=0;;f+=1000){const r=await fetch(`${U}/rest/v1/${p}`,{headers:{...H,Range:`${f}-${f+999}`}});const j=await r.json();if(!Array.isArray(j))throw new Error(JSON.stringify(j));o.push(...j);if(j.length<1000)break}return o}

const trat = await all('marcacoes_tratamentos?select=id,marcacao_id,tipo,passo_forcado,escala_diaria_id,created_at&tipo=in.(vincular_escala,reclassificar_passo)&order=id')
console.log('tratamentos de passo:', trat.length)
const comTudo = trat.filter(t=>t.passo_forcado && t.escala_diaria_id)
console.log('com passo_forcado E escala_diaria_id (os que a fixacao honraria):', comTudo.length)

// ultimo por marcacao
const ult=new Map()
for(const t of comTudo){ const a=ult.get(t.marcacao_id); if(!a || t.created_at>a.created_at) ult.set(t.marcacao_id,t) }
console.log('marcacoes distintas:', ult.size)

// desconsideradas vencem
const desc = await all('marcacoes_tratamentos?select=marcacao_id,tipo,created_at&tipo=in.(desconsiderar,restaurar)&order=id')
const ultDesc=new Map()
for(const d of desc){ const a=ultDesc.get(d.marcacao_id); if(!a||d.created_at>a.created_at) ultDesc.set(d.marcacao_id,d) }
const vivos=[...ult.values()].filter(t=>ultDesc.get(t.marcacao_id)?.tipo!=='desconsiderar')
console.log('nao desconsideradas (a fixacao valeria):', vivos.length)

// compara com escala_diaria
const CAMPO={entrada:'presenca_entrada_marcacao_id',intervalo_saida:'presenca_intervalo_saida_marcacao_id',intervalo_retorno:'presenca_intervalo_retorno_marcacao_id',saida:'presenca_saida_marcacao_id'}
const eds=new Map()
for(let i=0;i<vivos.length;i+=100){
  const ids=[...new Set(vivos.slice(i,i+100).map(t=>t.escala_diaria_id))]
  const r=await all(`escala_diaria?select=id,dia,categoria,escala_mensal_id,${Object.values(CAMPO).join(',')}&id=in.(${ids.join(',')})`)
  r.forEach(x=>eds.set(x.id,x))
}
let concorda=0, discorda=0, linhaSumiu=0
const ex=[]
for(const t of vivos){
  const ed=eds.get(t.escala_diaria_id); if(!ed){linhaSumiu++;continue}
  const campo=CAMPO[t.passo_forcado]
  if(ed[campo]===t.marcacao_id) concorda++
  else { discorda++; if(ex.length<8) ex.push({trat:t.id,passo:t.passo_forcado,dia:ed.dia,cat:ed.categoria,gravado:ed[campo],tratamento:t.marcacao_id,created:t.created_at}) }
}
console.log('\nCONCORDA com o que esta gravado hoje (fixar nao muda nada):', concorda)
console.log('DISCORDA (fixar MUDARIA a alocacao):', discorda)
console.log('linha de escala sumiu:', linhaSumiu)
if(ex.length) console.log(JSON.stringify(ex,null,1))
