import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: E.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${E.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function t(fn, body) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  console.log(`${fn.padEnd(34)} HTTP ${r.status}  ${(await r.text()).slice(0, 130)}`)
}
await t('fn_pode_corrigir_batida_real', { p_acao: 'rearranjar', p_role: 'rh' })
await t('fn_corrigir_passos_com_batidas', { p_servidor_id: '74dd5a40-5a54-466e-8f23-e0a7b4c9c645', p_data: '2026-09-17', p_atribuicoes: [], p_desconsiderar: [], p_justificativa: 'sonda' })
await t('fn_marcacoes_mes', { p_servidor_id: '74dd5a40-5a54-466e-8f23-e0a7b4c9c645', p_mes: 9, p_ano: 2026, p_categoria: 'Regular' })
