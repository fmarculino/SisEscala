import { get, rpc } from './q.mjs'
const SID='31443303-4740-403e-aeee-40b246ab131e'
const ED='13eff582-61e9-4c51-b06e-1cb14c5e0b19'
const F=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—'
const ler=async()=>{const r=(await get(`escala_diaria?id=eq.${ED}&select=presenca_entrada_em,presenca_entrada_origem,presenca_saida_em,presenca_saida_origem,presenca_confirmada,reconciliado_em`))[0]
  return `entrada ${F(r.presenca_entrada_em)} (${r.presenca_entrada_origem||'-'}) | saida ${F(r.presenca_saida_em)} (${r.presenca_saida_origem||'-'}) | conf=${r.presenca_confirmada} | recon ${F(r.reconciliado_em)}`}
console.log('ANTES :', await ler())
const r = await rpc('fn_reconciliar_marcacoes_dia',{p_servidor_id:SID,p_data:'2026-09-02'})
console.log('RPC   :', JSON.stringify(r))
console.log('DEPOIS:', await ler())
