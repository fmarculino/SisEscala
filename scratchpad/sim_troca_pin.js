/**
 * Portao da regra de PIN (30/08/2026).
 *
 * Nao ha framework de teste no projeto; este script e' o portao, no mesmo formato de
 * sim_gestao_usuarios.js / sim_limite_carga.js.
 *
 * Transpile antes:
 *   npx tsc src/utils/pin.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *
 * ⚠️ O QUE ELE PROTEGE, e por que cada grupo esta aqui:
 *   A) a regra do PIN NOVO recusa o que tem de recusar E ACEITA o que tem de aceitar. Testar so'
 *      as recusas deixaria passar uma regra que recusa tudo.
 *   B) `gerarPin` produz PIN que PASSA na propria regra. O gerador antigo dava 4 digitos e o
 *      banco agora recusa - botao que gera valor invalido faz a tela parecer quebrada.
 *   C) o espelho TypeScript concorda com o SQL nos casos de fronteira (6 e 8 digitos).
 *   D) as Server Actions do portal NAO recebem `servidorId` — coberto por sim_portal_sessao.js,
 *      que roda em separado; aqui so' se confere que a nova action existe e deriva da sessao.
 */
const fs = require('fs')
const path = require('path')

const M = require('./_sim/pin.js')
const { conferirPinNovo, gerarPin, mensagemRecusaPin, PIN_MIN_DIGITOS, PIN_MAX_DIGITOS } = M

let passou = 0
const falhas = []

function ok(nome, cond, detalhe) {
  if (cond) passou++
  else falhas.push(nome + (detalhe ? ' -> ' + detalhe : ''))
}

// ── A) a regra ───────────────────────────────────────────────────────────────────────────────
const RECUSAS = [
  ['vazio', '', undefined],
  ['so espaco', '   ', undefined],
  ['letra no meio', '12a456', undefined],
  ['4 digitos (o formato legado)', '1234', undefined],
  ['5 digitos', '48392', undefined],
  ['9 digitos', '483920175', undefined],
  ['todos iguais', '000000', undefined],
  ['todos iguais 7', '7777777', undefined],
  ['sequencia crescente', '123456', undefined],
  ['sequencia decrescente', '654321', undefined],
  ['sequencia de 8', '12345678', undefined],
  ['igual a matricula', '205205', '205205'],
  ['igual a matricula temporaria', '1234567', 'T1234567'],
]
for (const [nome, pin, mat] of RECUSAS) {
  const r = conferirPinNovo(pin, mat)
  ok('recusa: ' + nome, r !== null, 'aceitou ' + JSON.stringify(pin))
}

const ACEITES = [
  ['6 digitos comuns', '483920', '57221'],
  ['8 digitos', '48392017', '57221'],
  ['com zero a esquerda', '048392', '57221'],
  ['repetido mas nao todo igual', '112233', '57221'],
  ['quase sequencia', '123457', '57221'],
  ['contem a matricula, mas nao e ela', '572213', '57221'],
]
for (const [nome, pin, mat] of ACEITES) {
  const r = conferirPinNovo(pin, mat)
  ok('aceita: ' + nome, r === null, 'recusou ' + JSON.stringify(pin) + ': ' + r)
}

// Fronteiras exatas — e' onde um `<` vira `<=` sem ninguem notar.
ok('fronteira: exatamente o minimo passa', conferirPinNovo('4'.repeat(1) + '83920'.slice(0, PIN_MIN_DIGITOS - 1), '1') === null)
ok('fronteira: minimo-1 recusa', conferirPinNovo('48392'.slice(0, PIN_MIN_DIGITOS - 1), '1') !== null)
ok('fronteira: exatamente o maximo passa', conferirPinNovo('48392017'.slice(0, PIN_MAX_DIGITOS), '1') === null)
ok('fronteira: maximo+1 recusa', conferirPinNovo('4'.repeat(PIN_MAX_DIGITOS + 1).replace(/4$/, '9'), '1') !== null)

// ── B) o gerador ─────────────────────────────────────────────────────────────────────────────
let gerados = new Set()
for (let i = 0; i < 2000; i++) {
  const pin = gerarPin('57221')
  const problema = conferirPinNovo(pin, '57221')
  if (problema) {
    falhas.push('gerarPin produziu PIN invalido: ' + pin + ' (' + problema + ')')
    break
  }
  gerados.add(pin)
}
ok('gerarPin: 2000 sorteios, todos validos', !falhas.some(f => f.startsWith('gerarPin produziu')))
ok('gerarPin: tem o tamanho minimo', gerarPin('1').length === PIN_MIN_DIGITOS)
// Um gerador que devolve sempre a mesma coisa passaria em tudo acima.
ok('gerarPin: varia de verdade', gerados.size > 1500, 'so ' + gerados.size + ' valores distintos em 2000')

