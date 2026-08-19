/** SO LEITURA. Caso 19/08: entrada do dia 19 veio da batida das 21:20 do dia 18. */
const fs=require('fs'),path=require('path')
const env={};for(const l of fs.readFileSync(path.join(__dirname,'..','.env.production'),'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'')}
const U=env.NEXT_PUBLIC_SUPABASE_URL,H={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}
const q=async rec=>{const r=await fetch(U+'/rest/v1/'+rec,{headers:H});if(!r.ok)throw new Error(r.status+' '+await r.text());return r.json()}
const L=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):null
;(async()=>{
console.log('URL:',U)
const [srv]=await q('servidores?select=id,nome,matricula,ignora_janela_presenca,unidade_id,setor_id,intervalo_flexivel,intervalo_inicio_personalizado,intervalo_fim_personalizado&matricula=eq.69497')
console.log('SERVIDOR:',JSON.stringify(srv,null,1))
const em=await q(`escala_mensal?select=id,mes,ano&servidor_id=eq.${srv.id}&mes=eq.8&ano=eq.2026`)
console.log('escala_mensal:',em.map(e=>e.id).join(','))
for(const e of em){
  const ed=await q(`escala_diaria?select=*&escala_mensal_id=eq.${e.id}&dia=in.(17,18,19)&order=dia`)
  for(const d of ed){
    console.log(`\n-- dia ${d.dia} cat=${d.categoria} turno=${d.turno_codigo||d.codigo_turno||''} jornada=${d.jornada_id||''}`)
    for(const k of Object.keys(d)) if(/presenca|hora_|inicio|fim|manual|sintet/.test(k) && d[k]!==null) console.log('   ',k,'=',/_em$/.test(k)?L(d[k]):d[k])
  }
}
const mp=await q(`marcacoes_ponto?select=id,ocorrido_em,origem,sintetica,dispositivo_id,created_at&servidor_id=eq.${srv.id}&ocorrido_em=gte.2026-08-17T00:00:00-03:00&order=ocorrido_em`)
console.log('\nMARCACOES 17-19/08:')
for(const m of mp) console.log('  ',L(m.ocorrido_em),m.origem,m.id,'sint='+m.sintetica)
})().catch(e=>{console.error('ERRO',e.message);process.exit(1)})
