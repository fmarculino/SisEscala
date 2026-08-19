/** SO LEITURA. Os dias com atribuicao errada tem Sobreaviso na mesma linha de escala? */
const fs=require('fs'),path=require('path')
const env={};for(const l of fs.readFileSync(path.join(__dirname,'..','.env.production'),'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'')}
const U=env.NEXT_PUBLIC_SUPABASE_URL,H={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}
const pag=async r0=>{const o=[];for(let f=0;;f+=1000){const r=await fetch(U+'/rest/v1/'+r0,{headers:{...H,Range:f+'-'+(f+999)}});if(!r.ok)throw new Error(r.status+' '+await r.text());const p=await r.json();o.push(...p);if(p.length<1000)break}return o}
;(async()=>{
const em=await pag('escala_mensal?select=id,servidor_id&mes=eq.8&ano=eq.2026')
const ids=em.map(e=>e.id), M=new Map(em.map(e=>[e.id,e]))
let ed=[]
for(let i=0;i<ids.length;i+=50)
  ed.push(...await pag(`escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em,dicionario_turnos(codigo)&escala_mensal_id=in.(${ids.slice(i,i+50).join(',')})`))

// indexa categorias por (servidor, dia)
const doDia=new Map()
for(const d of ed){
  const sv=M.get(d.escala_mensal_id)?.servidor_id; if(!sv)continue
  const k=sv+'|'+d.dia
  if(!doDia.has(k))doDia.set(k,[])
  doDia.get(k).push(d)
}
const ruins=ed.filter(d=>d.presenca_entrada_em&&d.presenca_saida_em)
  .map(d=>({...d,h:(new Date(d.presenca_saida_em)-new Date(d.presenca_entrada_em))/3600000}))
  .filter(d=>d.h<0||d.h>26)

const temSob=d=>{const sv=M.get(d.escala_mensal_id)?.servidor_id;return (doDia.get(sv+'|'+d.dia)||[]).some(x=>x.categoria==='Sobreaviso')}
const comSob=ruins.filter(temSob).length

// grupo de controle: dias saudaveis do MESMO conjunto de servidores
const servRuins=new Set(ruins.map(d=>M.get(d.escala_mensal_id)?.servidor_id))
const bons=ed.filter(d=>d.presenca_entrada_em&&d.presenca_saida_em&&servRuins.has(M.get(d.escala_mensal_id)?.servidor_id))
  .map(d=>({...d,h:(new Date(d.presenca_saida_em)-new Date(d.presenca_entrada_em))/3600000}))
  .filter(d=>d.h>=0&&d.h<=26)
const bonsComSob=bons.filter(temSob).length

console.log('CASOS COM ATRIBUICAO ERRADA (08/2026)')
console.log('  total                      :',ruins.length)
console.log('  com Sobreaviso no mesmo dia:',comSob,`(${(100*comSob/ruins.length).toFixed(0)}%)`)
console.log('\nGRUPO DE CONTROLE — dias SAUDAVEIS dos mesmos servidores')
console.log('  total                      :',bons.length)
console.log('  com Sobreaviso no mesmo dia:',bonsComSob,`(${(100*bonsComSob/bons.length).toFixed(0)}%)`)
console.log('\n  => se as taxas forem parecidas, Sobreaviso NAO explica; se divergirem muito, explica.')
})().catch(e=>{console.error('ERRO:',e.message);process.exit(1)})
