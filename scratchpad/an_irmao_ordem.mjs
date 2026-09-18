import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: E.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${E.SUPABASE_SERVICE_ROLE_KEY}` }
const get = async p => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(`${p} -> ${r.status} ${await r.text()}`); return r.json() }

const A = '74dd5a40-5a54-466e-8f23-e0a7b4c9c645' // mat 53729
const B = '6d26d226-88ab-4024-a676-2c015d698fb4' // mat 68152

const m = await get(`marcacoes_ponto?select=*&servidor_id=in.(${A},${B})&ocorrido_em=gte.2026-09-17T00:00:00-03:00&ocorrido_em=lt.2026-09-18T00:00:00-03:00`)
console.log('=== MARCACOES DO DIA 17 (ordem de CRIACAO) ===')
for (const x of m) {
  console.log(`  registrada ${x.registrado_em ?? x.inserted_at ?? "?"}`)
  console.log(`    ocorrido ${x.ocorrido_em} | mat ${x.servidor_id === A ? 53729 : 68152} | ${x.origem} | sintetica ${x.sintetica} | nsr ${x.nsr ?? '-'} | id ${x.id}`)
}

console.log('\n=== TRATAMENTOS DESSAS MARCACOES ===')
const t = await get(`marcacoes_tratamentos?select=*&marcacao_id=in.(${m.map(x => x.id).join(',')})`)
console.log(t.length ? JSON.stringify(t, null, 2) : '  (nenhum)')

console.log('\n=== ESCALA DIARIA 17 (mat 68152) ===')
const ed = await get(`escala_diaria?select=*&escala_mensal_id=eq.cfe90e2c-e0fe-415b-87f8-4585ef0ed2ee&dia=eq.17`)
for (const d of ed) {
  console.log(`  ${d.categoria} | updated_at ${d.updated_at} | reconciliado_em ${d.reconciliado_em}`)
  console.log(`    entrada ${d.presenca_entrada_em} (${d.presenca_entrada_origem}) marc ${d.presenca_entrada_marcacao_id}`)
  console.log(`    saida   ${d.presenca_saida_em} (${d.presenca_saida_origem}) marc ${d.presenca_saida_marcacao_id}`)
  console.log(`    confirmada ${d.presenca_confirmada} | manual e/s ${d.presenca_entrada_manual}/${d.presenca_saida_manual}`)
}
