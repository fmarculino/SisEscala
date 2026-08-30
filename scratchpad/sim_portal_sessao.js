// PORTAO do Portal do Servidor (nao ha framework de teste no projeto).
//
// Roda:  node scratchpad/sim_portal_sessao.js
//
// O QUE ELE DEFENDE
//   Ate 30/08/2026, 12 das 30 Server Actions de src/app/consultar-escala/actions.ts aceitavam
//   `servidorId`/`solicitacaoId` do cliente, com `createAdminClient()` (que ignora RLS), sem
//   consultar o cookie. Quatro delas ESCREVIAM. Nenhuma revisao de codigo pegou isso porque cada
//   acao, lida sozinha, parece razoavel — o defeito so aparece na CONTAGEM.
//
//   Este portao reprova, uma a uma:
//     1. acao que recebe `servidorId` na assinatura (identidade tem que vir da sessao);
//     2. acao que usa `createAdminClient` sem nenhuma leitura de sessao;
//     3. qualquer leitura do cookie CRU `portal_servidor_id`;
//     4. o padrao `servidorId || cookie` (parametro do cliente vencendo a sessao);
//     5. cookie de sessao gravado sem passar por `criarSessaoPortal`.
//
// ⚠️ Ao acrescentar acao nova ao portal, rode isto. Se ele reprovar, o certo quase sempre e'
// derivar a identidade de `servidorDaSessao()` — nao adicionar excecao aqui.
const fs = require('fs')

const P = 'src/app/consultar-escala/actions.ts'
const src = fs.readFileSync(P, 'utf8')
const L = src.split(/\r?\n/)

// Acoes que legitimamente NAO leem sessao, com o motivo. Qualquer nome novo aqui precisa de
// justificativa escrita — e' a lista que transforma "esqueci" em "decidi".
const SEM_SESSAO_OK = {
  findServidorByMatricula:
    'anterior ao login; devolve so o NOME para a tela confirmar a pessoa. Nao devolve o id.',
  validatePin:
    'e o proprio login: recebe (matricula, PIN) e ABRE a sessao.',
  logoutPortal:
    'apaga os cookies; nao le nem devolve dado.',
  checkIfFolhaHasPendingPastTimes:
    'funcao pura sobre os objetos recebidos; nao acessa banco nem identidade.',
  checkFolhaPontoHabilitada:
    'le uma flag booleana de configuracao global; nao ha dado pessoal envolvido.',
  checkJustificativasHabilitada:
    'idem checkFolhaPontoHabilitada.',
}

const inicios = []
L.forEach((l, i) => { if (/^export async function /.test(l)) inicios.push(i) })
inicios.push(L.length)

const falhas = []
const acoes = []

for (let k = 0; k < inicios.length - 1; k++) {
  const a = inicios[k]
  const corpo = L.slice(a, inicios[k + 1]).join('\n')
  const nome = /export async function (\w+)/.exec(L[a])[1]

  // assinatura: do nome ate o ') {' que fecha os parametros
  const abre = corpo.indexOf('(')
  const fecha = corpo.indexOf(') {')
  const assinatura = fecha > abre ? corpo.slice(abre, fecha + 1) : ''

  const leSessao = corpo.includes('servidorDaSessao(')
  const usaAdmin = corpo.includes('createAdminClient')
  const recebeServidorId = /\bservidorId\b/.test(assinatura)

  acoes.push({ nome, leSessao, usaAdmin, recebeServidorId })

  // 1. identidade nunca vem do cliente
  if (recebeServidorId) {
    falhas.push(`${nome}: recebe \`servidorId\` na assinatura. Derive de servidorDaSessao().`)
  }

  // 2. service_role sem sessao
  if (usaAdmin && !leSessao && !(nome in SEM_SESSAO_OK)) {
    falhas.push(
      `${nome}: usa createAdminClient (ignora RLS) e nao le a sessao. ` +
      'Chame servidorDaSessao() ou justifique em SEM_SESSAO_OK.')
  }

  // a lista de excecao nao pode envelhecer em silencio
  if ((nome in SEM_SESSAO_OK) && leSessao) {
    falhas.push(`${nome}: esta em SEM_SESSAO_OK mas JA le a sessao. Tire-a da lista.`)
  }
}

// 3/4/5 — propriedades do arquivo inteiro
if (/cookieStore\.get\('portal_servidor_id'\)/.test(src)) {
  falhas.push("alguem voltou a LER o cookie cru 'portal_servidor_id'. Use PORTAL_COOKIE + validarSessaoPortal.")
}
if (/servidorId \|\| cookieStore|servidorId \|\| portalServidorId/.test(src)) {
  falhas.push('padrao `servidorId || <sessao>`: o parametro do cliente vence a sessao.')
}
const setsDeCookie = (src.match(/cookieStore\.set\(/g) || []).length
const setsAssinados = (src.match(/cookieStore\.set\(PORTAL_COOKIE, /g) || []).length
if (setsDeCookie !== setsAssinados) {
  falhas.push(`${setsDeCookie - setsAssinados} cookie(s) gravado(s) sem criarSessaoPortal/PORTAL_COOKIE.`)
}
// nomes da lista de excecao que nao existem mais
for (const nome of Object.keys(SEM_SESSAO_OK)) {
  if (!acoes.some(x => x.nome === nome)) {
    falhas.push(`SEM_SESSAO_OK cita "${nome}", que nao existe mais. Limpe a lista.`)
  }
}

// ⚠️ Estes numeros sao MEDIDOS, nunca literais. Escrever "0 recebem servidorId" fixo faria o
// resumo contradizer o veredito quando houvesse regressao — a armadilha 22 do CLAUDE.md
// (relatar o que se espera em vez do que aconteceu) dentro do proprio portao.
const comSessao = acoes.filter(x => x.leSessao).length
const recebemId = acoes.filter(x => x.recebeServidorId).length
const semJustificativa = acoes.filter(x => !x.leSessao && !(x.nome in SEM_SESSAO_OK)).length
console.log(`Portal: ${acoes.length} Server Actions`)
console.log(`  ${comSessao} derivam a identidade da sessao assinada`)
console.log(`  ${acoes.length - comSessao} sem sessao (${semJustificativa} SEM justificativa em SEM_SESSAO_OK)`)
console.log(`  ${recebemId} recebem servidorId do cliente\n`)

if (falhas.length) {
  console.error('REPROVADO:')
  for (const f of falhas) console.error('  - ' + f)
  process.exit(1)
}
console.log('APROVADO: identidade do portal so entra pela sessao assinada.')
