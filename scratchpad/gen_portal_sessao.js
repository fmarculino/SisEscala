// Troca a leitura do cookie CRU do portal pela sessao ASSINADA, em
// src/app/consultar-escala/actions.ts. Mecanico, com contagem, e ABORTA em qualquer
// divergencia — padrao gen_*.js do projeto (CLAUDE.md, armadilha 1).
//
// ⚠️ NAO redigite as acoes a mao: sao 30 funcoes e a que for esquecida continua aceitando
// identidade do cliente sem nenhum sintoma.
const fs = require('fs')

const P = 'src/app/consultar-escala/actions.ts'
let s = fs.readFileSync(P, 'utf8')
const eol = s.includes('\r\n') ? '\r\n' : '\n'

function exigir(c, m) { if (!c) { console.error('ABORTADO: ' + m); process.exit(1) } }

// ── 1) import da sessao assinada, logo apos o import de `cookies`
const impCookies = "import { cookies } from 'next/headers'"
exigir(s.includes(impCookies), 'import de next/headers nao encontrado')
exigir(!s.includes('portalSession'), 'o arquivo ja parece transformado')
s = s.replace(impCookies, () => impCookies + eol +
  "import { PORTAL_COOKIE, PORTAL_COOKIE_LEGADO, criarSessaoPortal, validarSessaoPortal, opcoesCookiePortal } from '@/utils/portalSession'")

// ── 2) helper unico, inserido logo antes da primeira action
const marca = 'export async function findServidorByMatricula'
exigir(s.includes(marca), 'findServidorByMatricula nao encontrada')
const helper = [
  '/**',
  ' * Identidade do servidor logado no Portal — FONTE UNICA.',
  ' *',
  ' * ⚠️ Toda Server Action do portal DERIVA a identidade daqui. Nenhuma pode receber',
  ' * `servidorId` do cliente: ate 30/08/2026, 12 delas recebiam, com `createAdminClient()`',
  ' * (que ignora RLS) e sem consultar o cookie — bastava passar o UUID de outra pessoa.',
  ' * Quatro dessas 12 ESCREVIAM (ferias, contraproposta), ou seja, agiam em nome de outro',
  ' * servidor sem nunca ter tido a credencial dele.',
  ' *',
  ' * Devolve `null` quando nao ha sessao valida; quem chama responde "Sessao expirada".',
  ' * Portao: scratchpad/sim_portal_sessao.js.',
  ' */',
  'async function servidorDaSessao(): Promise<string | null> {',
  '  const cookieStore = await cookies()',
  '  return validarSessaoPortal(cookieStore.get(PORTAL_COOKIE)?.value)',
  '}',
  '',
  '',
].join(eol)
s = s.replace(marca, () => helper + marca)

// ── 3) leituras do cookie cru -> sessao assinada
//    Confirmado por analise previa: nas funcoes que LEEM, `cookieStore` so' e' usado para `.get`,
//    entao a declaracao dele pode sair junto.
const reLeitura = new RegExp(
  '([ \\t]*)const cookieStore = await cookies\\(\\)' + eol +
  '[ \\t]*const portalServidorId = (?:servidorId \\|\\| )?cookieStore\\.get\\(\'portal_servidor_id\'\\)\\?\\.value',
  'g')
const achadas = (s.match(reLeitura) || []).length
const ESPERADO = 13   // 15 sitios com o cookie, menos validatePin (.set) e logoutPortal (.delete)
exigir(achadas === ESPERADO, `esperava ${ESPERADO} leituras do cookie cru, achei ${achadas}`)
s = s.replace(reLeitura, (_m, ind) => `${ind}const portalServidorId = await servidorDaSessao()`)

// ── 4) nada pode continuar lendo o cookie cru
const sobrou = (s.match(/cookieStore\.get\('portal_servidor_id'\)/g) || []).length
exigir(sobrou === 0, `${sobrou} leitura(s) do cookie cru sobraram`)

// ── 5) o `servidorId ||` (parametro do cliente vencendo o cookie) tem que ter sumido
exigir(!/servidorId \|\| cookieStore/.test(s), 'o padrao `servidorId || cookie` sobrou')

// ── 6) o helper tem que ser a UNICA porta de entrada da identidade
const chamadasHelper = (s.match(/await servidorDaSessao\(\)/g) || []).length
exigir(chamadasHelper === ESPERADO, `esperava ${ESPERADO} chamadas ao helper, achei ${chamadasHelper}`)

fs.writeFileSync(P, s, 'utf8')
console.log(`OK: ${achadas} leituras do cookie cru trocadas por servidorDaSessao()`)
console.log('    helper inserido; import adicionado; nenhuma leitura crua restante')
console.log('    FALTA A MAO: validatePin, findServidorByMatricula, logoutPortal e as 12 acoes')
console.log('    que recebiam servidorId/solicitacaoId do cliente.')
