import { get, rpc } from './q.mjs'
const F=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'
// 1. a funcao nova existe e responde
const s=(await get(`servidores?matricula=eq.69250&select=id`))[0]
const em=(await get(`escala_mensal?servidor_id=eq.${s.id}&ano=eq.2026&mes=eq.9&ativo=eq.true&select=id`))[0]
const livre = await rpc('fn_ancora_plantao_livre_do_regular',{p_escala_mensal_id:em.id,p_dia:2,p_horario_inicio:'19:00',p_horas:12})
console.log('1) fn_ancora_plantao_livre_do_regular(N 19h/12h vs Regular 07-13):', livre, '(esperado true)')
// 2. o caso da Charlene
const b = await rpc('fn_blocos_previstos_dia',{p_servidor_id:s.id,p_data:'2026-09-02'})
console.log('\n2) blocos da CHARLENE em 02/09 (esperado: DOIS, o 2o 19:00->07:00+1 com intervalo):')
for(const x of b) console.log(`   bloco ${x.bloco_ordem} ${x.categoria.padEnd(8)} ${F(x.inicio_previsto)} -> ${F(x.fim_previsto)}  intervalo=${x.permite_intervalo} ${x.intervalo_inicio_previsto?F(x.intervalo_inicio_previsto)+'/'+F(x.intervalo_fim_previsto):''}`)
