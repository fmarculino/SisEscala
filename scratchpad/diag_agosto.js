/** SO LEITURA. Os casos impossiveis da competencia ABERTA (08/2026), em detalhe. */
const fs=require('fs'),path=require('path')
const env={};for(const l of fs.readFileSync(path.join(__dirname,'..','.env.production'),'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'')}
const U=env.NEXT_PUBLIC_SUPABASE_URL,H={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}
const pag=async rec=>{const o=[];for(let f=0;;f+=1000){const r=await fetch(U+'/rest/v1/'+rec,{headers:{...H,Range:f+'-'+(f+999)}});if(!r.ok)throw new Error(r.status+' '+await r.text());const p=await r.json();o.push(...p);if(p.length<1000)break}return o}
const L=t=>new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
const dl=t=>parseInt(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',day:'2-digit'}).format(new Date(t)),10)
;(async()=>{
const em=await pag('escala_mensal?select=id,servidor_id,mes,ano,status&mes=eq.8&ano=eq.2026')
const ids=em.map(e=>e.id); const M=new Map(em.map(e=>[e.id,e]))
const serv=await pag('servidores?select=id,nome,matricula')
const S=new Map(serv.map(s=>[s.id,s]))
let ed=[]
for(let i=0;i<ids.length;i+=50){
  ed.push(...await pag(`escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em,presenca_entrada_origem,presenca_saida_origem,presenca_entrada_manual,presenca_saida_manual,presenca_saida_marcacao_id,dicionario_turnos(codigo)&escala_mensal_id=in.(${ids.slice(i,i+50).join(',')})`))
}
const ruins=ed.filter(d=>d.presenca_entrada_em&&d.presenca_saida_em)
  .map(d=>({...d,h:(new Date(d.presenca_saida_em)-new Date(d.presenca_entrada_em))/3600000}))
  .filter(d=>d.h<0||d.h>26).sort((a,b)=>a.dia-b.dia)
console.log('linhas de 08/2026:',ed.length,'| impossiveis:',ruins.length,'\n')
const co=(a,f)=>{const o={};for(const x of a){const k=f(x)??'(null)';o[k]=(o[k]||0)+1}return o}
console.log('  status da escala :',JSON.stringify(co(ruins,d=>M.get(d.escala_mensal_id)?.status)))
console.log('  origem da saida  :',JSON.stringify(co(ruins,d=>d.presenca_saida_origem)))
console.log('  saida manual?    :',JSON.stringify(co(ruins,d=>d.presenca_saida_manual)))
console.log('  categoria        :',JSON.stringify(co(ruins,d=>d.categoria)))
console.log('  codigo do turno  :',JSON.stringify(co(ruins,d=>d.dicionario_turnos?.codigo)))
console.log('  gap em dias      :',JSON.stringify(co(ruins,d=>Math.round(d.h/24)+'d')))
console.log('\n  TODOS os casos:')
for(const d of ruins){
  const s=S.get(M.get(d.escala_mensal_id)?.servidor_id)
  console.log(`   dia ${String(d.dia).padStart(2,'0')} ${String(d.categoria).padEnd(8)} ${String(d.dicionario_turnos?.codigo||'-').padEnd(4)} | ${(s?.nome||'?').slice(0,26).padEnd(26)} | ${L(d.presenca_entrada_em)} -> ${L(d.presenca_saida_em)} | ${d.h.toFixed(1)}h | saida=${d.presenca_saida_origem||'(null)'}`)
}
})().catch(e=>{console.error('ERRO:',e.message);process.exit(1)})
