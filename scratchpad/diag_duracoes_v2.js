/** SO LEITURA. v2: exige entrada E saida nao-nulas (v1 deixava new Date(null)=1970 passar). */
const fs=require('fs'),path=require('path')
const env={};for(const l of fs.readFileSync(path.join(__dirname,'..','.env.production'),'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'')}
const U=env.NEXT_PUBLIC_SUPABASE_URL,H={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}
const pag=async rec=>{const o=[];for(let f=0;;f+=1000){const r=await fetch(U+'/rest/v1/'+rec,{headers:{...H,Range:f+'-'+(f+999)}});if(!r.ok)throw new Error(r.status+' '+await r.text());const p=await r.json();o.push(...p);if(p.length<1000)break}return o}
const L=t=>new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
;(async()=>{
const ed=await pag('escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em,presenca_entrada_origem,presenca_saida_origem,presenca_saida_marcacao_id')
const em=await pag('escala_mensal?select=id,mes,ano'); const M=new Map(em.map(e=>[e.id,e]))
const comp=d=>{const e=M.get(d.escala_mensal_id);return e?String(e.mes).padStart(2,'0')+'/'+e.ano:'?'}

const total=ed.length
const soSaida=ed.filter(d=>!d.presenca_entrada_em&&d.presenca_saida_em).length
const soEntrada=ed.filter(d=>d.presenca_entrada_em&&!d.presenca_saida_em).length
const pares=ed.filter(d=>d.presenca_entrada_em&&d.presenca_saida_em)
  .map(d=>({...d,h:(new Date(d.presenca_saida_em)-new Date(d.presenca_entrada_em))/3600000}))

console.log('linhas de escala_diaria           :',total)
console.log('  com entrada E saida (mensuravel):',pares.length)
console.log('  so saida (entrada pendente)     :',soSaida,'  <- v1 contava estas como 496.000h')
console.log('  so entrada (saida pendente)     :',soEntrada)

const faixas=[['negativa (saida < entrada)',d=>d.h<0],['0-16h  normal/plantao',d=>d.h>=0&&d.h<=16],['16-26h dobra plausivel',d=>d.h>16&&d.h<=26],['26-48h',d=>d.h>26&&d.h<=48],['> 48h',d=>d.h>48]]
console.log('\n=== duracoes REAIS (entrada e saida presentes) ===')
for(const [n,f] of faixas){const g=pares.filter(f);console.log('  '+n.padEnd(28)+String(g.length).padStart(5)+'  ('+(100*g.length/pares.length).toFixed(1)+'%)')}

const ruins=pares.filter(d=>d.h<0||d.h>26)
console.log('\n=== os '+ruins.length+' realmente impossiveis ===')
const co=(a,f)=>{const o={};for(const x of a){const k=f(x)??'(null)';o[k]=(o[k]||0)+1}return o}
console.log('  por competencia :',JSON.stringify(co(ruins,comp)))
console.log('  por categoria   :',JSON.stringify(co(ruins,d=>d.categoria)))
console.log('  origem da saida :',JSON.stringify(co(ruins,d=>d.presenca_saida_origem)))
console.log('\n  amostra:')
for(const d of ruins.sort((a,b)=>Math.abs(b.h)-Math.abs(a.h)).slice(0,10))
  console.log('    '+comp(d)+' dia '+String(d.dia).padStart(2,'0')+' '+String(d.categoria).padEnd(8)+' | '+L(d.presenca_entrada_em)+' -> '+L(d.presenca_saida_em)+' | '+d.h.toFixed(1)+'h')
})().catch(e=>{console.error('ERRO:',e.message);process.exit(1)})
