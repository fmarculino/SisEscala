// Tira `servidorId` da ASSINATURA das Server Actions do portal e passa a DERIVA-LO da sessao
// assinada. O corpo das funcoes nao muda: elas continuam usando a variavel `servidorId`, que
// agora vem do cookie em vez de vir do cliente.
//
// POR QUE DERIVAR E NAO COMPARAR
//   Comparar (`if (portalServidorId !== servidorId) return erro`) tambem fecharia o buraco, mas
//   exige que CADA acao nova lembre de fazer a comparacao — e 12 das 30 acoes do portal nao
//   lembraram. Derivar torna o erro impossivel de cometer: nao existe mais um `servidorId` do
//   cliente para confundir com o da sessao.
//
// GANHO DE GRACA: as acoes de ferias ja' filtravam `.eq('servidor_id', servidorId)`. Trocando a
// origem do valor, a verificacao de POSSE passa a valer sem escrever uma linha de checagem.
//
// ABORTA em qualquer divergencia — padrao gen_*.js do projeto.
const fs = require('fs')

const P = 'src/app/consultar-escala/actions.ts'
let s = fs.readFileSync(P, 'utf8')
const eol = s.includes('\r\n') ? '\r\n' : '\n'

function exigir(c, m) { if (!c) { console.error('ABORTADO: ' + m); process.exit(1) } }

const GUARD = [
  '  const servidorId = await servidorDaSessao()',
  "  if (!servidorId) return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }",
  '',
].join(eol)

// [nome, assinatura antiga (depois do nome), assinatura nova]
const ALVOS = [
  ['getServidorEscalas',                   '(servidorId: string)',                                  '()'],
  ['getSolicitacoesServidor',              '(servidorId: string)',                                  '()'],
  ['verificarElegibilidadeServidorFerias', '(servidorId: string)',                                  '()'],
  ['getJustificativasServidor',            '(servidorId: string, mes: number, ano: number)',        '(mes: number, ano: number)'],
  ['cancelarSolicitacaoServidor',          '(solicitacaoId: string, servidorId: string)',           '(solicitacaoId: string)'],
  ['aceitarContraproposta',                '(solicitacaoId: string, servidorId: string)',           '(solicitacaoId: string)'],
  ['rejeitarContraproposta',               '(solicitacaoId: string, servidorId: string)',           '(solicitacaoId: string)'],
  ['getDadosRequerimento',                 '(solicitacaoId: string, servidorId: string)',           '(solicitacaoId: string)'],
]

let n = 0
for (const [nome, sigAntiga, sigNova] of ALVOS) {
  const alvo = `export async function ${nome}${sigAntiga} {`
  const ocorrencias = s.split(alvo).length - 1
  exigir(ocorrencias === 1, `esperava 1 ocorrencia de "${alvo}", achei ${ocorrencias}`)
  const novo = `export async function ${nome}${sigNova} {${eol}${GUARD}`
  s = s.replace(alvo, () => novo)
  n++
}

// getSwapRequests ja' foi corrigida pelo gen_portal_sessao.js (a leitura do cookie virou
// servidorDaSessao). Aqui so' cai o parametro morto que o cliente ainda podia mandar.
const swapAntiga = 'export async function getSwapRequests(servidorId?: string) {'
exigir(s.includes(swapAntiga), 'getSwapRequests com a assinatura esperada nao encontrada')
s = s.replace(swapAntiga, () => 'export async function getSwapRequests() {')
n++

// ── Conferencias estruturais
const aindaRecebem = [...s.matchAll(/export async function (\w+)\(([^)]*)\)/g)]
  .filter(m => /\bservidorId\b/.test(m[2]))
  .map(m => m[1])
console.log(`OK: ${n} acoes passaram a derivar a identidade da sessao.`)
if (aindaRecebem.length) {
  console.log(`\n⚠️  AINDA recebem servidorId na assinatura (tratar a mao): ${aindaRecebem.join(', ')}`)
}

// O helper tem que continuar sendo a unica porta
const semGuard = []
{
  const L = s.split(eol)
  const st = []
  L.forEach((l, i) => { if (/^export async function /.test(l)) st.push(i) })
  st.push(L.length)
  for (let k = 0; k < st.length - 1; k++) {
    const corpo = L.slice(st[k], st[k + 1]).join(eol)
    const nome = /export async function (\w+)/.exec(L[st[k]])[1]
    if (!corpo.includes('servidorDaSessao')) semGuard.push(nome)
  }
}
console.log(`\nSEM nenhuma leitura de sessao (conferir uma a uma): ${semGuard.join(', ') || '(nenhuma)'}`)

fs.writeFileSync(P, s, 'utf8')
