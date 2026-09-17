/**
 * Manual: o Aplicar Template deixou de preencher feriado (issue #5).
 *
 * O CLAUDE.md exige o manual no MESMO commit da mudanca que altera o que o usuario ve ou faz —
 * e aqui o comportamento mudou: uma caixa nova, marcada por padrao, tira dias da escala.
 */
const fs = require('fs')
const path = 'src/app/(dashboard)/ajuda/conteudo/escalas.ts'
let src = fs.readFileSync(path, 'utf8')
const EOL = src.includes('\r\n') ? '\r\n' : '\n'
const L = (...linhas) => linhas.join(EOL)

if (src.includes('Feriado não é preenchido')) {
  console.log('JA APLICADO — nada a fazer')
  process.exit(0)
}

const ANCORA = L(
  "        {",
  "          tipo: 'lista',",
  "          itens: [",
  "            'Dá para pedir que ele **pule dias de afastamento**, e vale a pena deixar marcado.',",
  "            'Ele **nunca sobrescreve** dia que já tem ponto batido.',",
  "          ],",
  "        },"
)

if (src.split(ANCORA).length - 1 !== 1) {
  console.error('ABORTADO: ancora da lista do template nao encontrada exatamente uma vez')
  process.exit(1)
}

const NOVO = L(
  "        {",
  "          tipo: 'lista',",
  "          itens: [",
  "            'Dá para pedir que ele **pule dias de afastamento**, e vale a pena deixar marcado.',",
  "            'Ele **nunca sobrescreve** dia que já tem ponto batido.',",
  "            'Ele **não preenche feriado** — a caixa vem marcada, e o modal mostra quais são os feriados do mês.',",
  "          ],",
  "        },",
  "        {",
  "          tipo: 'aviso',",
  "          tom: 'atencao',",
  "          titulo: 'Feriado não é preenchido',",
  "          texto:",
  "            'Na maioria dos setores o servidor não trabalha no feriado, e preencher o dia junto com **Validar dias passados** registrava uma presença que depois **não dá para apagar** — a célula com ponto fica protegida. Por isso o feriado fica de fora, como já acontecia com sábado e domingo na escala de segunda a sexta. **Se houve trabalho no feriado, lance o dia à mão** (ou desmarque a caixa antes de aplicar, se a equipe trabalha em todo feriado).',",
  "        },",
  "        {",
  "          tipo: 'aviso',",
  "          tom: 'dica',",
  "          titulo: 'A mensagem do fim diz o que ficou de fora',",
  "          texto:",
  "            'Ao terminar, ele lista os dias que **não** preencheu e o motivo de cada grupo: ponto já batido, afastamento, escala em outro setor e feriado. Vale ler antes de salvar — é ali que você descobre o que ainda precisa lançar à mão.',",
  "        },"
)

src = src.split(ANCORA).join(NOVO)

const invariantes = [
  ['secao preservada', "id: 'preencher-rapido',"],
  ['gerador inteligente preservado', 'Gerador Inteligente'],
  ['aviso do relato do gerador preservado', 'Leia a mensagem do fim']
]
for (const [nome, marca] of invariantes) {
  if (!src.includes(marca)) {
    console.error('ABORTADO: invariante perdida — ' + nome)
    process.exit(1)
  }
}

fs.writeFileSync(path, src)
console.log('OK: manual atualizado (EOL=' + (EOL === '\r\n' ? 'CRLF' : 'LF') + ')')
