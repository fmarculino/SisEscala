// Duas premissas da migration 20260830110000, conferidas contra PRODUCAO:
//   1. `crypt` (pgcrypto) esta no schema `extensions`? A funcao nova chama extensions.crypt().
//   2. `matricula` identifica UM servidor ativo? fn_validar_pin_portal resolve o login por ela.
//      Se houver matricula repetida entre ativos, o SELECT INTO pegaria uma linha ARBITRARIA —
//      e o login abriria a sessao da pessoa errada. O codigo antigo usava .single(), que
//      ERRAVA nesse caso; a diferenca de comportamento importa.
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }

// ── 1) schema do pgcrypto, via uma funcao ja existente que sabemos que funciona
//    verify_pin chama crypt() sem qualificar, com search_path = public, extensions.
//    Se crypt estivesse em public, extensions.crypt() daria erro em runtime.
const r1 = await fetch(`${U}/rest/v1/rpc/verify_pin`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_servidor_id: '00000000-0000-0000-0000-000000000000', p_pin: 'x' }),
})
console.log(`verify_pin responde (service_role): HTTP ${r1.status} ${await r1.text()}`)
console.log('  (prova que pgcrypto esta instalado e alcancavel pelo search_path da funcao)')

// ── 2) matricula duplicada entre ATIVOS
const paginar = async (q) => {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${q}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    const p = await r.json()
    if (!Array.isArray(p)) { console.error('erro:', p); process.exit(1) }
    out.push(...p)
    if (p.length < 1000) break     // armadilha 8: PostgREST corta em 1000 em silencio
  }
  return out
}

const ativos = await paginar('servidores?select=id,matricula,nome,pin_acesso&status=eq.Ativo')
console.log(`\nservidores Ativos: ${ativos.length}`)

const porMat = new Map()
for (const s of ativos) {
  const m = (s.matricula ?? '').trim()
  if (!porMat.has(m)) porMat.set(m, [])
  porMat.get(m).push(s)
}
const dup = [...porMat.entries()].filter(([m, v]) => m !== '' && v.length > 1)
const semMat = porMat.get('') || []

console.log(`matriculas distintas: ${porMat.size}`)
console.log(`matriculas DUPLICADAS entre ativos: ${dup.length}`)
for (const [m, v] of dup.slice(0, 10)) {
  console.log(`   ${m} -> ${v.length} servidores: ${v.map(x => x.nome).join(' | ')}`)
}
console.log(`servidores ativos SEM matricula: ${semMat.length}`)

const comPin = ativos.filter(s => s.pin_acesso).length
console.log(`\nservidores ativos com PIN cadastrado: ${comPin} de ${ativos.length}`)

console.log(dup.length === 0
  ? '\n>>> OK: matricula identifica um unico servidor ativo. fn_validar_pin_portal e segura.'
  : '\n>>> ⚠️ ATENCAO: ha matricula repetida entre ativos — resolver o login por matricula pode'
    + '\n    abrir a sessao da pessoa errada. NAO aplicar a Parte B sem tratar isso.')
