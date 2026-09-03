import { rpc } from './q.mjs'
const SID='31443303-4740-403e-aeee-40b246ab131e'
const F=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—'
for(const d of ['2026-09-01','2026-09-02']){
  const p = await rpc('fn_projecao_marcacoes_dia',{p_servidor_id:SID,p_data:d})
  console.log(`\n== PROJECAO ${d}`)
  if(!Array.isArray(p)){ console.log(p); continue }
  for(const r of p) console.log(`  ed=${r.escala_diaria_id.slice(0,8)} entrada ${F(r.entrada_em)} | saida ${F(r.saida_em)} | int ${F(r.int_saida_em)}/${F(r.int_retorno_em)}`)
}
