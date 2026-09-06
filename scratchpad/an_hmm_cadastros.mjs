import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
async function todas(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
    const p = await r.json(); out.push(...p)
    if (p.length < 1000) break
  }
  return out
}
const disp = JSON.parse(fs.readFileSync('scratchpad/_hmm_disp.json', 'utf8'))
console.log('=== coletor: host e versao ===')
for (const d of disp) console.log(`${d.nome.padEnd(22)} host=${d.coletor_host}  ip=${d.coletor_ip}  v${d.coletor_versao}  em ${d.coletor_versao_em}`)

console.log('\n=== snapshot rep_usuarios_dispositivo ===')
const snapCols = await fetch(`${U}/rest/v1/rep_usuarios_dispositivo?select=*&limit=1`, { headers: H }).then(r => r.json())
console.log('colunas:', Object.keys(snapCols[0] || {}).join(', '))
for (const d of disp) {
  const linhas = await todas(`rep_usuarios_dispositivo?dispositivo_id=eq.${d.id}&select=identificador_afd,nome_no_device,tem_biometria,servidor_id,atualizado_em`)
  const comBio = linhas.filter(l => l.tem_biometria).length
  const semServidor = linhas.filter(l => !l.servidor_id).length
  const quando = linhas[0]?.atualizado_em
  console.log(`${d.nome.padEnd(22)} total=${String(linhas.length).padStart(4)}  com_digital=${String(comBio).padStart(4)}  sem_digital=${String(linhas.length - comBio).padStart(4)}  sem_servidor_resolvido=${String(semServidor).padStart(4)}  snapshot=${quando}`)
  fs.writeFileSync(`scratchpad/_snap_${d.nome.slice(-6)}.json`, JSON.stringify(linhas, null, 2))
}
