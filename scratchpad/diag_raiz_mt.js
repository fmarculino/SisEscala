/** SO LEITURA. Batidas cruas x atribuicao por dia, no caso MT do piloto da TI. */
const fs=require('fs'),path=require('path')
const env={};for(const l of fs.readFileSync(path.join(__dirname,'..','.env.production'),'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'')}
const U=env.NEXT_PUBLIC_SUPABASE_URL,H={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}
const g=async q=>{const r=await fetch(U+'/rest/v1/'+q,{headers:H});if(!r.ok)throw new Error(r.status+' '+await r.text());return r.json()}
const F=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'-'
;(async()=>{
const s=await g('servidores?select=id,nome&nome=like.FERNANDO MARCULINO*')
const sid=s[0].id
console.log('servidor:',s[0].nome,'\n')

console.log('=== A) BATIDAS CRUAS em marcacoes_ponto (01 a 08/08) ===')
const mp=await g(`marcacoes_ponto?select=id,ocorrido_em,origem,sintetica,retroativa,dispositivo_id&servidor_id=eq.${sid}&ocorrido_em=gte.2026-08-01&ocorrido_em=lt.2026-08-09&order=ocorrido_em`)
for(const m of mp) console.log(`   ${F(m.ocorrido_em)}  [${String(m.origem).padEnd(18)}] sint=${m.sintetica} retro=${m.retroativa}`)
console.log(`   total: ${mp.length}`)

console.log('\n=== B) COMO FICOU em escala_diaria (dias 01 a 08) ===')
const em=await g(`escala_mensal?select=id&servidor_id=eq.${sid}&mes=eq.8&ano=eq.2026`)
const ed=await g(`escala_diaria?select=dia,categoria,presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em,presenca_entrada_origem,presenca_saida_origem,dicionario_turnos(codigo)&escala_mensal_id=in.(${em.map(e=>e.id).join(',')})&dia=lte.8&order=dia`)
for(const d of ed){
  console.log(`   dia ${String(d.dia).padStart(2,'0')} [${d.categoria}/${d.dicionario_turnos?.codigo||'-'}]`)
  console.log(`        entrada ${F(d.presenca_entrada_em)} (${d.presenca_entrada_origem||'-'})   saida ${F(d.presenca_saida_em)} (${d.presenca_saida_origem||'-'})`)
}
})().catch(e=>{console.error('ERRO:',e.message);process.exit(1)})
