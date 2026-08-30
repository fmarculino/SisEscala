// Prova funcional da sessao do portal: o cookie assinado resiste a forja?
//
// Roda:  node scratchpad/sim_portal_cookie.mjs
//
// Reimplementa o esquema de src/utils/portalSession.ts (o .ts nao roda direto em node sem
// transpilar). ⚠️ Se o esquema mudar la, mude aqui — este arquivo e' a demonstracao, nao a
// fonte. As duas propriedades que ele prova sao as que a auditoria derrubou:
//   1. o UUID sozinho NAO abre sessao (era o achado 1: cookie era o UUID cru);
//   2. trocar o servidor_id dentro do payload invalida a assinatura.
import crypto from 'node:crypto'

const CONTEXTO = 'sisescala:portal-servidor:v1'
const MAX_AGE = 4 * 60 * 60
const SEGREDO = 'segredo-de-teste-nao-e-o-de-producao'

const sign = (p, s) => crypto.createHmac('sha256', s).update(`${CONTEXTO}.${p}`).digest('hex')

function criar(servidorId, secret = SEGREDO, iat = Date.now()) {
  const p = Buffer.from(JSON.stringify({ servidor_id: servidorId, iat })).toString('base64url')
  return `${p}.${sign(p, secret)}`
}

function validar(cookie, secret = SEGREDO) {
  if (!cookie) return null
  const partes = cookie.split('.')
  if (partes.length !== 2) return null
  const [p, assin] = partes
  if (!p || !assin) return null
  const esperada = Buffer.from(sign(p, secret), 'hex')
  const recebida = Buffer.from(assin, 'hex')
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) return null
  let payload
  try { payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) } catch { return null }
  if (!payload.servidor_id || typeof payload.servidor_id !== 'string') return null
  if (typeof payload.iat !== 'number') return null
  if (Date.now() - payload.iat > MAX_AGE * 1000) return null
  return payload.servidor_id
}

const EU = '11111111-1111-1111-1111-111111111111'
const VITIMA = '22222222-2222-2222-2222-222222222222'

const casos = []
const caso = (nome, real, esperado) => casos.push({ nome, ok: real === esperado, real, esperado })

// ── o caminho feliz
caso('sessao valida devolve o proprio servidor', validar(criar(EU)), EU)

// ── ATAQUE 1: o do achado 1 — mandar o UUID cru como cookie
caso('UUID cru NAO abre sessao (achado 1)', validar(VITIMA), null)

// ── ATAQUE 2: payload trocado, assinatura mantida
{
  const meu = criar(EU)
  const forjado = Buffer.from(JSON.stringify({ servidor_id: VITIMA, iat: Date.now() })).toString('base64url')
    + '.' + meu.split('.')[1]
  caso('trocar o servidor_id invalida a assinatura', validar(forjado), null)
}

// ── ATAQUE 3: payload da vitima assinado com OUTRO segredo
caso('assinatura com segredo errado e recusada', validar(criar(VITIMA, 'outro-segredo')), null)

// ── ATAQUE 4: cookie de OUTRO contexto (separacao de dominio)
{
  const outroContexto = (() => {
    const p = Buffer.from(JSON.stringify({ servidor_id: VITIMA, iat: Date.now() })).toString('base64url')
    // mesmo SEGREDO, contexto do terminal local
    return `${p}.${crypto.createHmac('sha256', SEGREDO).update(`sisescala:terminal-local:v1.${p}`).digest('hex')}`
  })()
  caso('cookie de outro contexto e recusado (mesmo segredo)', validar(outroContexto), null)
}

// ── ATAQUE 5: sessao expirada
caso('sessao expirada e recusada', validar(criar(EU, SEGREDO, Date.now() - (MAX_AGE + 60) * 1000)), null)

// ── lixo
for (const lixo of ['', 'abc', 'a.b', 'a.b.c', '.', 'x.'.repeat(3)]) {
  caso(`lixo ${JSON.stringify(lixo)} e recusado`, validar(lixo), null)
}

let falhas = 0
for (const c of casos) {
  console.log(`  ${c.ok ? 'ok  ' : 'FALHA'}  ${c.nome}`)
  if (!c.ok) { falhas++; console.log(`         esperado=${c.esperado} real=${c.real}`) }
}
console.log(`\n${casos.length - falhas}/${casos.length} casos passaram`)
process.exit(falhas ? 1 : 0)
