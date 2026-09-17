/**
 * Os cards de Terminal e de Dispositivo REP nao encolhiam.
 *
 * Num container flex, o filho NAO encolhe abaixo do proprio `min-content` sem `min-w-0` — e o
 * card de dispositivo carrega a lista de setores atendidos, que no HMM tem dezenas de nomes numa
 * linha so. Sem isso, um card empurra a largura da pagina inteira e devolve a rolagem horizontal
 * que a quebra das abas acabou de tirar. O bloco de acoes ganha `shrink-0` pelo motivo inverso:
 * os botoes de editar e excluir nunca podem ser espremidos a nada.
 */
const fs = require('fs')
const path = 'src/app/(dashboard)/marcacoes/MarcacoesClient.tsx'
let src = fs.readFileSync(path, 'utf8')
const EOL = src.includes('\r\n') ? '\r\n' : '\n'
const L = (...linhas) => linhas.join(EOL)

if (src.includes('min-w-0 flex-1')) {
  console.log('JA APLICADO — nada a fazer')
  process.exit(0)
}

// Os dois cards: o texto encolhe, as acoes nao.
const CARD = '                <div key={CHAVE} className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">' + EOL +
             '                  <div className="min-w-0 flex-1">'

for (const [chave, nome] of [['t.id', 'terminal'], ['d.id', 'dispositivo']]) {
  const de = L(
    '                <div key={' + chave + '} className="flex items-center justify-between p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">',
    '                  <div>'
  )
  if (src.split(de).length - 1 !== 1) {
    console.error('ABORTADO: card de ' + nome + ' — esperava 1 ocorrencia, achei ' + (src.split(de).length - 1))
    process.exit(1)
  }
  src = src.split(de).join(CARD.replace('CHAVE', chave))
}

const ACOES = '                  <div className="flex items-center gap-1">'
const n = src.split(ACOES).length - 1
if (n !== 2) {
  console.error('ABORTADO: esperava 2 blocos de acoes, achei ' + n)
  process.exit(1)
}
src = src.split(ACOES).join('                  <div className="flex shrink-0 items-center gap-1">')

const invariantes = [
  ['badge de id preservado', '<IdCopyBadge id={d.id} />'],
  ['acao de editar preservada', "title=\"Editar / gerar token\""],
  ['lista de setores do dispositivo preservada', 'd.dispositivos_rep_setores || []']
]
for (const [nome, marca] of invariantes) {
  if (!src.includes(marca)) {
    console.error('ABORTADO: invariante perdida — ' + nome)
    process.exit(1)
  }
}

fs.writeFileSync(path, src)
console.log('OK: cards encolhem, acoes nao (EOL=' + (EOL === '\r\n' ? 'CRLF' : 'LF') + ')')
