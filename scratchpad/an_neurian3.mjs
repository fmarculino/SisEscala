import { get } from './q.mjs'
const F=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—'
const ed = await get(`escala_diaria?id=eq.13eff582-61e9-4c51-b06e-1cb14c5e0b19&select=*`)
const r=ed[0]
console.log('linha do plantao 01/09:')
console.log('  entrada        ', F(r.presenca_entrada_em), r.presenca_entrada_origem)
console.log('  saida          ', F(r.presenca_saida_em), r.presenca_saida_origem)
console.log('  confirmada     ', r.presenca_confirmada)
console.log('  reconciliado_em', F(r.reconciliado_em), 'versao', r.reconciliacao_versao)
console.log('  updated_at     ', F(r.updated_at))
const m = await get(`marcacoes_ponto?servidor_id=eq.31443303-4740-403e-aeee-40b246ab131e&ocorrido_em=gte.2026-09-01T00:00:00-03:00&select=id,ocorrido_em,origem,created_at&order=ocorrido_em`)
console.log('\nmarcacoes e quando FORAM INGERIDAS:')
for(const x of m) console.log(`  ocorreu ${F(x.ocorrido_em)}  ingerida ${F(x.created_at)}  ${x.origem}`)
