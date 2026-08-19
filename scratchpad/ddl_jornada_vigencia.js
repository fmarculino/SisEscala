/** SO LEITURA. Colunas reais de escala_mensal e servidores_jornadas_temporarias em producao. */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY }

;(async () => {
  // O root do PostgREST expoe o OpenAPI com o tipo de cada coluna
  const r = await fetch(U + '/rest/v1/', { headers: H })
  const spec = await r.json()
  for (const t of ['escala_mensal', 'servidores_jornadas_temporarias', 'jornadas', 'folha_ponto']) {
    const def = spec.definitions?.[t]
    console.log(`\n=== ${t} ===`)
    if (!def) { console.log('  (nao exposta)'); continue }
    for (const [col, meta] of Object.entries(def.properties || {}))
      console.log(`  ${col.padEnd(30)} ${String(meta.format || meta.type).padEnd(28)} ${meta.description ? String(meta.description).split('\n')[0].slice(0, 60) : ''}`)
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
