// Item 13 da auditoria: quais funcoes ainda sao alcancaveis pelo papel `anon`, e o que fazer
// com cada uma.
//
// A CLASSIFICACAO E FEITA PELO CHAMADOR REAL, nao por palpite (o metodo que a 20260827050000
// estabeleceu):
//   createAdminClient()          -> service_role      -> pode FECHAR de vez
//   createClient() no servidor   -> sessao do usuario -> precisa de `authenticated`
//   createClient() do NAVEGADOR sem login -> precisa de `anon`  -> FICA ABERTA
//   nenhum chamador no codigo    -> provavelmente fechavel, mas conferir
//
// ⚠️ Fechar demais quebra em silencio (licao da 20260827050000): a tela some o dado e nao ha erro.
// Por isso este script cruza com o codigo antes de sugerir qualquer coisa.
import fs from 'node:fs'
import path from 'node:path'

const envFile = process.argv[2] || '.env.production'
const env = Object.fromEntries(
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const U = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// ── 1) o que anon enxerga, pelo OpenAPI
const r = await fetch(`${U}/rest/v1/`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
const spec = await r.json()
const abertas = Object.keys(spec.paths || {}).filter(p => p.startsWith('/rpc/')).map(p => p.slice(5)).sort()

// ── 2) indexar o codigo-fonte
const arquivos = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!/node_modules|\.next|\.git/.test(e.name)) walk(p) }
    else if (/\.(ts|tsx|js|mjs|go)$/.test(e.name)) arquivos.push(p)
  }
})('src')

const fontes = arquivos.map(p => ({ p: p.split(path.sep).join('/'), s: fs.readFileSync(p, 'utf8') }))

/** Onde a funcao e chamada, e com que cliente. */
function chamadores(fn) {
  const out = []
  for (const { p, s } of fontes) {
    const re = new RegExp(`rpc\\(\\s*['"\`]${fn}['"\`]`, 'g')
    let m
    while ((m = re.exec(s))) {
      // olha a janela acima da chamada para descobrir o cliente
      const antes = s.slice(Math.max(0, m.index - 2500), m.index)
      const iAdmin = antes.lastIndexOf('createAdminClient')
      const iUser = antes.lastIndexOf('createClient(')
      let cliente = 'indefinido'
      if (iAdmin >= 0 || iUser >= 0) cliente = iAdmin > iUser ? 'service_role' : 'sessao'
      // pagina publica? (sem login por desenho)
      const publica = /\/(sobreaviso|presenca|consultar-escala|login|resetar-senha|esqueci-a-senha)\//.test(p)
      out.push({ p, cliente, publica })
    }
  }
  return out
}

const grupos = { publica: [], sessao: [], service_role: [], sem_chamador: [], indefinido: [] }

for (const fn of abertas) {
  const cs = chamadores(fn)
  if (cs.length === 0) { grupos.sem_chamador.push({ fn, cs }); continue }
  if (cs.some(c => c.publica)) { grupos.publica.push({ fn, cs }); continue }
  if (cs.some(c => c.cliente === 'sessao')) { grupos.sessao.push({ fn, cs }); continue }
  if (cs.every(c => c.cliente === 'service_role')) { grupos.service_role.push({ fn, cs }); continue }
  grupos.indefinido.push({ fn, cs })
}

console.log(`Funcoes RPC alcancaveis por anon em ${U}: ${abertas.length}\n`)

const mostrar = (titulo, lista, nota) => {
  console.log(`${'='.repeat(78)}\n${titulo}  (${lista.length})\n${nota}\n${'='.repeat(78)}`)
  for (const { fn, cs } of lista) {
    const onde = [...new Set(cs.map(c => c.p.replace('src/app/', '').replace('src/', '')))]
    console.log(`  ${fn}${onde.length ? '   <- ' + onde.slice(0, 2).join(', ') : ''}`)
  }
  console.log('')
}

mostrar('FICAM ABERTAS — chamadas de pagina publica, sem login por desenho', grupos.publica,
  'Revogar aqui derruba o ciclo de sobreaviso / o terminal. A defesa delas e o token, nao o GRANT.')

mostrar('PRECISAM DE authenticated — chamadas com a sessao do usuario', grupos.sessao,
  'REVOKE de PUBLIC e anon, mas REAFIRMAR o GRANT a authenticated.')

mostrar('PODEM FECHAR DE VEZ — so chamadas com service_role', grupos.service_role,
  'REVOKE de PUBLIC, anon e authenticated; GRANT so a service_role.')

mostrar('SEM CHAMADOR no codigo — conferir uma a uma antes de fechar', grupos.sem_chamador,
  'Pode ser funcao interna (chamada por outra funcao SQL), envelope, ou codigo morto.')

if (grupos.indefinido.length) {
  mostrar('CLIENTE INDEFINIDO — ler o sitio', grupos.indefinido, 'A heuristica nao decidiu.')
}

console.log('='.repeat(78))
console.log(`RESUMO: ${grupos.publica.length} ficam abertas | ${grupos.sessao.length} viram authenticated | ` +
            `${grupos.service_role.length} fecham | ${grupos.sem_chamador.length} sem chamador | ${grupos.indefinido.length} a ler`)
console.log('='.repeat(78))

fs.writeFileSync('scratchpad/anon_rpcs.json', JSON.stringify(grupos, null, 2))
console.log('\ndetalhe completo em scratchpad/anon_rpcs.json')
