/**
 * Renomeia os rotulos de "Jornada Temporaria" na tela do servidor.
 *
 * POR QUE: o nome afasta o coordenador do caminho certo. Reducao de jornada por decisao
 * judicial nao e "temporaria" — e permanente — entao quem precisa registrar isso nao procura
 * essa aba, vai no seletor da grade e troca a jornada do mes, que reescreve os dias ja
 * trabalhados. A tabela e a resolucao por data (obter_jornada_servidor_data) servem aos dois
 * casos; so o rotulo dizia o contrario.
 *
 * Aborta se qualquer trecho nao ocorrer exatamente uma vez (padrao dos geradores do projeto).
 */
const fs = require('fs'), path = require('path')

const alvos = [
  {
    arquivo: path.join(__dirname, '..', 'src', 'app', '(dashboard)', 'servidores', '[id]', 'ServidorDetalhesClient.tsx'),
    subs: [
      ['Cadastrar Jornada Temporária (Alteração por Período)', 'Alterar Jornada por Período (vigência)'],
      ['>Jornada Temporária *<', '>Nova Jornada *<'],
      ['Nenhuma jornada temporária cadastrada para este servidor.', 'Nenhuma alteração de jornada por período cadastrada para este servidor.'],
      ['title="Remover jornada temporária"', 'title="Remover alteração de jornada"'],
      // CRLF: os arquivos do projeto usam \r\n e um padrao com \n nao casa (CLAUDE.md, Convencoes).
      ['\r\n          Jornadas Temporárias\r\n', '\r\n          Alterações de Jornada\r\n'],
    ],
  },
]

let total = 0
for (const { arquivo, subs } of alvos) {
  let s = fs.readFileSync(arquivo, 'utf8')
  for (const [de, para] of subs) {
    const n = s.split(de).length - 1
    if (n !== 1) {
      console.error(`ABORTA: ${JSON.stringify(de.slice(0, 60))} ocorreu ${n}x em ${path.basename(arquivo)}`)
      process.exit(1)
    }
    s = s.split(de).join(para)
    total++
  }
  fs.writeFileSync(arquivo, s)
}
console.log(`ok: ${total} substituicoes`)
