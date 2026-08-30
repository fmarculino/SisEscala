// Confere, contra o banco indicado (default .env.production; passe .env.local para homologacao), se `verify_pin` esta mesmo exposta ao papel `anon`.
//
// A chave anon vai no bundle do navegador — qualquer pessoa a tem. Se a funcao aparecer no
// OpenAPI do PostgREST com essa chave, ela e' chamavel direto, fora da aplicacao, sem passar
// pelo contador de 5 tentativas de validatePin (que vive so' no TypeScript).
//
// NAO chuta PIN de ninguem: le o OpenAPI e faz UMA chamada com um UUID inexistente, que a
// propria funcao responde `false` sem tocar em conta nenhuma.
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync(process.argv[2] || '.env.production', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!URL_ || !ANON) { console.error('faltou URL ou ANON key em .env.production'); process.exit(1) }

console.log('projeto:', URL_)
console.log('usando a chave ANON (a que vai no bundle do navegador)\n')

// 1) OpenAPI: o que anon enxerga como RPC
const r = await fetch(`${URL_}/rest/v1/`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
if (!r.ok) { console.error('OpenAPI HTTP', r.status); process.exit(1) }
const spec = await r.json()
const rpcs = Object.keys(spec.paths || {}).filter(p => p.startsWith('/rpc/')).map(p => p.slice(5))
console.log(`funcoes RPC visiveis a anon: ${rpcs.length}`)

const INTERESSE = ['verify_pin', 'fn_registrar_ponto', 'fn_confirmar_presenca',
                   'fn_confirmar_presenca_manual', 'fn_atestar_jornada_bulk',
                   'register_sobreaviso_arrival', 'fn_ingerir_afd']
console.log('\nfuncoes de interesse:')
for (const f of INTERESSE) {
  console.log(`  ${rpcs.includes(f) ? 'EXPOSTA a anon' : 'fechada       '}  ${f}`)
}

// 2) prova viva: chamar verify_pin com um UUID que nao existe
const alvo = '00000000-0000-0000-0000-000000000000'
const c = await fetch(`${URL_}/rest/v1/rpc/verify_pin`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_servidor_id: alvo, p_pin: '0000' }),
})
const corpo = await c.text()
console.log(`\nPOST /rpc/verify_pin com a chave anon -> HTTP ${c.status}  ${corpo.slice(0, 120)}`)
console.log(c.status === 200
  ? '  🚨 CONFIRMADO: da para chamar verify_pin sem login. 4 digitos = 9.000 tentativas,\n'
    + '     e o contador de 5 tentativas nao existe dentro da funcao.'
  : '  ok: recusada sem login.')