// ── C) as mensagens ──────────────────────────────────────────────────────────────────────────
const CODIGOS = ['vazio', 'nao_numerico', 'curto', 'longo', 'repetido', 'sequencia', 'igual_matricula']
for (const c of CODIGOS) {
  const m = mensagemRecusaPin(c)
  // ⚠️ NAO basta "nao contem o codigo": 'repetido' e 'sequencia' sao palavras legitimas em
  // portugues e aparecem na frase certa. O que se quer e' que a mensagem seja uma FRASE, nao o
  // codigo cru vazando para a tela.
  ok('mensagem para ' + c,
     typeof m === 'string' && m.length > 15 && m !== c && m.trim().endsWith('.') && / /.test(m),
     'devolveu ' + JSON.stringify(m))
}
ok('codigo desconhecido tem fallback legivel',
   mensagemRecusaPin('motivo_que_nao_existe').includes(String(PIN_MIN_DIGITOS)))

// ── D) o SQL e o TypeScript contam a mesma historia ───────────────────────────────────────────
// Nao da' para executar o SQL daqui, mas da' para conferir que a migration EXERCITA os mesmos
// casos de fronteira que este portao — se um lado ganhar uma regra e o outro nao, e' aqui que
// aparece.
const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260830170000_troca_de_pin_pelo_servidor.sql'),
  'utf8'
)
for (const c of ['curto', 'repetido', 'sequencia', 'igual_matricula', 'nao_numerico', 'longo']) {
  ok('migration exercita o motivo ' + c, sql.includes("'" + c + "'"))
}
ok('migration testa um PIN VALIDO (nao so recusas)', /fn_validar_pin_novo\('483920'/.test(sql))

// 🚨 A assercao que protege os 826 PINs de 4 digitos ja emitidos.
ok('migration barra a regra de tamanho no caminho de LOGIN',
   sql.includes('fn_validar_pin_portal') && sql.includes("prosrc ILIKE '%fn_validar_pin_novo%'"))

// A troca tem de exigir o PIN atual e reusar o bloqueio de tentativas.
ok('RPC exige o PIN atual', /p_pin_atual/.test(sql))
ok('RPC reusa o contador de tentativas do login', /pin_failed_attempts\s*=\s*COALESCE\(pin_failed_attempts, 0\) \+ 1/.test(sql))
ok('RPC registra a troca em log', /INSERT INTO public\.logs_troca_pin/.test(sql))
ok('log NUNCA guarda o valor do PIN', !/logs_troca_pin[\s\S]{0,600}pin_acesso/.test(sql))

// O trigger e' o funil: sem ele, cada caminho de escrita novo teria de lembrar da regra.
ok('trigger de hash valida o PIN novo', /hash_servidor_pin[\s\S]*fn_validar_pin_novo/.test(sql))
// ⚠️ ARMADILHA 1: os dois guards do trigger original tem de sobreviver a recriacao.
ok('trigger preserva o guard de nao rehashear', /NOT LIKE '\$2a\$%' AND NEW\.pin_acesso NOT LIKE '\$2b\$%'/.test(sql))
ok('trigger preserva o guard IS DISTINCT FROM', /IS DISTINCT FROM OLD\.pin_acesso/.test(sql))

// A action do portal deriva da sessao (a varredura completa e' sim_portal_sessao.js).
const actions = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'consultar-escala', 'actions.ts'), 'utf8')
const corpo = actions.slice(actions.indexOf('export async function trocarPinPortal'))
ok('trocarPinPortal existe', corpo.length > 0)
ok('trocarPinPortal deriva o servidor da sessao', /const portalServidorId = await servidorDaSessao\(\)/.test(corpo.slice(0, 800)))
ok('trocarPinPortal NAO recebe servidorId do cliente',
   !/function trocarPinPortal\([^)]*servidorId/.test(actions))

// As telas do coordenador nao podem ter ficado com o gerador de 4 digitos.
for (const arq of [
  'src/app/(dashboard)/servidores/novo/page.tsx',
  'src/app/(dashboard)/servidores/[id]/EditServidorForm.tsx',
]) {
  const t = fs.readFileSync(path.join(__dirname, '..', arq), 'utf8')
  ok('gerador de 4 digitos removido de ' + path.basename(arq), !t.includes('Math.random() * 9000'))
  ok('usa gerarPin em ' + path.basename(arq), t.includes('gerarPin('))
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('')
console.log('  casos aprovados: ' + passou)
if (falhas.length) {
  console.log('  REPROVADO em ' + falhas.length + ':')
  for (const f of falhas) console.log('    - ' + f)
  process.exit(1)
}
console.log('')
console.log('APROVADO: regra de PIN novo vale so na escrita; login de PIN legado permanece intacto.')
