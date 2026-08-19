/**
 * Diagnostico das duracoes impossiveis em escala_diaria (SO LEITURA).
 * Nao escreve, nao chama RPC. Ver relatorio no fim.
 */
const fs=require('fs'),path=require('path')
const env={};for(const l of fs.readFileSync(path.join(__dirname,'..','.env.production'),'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'')}
const U=env.NEXT_PUBLIC_SUPABASE_URL,H={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}
async function pag(rec){const out=[];for(let f=0;;f+=1000){const r=await fetch(U+'/rest/v1/'+rec,{headers:{...H,Range:f+'-'+(f+999)}});if(!r.ok)throw new Error(r.status+' '+await r.text());const p=await r.json();out.push(...p);if(p.length<1000)break}return out}
const L=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'-'

;(async()=>{
const ed=await pag('escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_entrada_origem,presenca_saida_origem,presenca_entrada_manual,presenca_saida_manual,presenca_entrada_marcacao_id,presenca_saida_marcacao_id,reconciliado_em&presenca_saida_em=not.is.null')
const em=await pag('escala_mensal?select=id,mes,ano,status')
const mapEm=new Map(em.map(e=>[e.id,e]))

const dur=ed.map(d=>({...d,h:(new Date(d.presenca_saida_em)-new Date(d.presenca_entrada_em))/3600000,em:mapEm.get(d.escala_mensal_id)})).filter(d=>isFinite(d.h))
const neg=dur.filter(d=>d.h<0)
const longos=dur.filter(d=>d.h>26)

console.log('='.repeat(70));console.log('A) OS 70 DE DURACAO NEGATIVA (saida antes da entrada)');console.log('='.repeat(70))
console.log('total:',neg.length)
const co=(arr,f)=>{const o={};for(const x of arr){const k=f(x)??'(null)';o[k]=(o[k]||0)+1}return o}
console.log('  por origem da SAIDA :',JSON.stringify(co(neg,d=>d.presenca_saida_origem)))
console.log('  por origem da ENTRADA:',JSON.stringify(co(neg,d=>d.presenca_entrada_origem)))
console.log('  por categoria       :',JSON.stringify(co(neg,d=>d.categoria)))
console.log('  por competencia     :',JSON.stringify(co(neg,d=>d.em?String(d.em.mes).padStart(2,'0')+'/'+d.em.ano:'?')))
console.log('  saida tem marcacao_id:',JSON.stringify(co(neg,d=>!!d.presenca_saida_marcacao_id)))
console.log('  ja reconciliado      :',JSON.stringify(co(neg,d=>!!d.reconciliado_em)))
const negH=neg.map(d=>d.h).sort((a,b)=>a-b)
console.log('  gap: min '+negH[0].toFixed(1)+'h  mediana '+negH[Math.floor(negH.length/2)].toFixed(1)+'h  max '+negH[negH.length-1].toFixed(1)+'h')
console.log('\n  amostra (5):')
for(const d of neg.slice(0,5)) console.log('    dia '+d.dia+' '+d.categoria+' | entrada '+L(d.presenca_entrada_em)+' | saida '+L(d.presenca_saida_em)+' | orig '+(d.presenca_saida_origem||'-'))

console.log('\n'+'='.repeat(70));console.log('B) OS '+longos.length+' DE MAIS DE 26h');console.log('='.repeat(70))
console.log('  por origem da SAIDA :',JSON.stringify(co(longos,d=>d.presenca_saida_origem)))
console.log('  por categoria       :',JSON.stringify(co(longos,d=>d.categoria)))
console.log('  por competencia     :',JSON.stringify(co(longos,d=>d.em?String(d.em.mes).padStart(2,'0')+'/'+d.em.ano:'?')))
console.log('  saida tem marcacao_id:',JSON.stringify(co(longos,d=>!!d.presenca_saida_marcacao_id)))
console.log('\n  amostra (5):')
for(const d of longos.slice(0,5)) console.log('    dia '+d.dia+' '+d.categoria+' | entrada '+L(d.presenca_entrada_em)+' | saida '+L(d.presenca_saida_em)+' | '+d.h.toFixed(0)+'h | orig '+(d.presenca_saida_origem||'-'))

console.log('\n'+'='.repeat(70));console.log('C) A SAIDA CAI NO DIA CERTO?');console.log('='.repeat(70))
const diaDe=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',day:'2-digit'}).format(new Date(t))
let certo=0,d1=0,outro=0
for(const d of [...neg,...longos]){
  const ds=parseInt(diaDe(d.presenca_saida_em),10)
  if(ds===d.dia)certo++; else if(ds===d.dia+1)d1++; else outro++
}
console.log('  saida no proprio dia da linha :',certo)
console.log('  saida no dia seguinte         :',d1)
console.log('  saida em outro dia qualquer   :',outro)
})().catch(e=>{console.error('ERRO:',e.message);process.exit(1)})
