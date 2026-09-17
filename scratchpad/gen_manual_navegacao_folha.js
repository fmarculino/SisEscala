/**
 * Acrescenta ao manual (SUPORTE > Ajuda) a navegacao entre folhas de ponto.
 *
 * O CLAUDE.md exige que o manual entre no MESMO commit da mudanca que altera o que o usuario ve
 * ou faz: manual desatualizado ensina o caminho errado com a autoridade de documentacao oficial.
 */
const fs = require('fs')
const path = 'src/app/(dashboard)/ajuda/conteudo/ponto.ts'
let src = fs.readFileSync(path, 'utf8')
const EOL = src.includes('\r\n') ? '\r\n' : '\n'
const L = (...linhas) => linhas.join(EOL)

const ANCORA = L(
  "        { tipo: 'titulo', texto: 'Gerar e sincronizar' },"
)

if (src.split(ANCORA).length - 1 !== 1) {
  console.error('ABORTADO: ancora do capitulo da folha nao encontrada exatamente uma vez')
  process.exit(1)
}

const NOVO = L(
  "        { tipo: 'titulo', texto: 'Andar pelas folhas sem voltar à lista' },",
  "        {",
  "          tipo: 'p',",
  "          texto:",
  "            'No topo da folha há uma barra de navegação. Ela percorre **a mesma lista** que você tinha em Folha de Ponto, na mesma ordem: se você filtrou por um setor, as setas andam só por aquele setor.',",
  "        },",
  "        {",
  "          tipo: 'tabela',",
  "          colunas: ['Botão', 'O que faz'],",
  "          linhas: [",
  "            ['Voltar à lista', 'Devolve a listagem **com os filtros e a página** que você tinha. Você não precisa escolher tudo de novo.'],",
  "            ['Anterior / Próxima', 'Abre a folha do servidor vizinho na lista. O nome da próxima aparece ao lado.'],",
  "            ['X de N', 'Em que ponto da lista você está. Conta só quem já tem folha gerada.'],",
  "            ['Ver na Escala', 'Abre a grade de escala daquele setor e competência — o caminho inverso de clicar no nome do servidor na grade.'],",
  "          ],",
  "        },",
  "        {",
  "          tipo: 'p',",
  "          texto:",
  "            'O nome do setor, no cabeçalho do documento, também leva à grade da escala.',",
  "        },",
  "        {",
  "          tipo: 'aviso',",
  "          tom: 'atencao',",
  "          titulo: 'Se aparecer \"fora do filtro\"',",
  "          texto:",
  "            'Quer dizer que esta folha não faz parte da lista de onde a navegação veio — é o que acontece quando você chega aqui pela grade da escala ou por um link direto, em vez de pela listagem. As setas ficam apagadas; o **Voltar à lista** continua funcionando.',",
  "        },",
  "        { tipo: 'titulo', texto: 'Gerar e sincronizar' },"
)

src = src.split(ANCORA).join(NOVO)

const invariantes = [
  ['secao da folha preservada', "id: 'folha',"],
  ['aviso de listagem incompleta preservado', 'Listagem incompleta'],
  ['aviso de batida real preservado', 'Horário de batida real é protegido']
]
for (const [nome, marca] of invariantes) {
  if (!src.includes(marca)) {
    console.error('ABORTADO: invariante perdida — ' + nome)
    process.exit(1)
  }
}

fs.writeFileSync(path, src)
console.log('OK: manual atualizado (EOL=' + (EOL === '\r\n' ? 'CRLF' : 'LF') + ')')
