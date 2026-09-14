import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
const spec = await (await fetch(`${U}/rest/v1/`, { headers: H })).json()
const refs = Object.entries(spec.definitions||{}).filter(([,d]) => Object.keys(d.properties||{}).some(p => /dicionario_setor/.test(p)))
console.log('tabelas com coluna dicionario_setor*:', refs.map(([t])=>t).join(', '))
// assinaturas das funcoes de setor
const paths = Object.keys(spec.paths||{}).filter(p => /rpc\/fn_(fundir_setor|excluir_setor|dependencias_setor|impedimentos_fusao)/.test(p))
for (const p of paths) {
  const params = spec.paths[p].post?.parameters?.[0]?.schema?.properties
  console.log(p, '->', params ? Object.keys(params).join(', ') : '(sem params no spec)')
}
