import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
const get = async p => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(`${p} ${r.status} ${await r.text()}`); return r.json() }

console.log('unidade do cadastro 68182:', JSON.stringify(await get('unidades?id=eq.c38a5df5-21fb-4d4e-8c97-e9770debe437&select=id,nome,ativo')))

const prof = await get('profiles?full_name=ilike.*JAIANE*&select=id,full_name,role,acesso_todas_unidades,acesso_todos_setores')
console.log('perfil:', JSON.stringify(prof))
for (const p of prof) {
  console.log('  unidades:', JSON.stringify(await get(`profile_unidades?profile_id=eq.${p.id}&select=unidades(nome)`)))
  console.log('  setores :', JSON.stringify(await get(`profile_setores?profile_id=eq.${p.id}&select=setores(unidade_id,dicionario_setores(nome))`)))
}
