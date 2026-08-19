/** SO LEITURA. Chama fn_alocar_marcacoes_dia e fn_blocos_previstos_dia em producao. */
const fs=require('fs'),path=require('path')
const env={};for(const l of fs.readFileSync(path.join(__dirname,'..','.env.production'),'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'')}
const U=env.NEXT_PUBLIC_SUPABASE_URL,H={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'}
const rpc=async(fn,args)=>{const r=await fetch(U+'/rest/v1/rpc/'+fn,{method:'POST',headers:H,body:JSON.stringify(args)});if(!r.ok)throw new Error(fn+' '+r.status+' '+await r.text());return r.json()}
const L=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):null
const SRV='0e6b03ca-2c54-47f6-af2e-977d2787580d'
;(async()=>{
for(const d of ['2026-08-17','2026-08-18','2026-08-19']){
  const b=await rpc('fn_blocos_previstos_dia',{p_servidor_id:SRV,p_data:d})
  console.log('\n=== BLOCOS',d)
  for(const x of b) console.log('   bloco',x.bloco_ordem,x.categoria,L(x.inicio_previsto),'->',L(x.fim_previsto),'int:',L(x.intervalo_inicio_previsto),L(x.intervalo_fim_previsto),'permite_int=',x.permite_intervalo)
  const a=await rpc('fn_alocar_marcacoes_dia',{p_servidor_id:SRV,p_data:d})
  console.log('  ALOC slots=',a.slots)
  for(const x of a.alocacoes) console.log('    ',x.passo,'prev',L(x.previsto),'dist',x.distancia_min,'marc',x.marcacao_id)
  for(const x of a.pendencias) console.log('    PEND',x.tipo,x.passo||'',L(x.ocorrido_em)||L(x.previsto))
}
})().catch(e=>{console.error('ERRO',e.message);process.exit(1)})
