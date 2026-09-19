import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
const D = '19454bce-aa64-45af-865f-df2b18e0a205'
const q = async p => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + await r.text()); return r.json() }

const s = await q(`rep_sincronizacoes?select=iniciada_em,concluida_em,status,nsr_inicial,nsr_final,linhas_recebidas,linhas_novas,linhas_duplicadas,marcacoes_criadas,coletor_versao,coletor_hostname,mensagem_erro,lote_id&dispositivo_id=eq.${D}&order=iniciada_em.desc&limit=40`)
console.log('=== SINCRONIZACOES HMI-01 (40 mais recentes) ===')
for (const x of s) {
  console.log(`${x.iniciada_em}  ${String(x.status).padEnd(10)} nsr ${x.nsr_inicial}..${x.nsr_final}  rec=${x.linhas_recebidas} novas=${x.linhas_novas} dup=${x.linhas_duplicadas} marc=${x.marcacoes_criadas} v=${x.coletor_versao} host=${x.coletor_hostname} ${x.mensagem_erro || ''}`)
}
const falhas = await q(`rep_sincronizacoes?select=iniciada_em,status,nsr_inicial,nsr_final,linhas_recebidas,mensagem_erro,coletor_versao&dispositivo_id=eq.${D}&status=neq.concluida&order=iniciada_em.desc&limit=30`)
console.log(`\n=== NAO-CONCLUIDAS: ${falhas.length} ===`)
for (const x of falhas) console.log(JSON.stringify(x))
