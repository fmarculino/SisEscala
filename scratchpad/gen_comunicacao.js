// Extrai o MOTOR de src/app/actions/communication.ts para src/utils/comunicacao/enviar.ts.
// Copia verbatim (preserva CRLF/LF), so' renomeia as duas funcoes exportadas e tira o 'use server'.
// Aborta em qualquer divergencia de contagem — padrao gen_*.js do projeto.
const fs = require('fs'), path = require('path')

const ORIG = 'src/app/actions/communication.ts'
const DEST = 'src/utils/comunicacao/enviar.ts'

const src = fs.readFileSync(ORIG, 'utf8')
const eol = src.includes('\r\n') ? '\r\n' : '\n'
const linhas = src.split(/\r?\n/)

function exigir(cond, msg) { if (!cond) { console.error('ABORTADO: ' + msg); process.exit(1) } }

// 1) Fronteiras conferidas contra o arquivo, nunca fixas no script
const iUseServer = linhas.findIndex(l => /^'use server'$/.test(l.trim()))
exigir(iUseServer === 0, "'use server' nao esta na linha 1")

const iWhats = linhas.findIndex(l => l.startsWith('export async function sendWhatsAppMessageAction'))
const iEmail = linhas.findIndex(l => l.startsWith('export async function sendEmailAction'))
const iTestW = linhas.findIndex(l => l.startsWith('export async function testWhatsAppConnectionAction'))
exigir(iWhats > 0 && iEmail > iWhats && iTestW > iEmail, 'ordem das funcoes inesperada')

// fim de sendEmailAction = ultima linha '}' antes do comentario do testWhats
let fimEmail = -1
for (let i = iTestW; i > iEmail; i--) { if (linhas[i] === '}') { fimEmail = i; break } }
exigir(fimEmail > iEmail, 'nao achei o fecho de sendEmailAction')

// 2) O motor e' tudo do inicio ate' o fim de sendEmailAction, SEM o 'use server'
let motor = linhas.slice(1, fimEmail + 1)

// 3) Renomeacoes — com contagem
const subs = [
  [/^export async function sendWhatsAppMessageAction\(/, 'export async function enviarWhatsAppInterno(', 1],
  [/^export async function sendEmailAction\(/,           'export async function enviarEmailInterno(',    1],
]
for (const [re, novo, esperado] of subs) {
  let n = 0
  motor = motor.map(l => { if (re.test(l)) { n++; return l.replace(re, novo) } return l })
  exigir(n === esperado, `esperava ${esperado} ocorrencia de ${re}, achei ${n}`)
}

// 4) Conferencias estruturais do resultado
const txt = motor.join(eol)
exigir(!/'use server'/.test(txt), "'use server' sobrou no motor")
exigir(!/sendWhatsAppMessageAction|sendEmailAction/.test(txt), 'nome antigo sobrou no motor')
exigir(/export async function enviarWhatsAppInterno\(/.test(txt), 'enviarWhatsAppInterno ausente')
exigir(/export async function enviarEmailInterno\(/.test(txt), 'enviarEmailInterno ausente')
// o corpo tem que continuar identico: mesma contagem de chaves e de fetch/createTransport
const corpoOrig = linhas.slice(1, fimEmail + 1).join(eol)
const norm = s => s.replace(/export async function \w+\(/g, 'export async function X(')
exigir(norm(corpoOrig) === norm(txt), 'o corpo divergiu do original (deveria ser copia verbatim)')

const cabecalho = [
  '// MOTOR de comunicacao (WhatsApp/SMTP). NAO e um arquivo \'use server\'.',
  '//',
  '// Extraido de src/app/actions/communication.ts em 30/08/2026 pelo script',
  '// scratchpad/gen_comunicacao.js — copia VERBATIM, so\' com os dois nomes trocados.',
  '//',
  '// POR QUE ESTE ARQUIVO EXISTE: enquanto o motor morava num arquivo \'use server\', cada',
  '// funcao exportada dele era uma Server Action — um POST cujo id vai no bundle do navegador,',
  '// chamavel por QUALQUER PESSOA, sem login. Como o envio aceitava `overrideConfigs` do',
  '// cliente e esse override VENCIA o config do banco, dava para: apontar a URL do provedor',
  '// para um host proprio e receber a X-API-Key real no cabecalho; apontar o host SMTP e',
  '// receber usuario/senha como AUTH; usar o servidor como proxy (SSRF); e disparar e-mail',
  '// arbitrario a partir do endereco oficial da Secretaria.',
  '//',
  '// Agora o motor e\' codigo de servidor comum: so\' alcanca quem o IMPORTA (rotas de API e',
  '// outras actions), nunca o navegador. As Server Actions ficaram em',
  '// src/app/actions/communication.ts como ENVELOPES que exigem sessao antes de delegar —',
  '// mesmo padrao de envelope da armadilha 1 do CLAUDE.md.',
  '//',
  '// ⚠️ NAO acrescente \'use server\' aqui, e NAO exporte estas funcoes de dentro de um arquivo',
  '// \'use server\': isso reabre exatamente o buraco descrito acima.',
  '',
].join(eol)

fs.mkdirSync(path.dirname(DEST), { recursive: true })
fs.writeFileSync(DEST, cabecalho + txt + eol, 'utf8')
console.log(`OK: ${DEST} (${motor.length} linhas de motor, verbatim)`)
console.log(`    sendWhatsAppMessageAction -> enviarWhatsAppInterno`)
console.log(`    sendEmailAction           -> enviarEmailInterno`)
console.log(`    envelopes que restam em ${ORIG}: linhas ${fimEmail + 2}..${linhas.length}`)
