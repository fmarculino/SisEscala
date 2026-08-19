/** SO LEITURA. A marcacao bruta esta certa e a ATRIBUICAO errada, ou a marcacao ja vem errada? */
const fs=require('fs'),path=require('path')
const env={};for(const l of fs.readFileSync(path.join(__dirname,'..','.env.production'),'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'')}
const U=env.NEXT_PUBLIC_SUPABASE_URL,H={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}
const g=async q=>{const r=await fetch(U+'/rest/v1/'+q,{headers:H});if(!r.ok)throw new Error(r.status+' '+await r.text());return r.json()}
async function pag(rec){const out=[];for(let f=0;;f+=1000){const r=await fetch(U+'/rest/v1/'+rec,{headers:{...H,Range:f+'-'+(f+999)}});const p=await r.json();out.push(...p);if(p.length<1000)break}return out}
const L=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'-'
const diaLocal=t=>parseInt(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',day:'2-digit'}).format(new Date(t)),10)

;(async()=>{
const ed=await pag('escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em,presenca_saida_marcacao_id,presenca_entrada_marcacao_id&presenca_saida_em=not.is.null&presenca_saida_marcacao_id=not.is.null')
const em=await pag('escala_mensal?select=id,mes,ano')
const mapEm=new Map(em.map(e=>[e.id,e]))
const ruins=ed.map(d=>({...d,h:(new Date(d.presenca_saida_em)-new Date(d.presenca_entrada_em))/3600000,em:mapEm.get(d.escala_mensal_id)})).filter(d=>isFinite(d.h)&&d.h>26)
console.log('casos >26h COM marcacao_id de saida:',ruins.length,'\n')

const ids=[...new Set(ruins.map(d=>d.presenca_saida_marcacao_id))].slice(0,25)
const mp=await g('marcacoes_ponto?select=id,servidor_id,ocorrido_em,origem,sintetica,retroativa&id=in.('+ids.join(',')+')')
const mapM=new Map(mp.map(m=>[m.id,m]))

console.log('Comparando o timestamp gravado em escala_diaria com o da marcacao de origem:\n')
let iguais=0,difs=0
for(const d of ruins.slice(0,12)){
  const m=mapM.get(d.presenca_saida_marcacao_id); if(!m) continue
  const igual=new Date(m.ocorrido_em).getTime()===new Date(d.presenca_saida_em).getTime()
  igual?iguais++:difs++
  console.log(`  linha dia ${String(d.dia).padStart(2,'0')} (${d.categoria}) ${d.h.toFixed(0)}h`)
  console.log(`     escala_diaria.presenca_saida_em : ${L(d.presenca_saida_em)}`)
  console.log(`     marcacoes_ponto.ocorrido_em     : ${L(m.ocorrido_em)}  [${m.origem}]  ${igual?'IDENTICO':'DIVERGENTE'}`)
  console.log(`     marcacao ocorreu no dia ${diaLocal(m.ocorrido_em)}, linha e do dia ${d.dia}`)
}
console.log(`\n  timestamps identicos: ${iguais} | divergentes: ${difs}`)
console.log('  => identico significa: a marcacao BRUTA esta certa, o erro e ATRIBUIR essa batida a esta linha.')
})().catch(e=>{console.error('ERRO:',e.message);process.exit(1)})
