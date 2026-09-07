// Portao da leitura do nome da jornada (06/09/2026).
//
// O horario previsto de quem tem jornada Regular sai do NOME dela, por regex. Essa leitura estava
// em 14 sitios, cada um com o seu padrao, e 12 nao aceitavam `Á` (A agudo) - as jornadas
// `08H ÁS 20H` e `09H ÁS 21H` existem no catalogo e sao selecionaveis. Caindo no default de
// 08:00-17:00, uma jornada que vai ate 20:00 gera 3h de hora extra fabricada POR DIA, em silencio.
//
// Duas metades, e as duas importam:
//   PARTE A - o COMPORTAMENTO da normalizacao (aceita o acento, preserva a caixa).
//   PARTE B - a COBERTURA no codigo-fonte: nenhum sitio pode voltar a ler o nome sem normalizar.
//             E' a parte que impede o defeito de voltar por um sitio novo.
//
// Transpile antes:
//   npx tsc src/utils/folha/nomeJornada.ts --outDir scratchpad/_sim_jornada --module commonjs --target es2020
// Rodar:  node scratchpad/sim_nome_jornada.js
'use strict'
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const { normalizarNomeJornada } = require('./_sim_jornada/nomeJornada')

let total = 0
let falhas = 0
function ok(nome, achado, esperado) {
  total++
  const a = JSON.stringify(achado)
  const e = JSON.stringify(esperado)
  if (a === e) console.log(`  ok   ${nome}`)
  else { falhas++; console.log(`  FALHA ${nome}\n        esperado: ${e}\n        achado:   ${a}`) }
}

// ===========================================================================
// PARTE A - comportamento
// ===========================================================================
console.log('\nA1. o acento vira `a`, preservando a caixa')
ok('A agudo maiusculo', normalizarNomeJornada('08H ÁS 20H'), '08H AS 20H')
ok('crase maiuscula (o caso que ja funcionava)', normalizarNomeJornada('08H ÀS 18H'), '08H AS 18H')
ok('minusculas viram `a` minusculo', normalizarNomeJornada('08h ás 20h'), '08h as 20h')
ok('sem acento passa intacto', normalizarNomeJornada('08H AS 12H'), '08H AS 12H')
ok('nulo vira string vazia', normalizarNomeJornada(null), '')
ok('indefinido vira string vazia', normalizarNomeJornada(undefined), '')

// 🚨 A caixa NAO pode ser achatada. Metade dos regex do projeto nao tem a flag /i e so casa `AS`
// maiusculo (ScaleGrid, complianceEngine): mapear tudo para minusculo consertaria o `Á` e
// QUEBRARIA esses - trocaria um bug por outro, e o novo seria mais amplo.
console.log('\nA2. a caixa e preservada (senao os regex sem /i quebram)')
ok('nao achata para minusculo', normalizarNomeJornada('08H ÁS 20H').includes('AS'), true)
ok('nao achata para maiusculo', normalizarNomeJornada('08h ás 20h').includes('as'), true)

console.log('\nA3. so o separador e afetado')
ok('digitos e H intactos', normalizarNomeJornada('12H ÁS 18H'), '12H AS 18H')
ok('texto sem separador nao muda', normalizarNomeJornada('PLANTAO 12H'), 'PLANTAO 12H')

