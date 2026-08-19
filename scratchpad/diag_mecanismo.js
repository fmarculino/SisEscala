/** SO LEITURA. A saida tardia e, na verdade, a ENTRADA daquele dia posterior? */
const fs=require('fs'),path=require('path')
const env={};for(const l of fs.readFileSync(path.join(__dirname,'..','.env.production'),'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'')}
const U=env.NEXT_PUBLIC_SUPABASE_URL,H={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}
const pag=async rec=>{const o=[];for(let f=0;;f+=1000){const r=await fetch(U+'/rest/v1/'+rec,{headers:{...H,Range:f+'-'+(f+999)}});if(!r.ok)throw new Error(r.status+' '+await r.text());const p=await r.json();o.push(...p);if(p.length<1000)break}return o}
const diaLocal=t=>parseInt(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',day:'2-digit'}).format(new Date(t)),10)
const L=t=>new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
;(async()=>{
const ed=await pag('escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em')
const em=await pag('escala_mensal?select=id,servidor_id,mes,ano'); const M=new Map(em.map(e=>[e.id,e]))
// indexa por (servidor, mes, ano, dia)
const idx=new Map()
for(const d of ed){const e=M.get(d.escala_mensal_id); if(!e)continue; idx.set(`${e.servidor_id}|${e.mes}|${e.ano}|${d.dia}`,d)}

const ruins=ed.map(d=>({d,e:M.get(d.escala_mensal_id)})).filter(x=>x.e&&x.d.presenca_entrada_em&&x.d.presenca_saida_em)
  .map(x=>({...x,h:(new Date(x.d.presenca_saida_em)-new Date(x.d.presenca_entrada_em))/3600000}))
  .filter(x=>x.h>26)

let confirmados=0, semLinha=0, linhaTinhaEntrada=0
for(const x of ruins){
  const diaSaida=diaLocal(x.d.presenca_saida_em)
  const alvo=idx.get(`${x.e.servidor_id}|${x.e.mes}|${x.e.ano}|${diaSaida}`)
  if(!alvo){semLinha++;continue}
  if(alvo.presenca_entrada_em) linhaTinhaEntrada++; else confirmados++
}
console.log('casos > 26h analisados:',ruins.length)
console.log('')
console.log('  a linha do DIA DA SAIDA existe e esta SEM entrada :',confirmados,'  <- batida foi consumida pelo dia velho')
console.log('  a linha do dia da saida ja tinha entrada propria   :',linhaTinhaEntrada)
console.log('  nao existe linha de escala nesse dia               :',semLinha)
console.log('')
console.log('  amostra dos confirmados:')
let n=0
for(const x of ruins){
  if(n>=6)break
  const diaSaida=diaLocal(x.d.presenca_saida_em)
  const alvo=idx.get(`${x.e.servidor_id}|${x.e.mes}|${x.e.ano}|${diaSaida}`)
  if(!alvo||alvo.presenca_entrada_em)continue
  n++
  console.log(`    linha dia ${String(x.d.dia).padStart(2,'0')}: entrada ${L(x.d.presenca_entrada_em)} -> saida ${L(x.d.presenca_saida_em)}`)
  console.log(`       linha dia ${String(diaSaida).padStart(2,'0')} do mesmo servidor: entrada=VAZIA  saida=${alvo.presenca_saida_em?L(alvo.presenca_saida_em):'VAZIA'}`)
}
})().catch(e=>{console.error('ERRO:',e.message);process.exit(1)})