// ===========================================================================
// A4 - os padroes REAIS do projeto passam a casar
// ===========================================================================
// Cada um destes existe hoje em algum arquivo. O teste e' o mesmo para todos: com `Á` cru nao
// casa; normalizado, casa - e devolve o horario certo, nao o default de 08:00-17:00.
console.log('\nA4. os padroes reais do projeto, com `Á`')
const PADROES = [
  ['parseJornadaNome (folha-ponto, consultar-escala, normalizarHorarios, sequenciaDia)',
   /(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i],
  ['getShiftStartHour / getShiftEndHour (ScaleGrid, sem flag i)',
   /^([0-9]+)\s*H\s*(?:AS|ÀS|A)\s*([0-9]+)\s*H/],
  ['fim da jornada (complianceGrid / ScaleGrid, sem flag i)',
   /(?:ÀS|AS|as|às)\s*([0-9]+)/],
  ['ancora do plantao (ScaleGrid, com flag i)',
   /(?:ÀS|AS|A)\s*([0-9]+)/i],
]
for (const [nome, re] of PADROES) {
  ok(`"08H ÁS 20H" NAO casava cru — ${nome}`, re.test('08H ÁS 20H'), false)
  ok(`e casa normalizado — ${nome}`, re.test(normalizarNomeJornada('08H ÁS 20H')), true)
}

// O numero que importa: com `Á`, parseJornadaNome devolvia 17 como fim (default) numa jornada
// que vai ate 20. Sao 3h de extra fabricada por dia.
const rePar = /(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i
const mBom = normalizarNomeJornada('08H ÁS 20H').match(rePar)
ok('o fim previsto passa a ser 20, nao o default 17', mBom && parseInt(mBom[3], 10), 20)

// ===========================================================================
// PARTE B - cobertura no codigo-fonte
// ===========================================================================
// Um sitio novo que leia o nome sem normalizar reintroduz o defeito, e o modo de falha e
// silencioso. Esta varredura e a unica coisa que impede isso.
console.log('\nB. nenhum sitio le o nome da jornada sem normalizar')

function arquivosTs(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') arquivosTs(p, acc) }
    else if (/\.tsx?$/.test(e.name)) acc.push(p)
  }
  return acc
}

// Linha que casa um nome de jornada por regex: contem `.match(` ou `.exec(` E um separador de
// horario no padrao. O manual (ajuda/conteudo) so cita exemplos em texto, nao le nada.
const SEPARADOR = /ÀS\|AS|AS\|ÀS|às\|as|as\|às|ÁS\|A|AS\|ÁS|\(\?:às\|as\|to\|-\|a\)/
const semNormalizar = []
for (const arq of arquivosTs(path.join(RAIZ, 'src'))) {
  if (arq.includes(path.join('ajuda', 'conteudo'))) continue
  const linhas = fs.readFileSync(arq, 'utf8').split('\n')
  linhas.forEach((linha, i) => {
    if (!/\.match\(|\.exec\(/.test(linha)) return
    if (!SEPARADOR.test(linha)) return
    if (linha.includes('normalizarNomeJornada')) return
    // vigiaRevezamento ja aceita `ÁS` explicitamente no proprio padrao - conferido abaixo.
    if (arq.endsWith('vigiaRevezamento.ts')) return
    semNormalizar.push(`${path.relative(RAIZ, arq)}:${i + 1}`)
  })
}
ok('nenhum sitio remanescente', semNormalizar, [])

// vigiaRevezamento e a excecao consciente: o padrao dele ja tem `ÁS`. Se alguem tirar, o portao
// pega - a excecao vale enquanto a defesa propria dele existir.
const vigia = fs.readFileSync(path.join(RAIZ, 'src', 'utils', 'vigiaRevezamento.ts'), 'utf8')
ok('vigiaRevezamento continua aceitando `ÁS` no proprio padrao', /ÀS\|AS\|ÁS\|A/.test(vigia), true)

// A regra do acento tem que existir em UM lugar so. O replace inline de calculoDia foi para a
// fonte unica; se voltar, sao duas regras que podem divergir.
console.log('\nB2. a regra do acento existe num lugar so')
const comReplaceInline = arquivosTs(path.join(RAIZ, 'src'))
  .filter((a) => !a.endsWith('nomeJornada.ts'))
  .filter((a) => /replace\(\/\[ÀÁàá\]\/g/.test(fs.readFileSync(a, 'utf8')))
  .map((a) => path.relative(RAIZ, a))
ok('nenhum replace de acento fora de nomeJornada.ts', comReplaceInline, [])

console.log(`\n${total - falhas}/${total} asercoes passaram.`)
if (falhas > 0) { console.log(`\n${falhas} FALHA(S).`); process.exit(1) }
