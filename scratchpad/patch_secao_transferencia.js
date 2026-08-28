const fs = require('fs')
const arquivos = {
  secao: 'src/app/(dashboard)/servidores/pendencias/SolicitacoesTransferenciaSection.tsx',
  client: 'src/app/(dashboard)/servidores/pendencias/PendenciasCadastroClient.tsx',
}
function editar(caminho, edicoes) {
  let s = fs.readFileSync(caminho, 'utf8')
  for (const [old, novo, n = 1] of edicoes) {
    const partes = s.split(old)
    if (partes.length - 1 !== n) {
      console.error(`ABORTA (${caminho}): esperava ${n}x, achei ${partes.length - 1}x de:\n${old.slice(0, 180)}`)
      process.exit(1)
    }
    s = partes.join(novo)
  }
  fs.writeFileSync(caminho, s)
  console.log(`${caminho} atualizado`)
}

editar(arquivos.secao, [
  [
`  solicitadoPorNome: string\r
  solicitadoEm: string\r
}\r
`,
`  solicitadoPorNome: string\r
  solicitadoEm: string\r
  /**\r
   * Decidido NO SERVIDOR por \`avaliarPermissaoTransferencia\` (src/utils/avaliacaoTransferencia.ts),\r
   * linha a linha — o RH da Unidade avalia o remanejamento dentro das unidades dele e enxerga,\r
   * sem botão, o pedido que precisa do RH Geral. A action confere de novo: isto aqui só decide o\r
   * que a tela mostra.\r
   */\r
  podeAvaliar: boolean\r
  /** Por que esta linha não tem botão, quando quem olha é um avaliador. */\r
  motivoSemPermissao: string | null\r
}\r
`,
  ],
  [
`interface SolicitacoesTransferenciaSectionProps {\r
  solicitacoes: SolicitacaoTransferencia[]\r
  erro: string | null\r
  isSuperAdmin: boolean\r
`,
`interface SolicitacoesTransferenciaSectionProps {\r
  solicitacoes: SolicitacaoTransferencia[]\r
  erro: string | null\r
  /** O papel de quem olha avalia transferência (super_admin, RH Geral ou RH da Unidade). */\r
  avaliador: boolean\r
`,
  ],
  [
`export function SolicitacoesTransferenciaSection({\r
  solicitacoes,\r
  erro,\r
  isSuperAdmin,\r
  unidades,\r
  setores,\r
}: SolicitacoesTransferenciaSectionProps) {\r
`,
`export function SolicitacoesTransferenciaSection({\r
  solicitacoes,\r
  erro,\r
  avaliador,\r
  unidades,\r
  setores,\r
}: SolicitacoesTransferenciaSectionProps) {\r
`,
  ],
  [
`          {isSuperAdmin\r
            ? 'Só o administrador geral efetiva transferência de unidade/setor. Quando o pedido vier sem destino ("A definir pelo RH"), escolha a unidade e setor de destino ao aprovar.'\r
            : 'Pedidos de transferência aguardando avaliação do Administrador Geral. Você vê aqui os que estão no seu escopo.'}\r
`,
`          {avaliador\r
            ? 'Administrador Geral e RH Geral avaliam qualquer pedido; o RH da Unidade avalia o remanejamento dentro das próprias unidades. Quando o pedido vier sem destino ("A definir pelo RH"), escolha a unidade e setor de destino ao aprovar.'\r
            : 'Pedidos de transferência aguardando avaliação do RH. Você vê aqui os que estão no seu escopo.'}\r
`,
  ],
  [
`              <LinhaSolicitacao\r
                key={s.id}\r
                solicitacao={s}\r
                isSuperAdmin={isSuperAdmin}\r
`,
`              <LinhaSolicitacao\r
                key={s.id}\r
                solicitacao={s}\r
                avaliador={avaliador}\r
`,
  ],
  [
`function LinhaSolicitacao({\r
  solicitacao,\r
  isSuperAdmin,\r
  unidades,\r
  setores,\r
  onResolvida,\r
}: {\r
  solicitacao: SolicitacaoTransferencia\r
  isSuperAdmin: boolean\r
`,
`function LinhaSolicitacao({\r
  solicitacao,\r
  avaliador,\r
  unidades,\r
  setores,\r
  onResolvida,\r
}: {\r
  solicitacao: SolicitacaoTransferencia\r
  avaliador: boolean\r
`,
  ],
  [
`  const isDestinoIndefinido = !solicitacao.unidadeDestinoId\r
`,
`  const isDestinoIndefinido = !solicitacao.unidadeDestinoId\r
  const podeAvaliar = solicitacao.podeAvaliar\r
`,
  ],
  [`        {isSuperAdmin && (\r
          <div className="flex items-center gap-2 shrink-0">\r
`,
`        {podeAvaliar && (\r
          <div className="flex items-center gap-2 shrink-0">\r
`,
  ],
  [
`      {isSuperAdmin && (mostrarSelecaoDestino || isDestinoIndefinido) && (\r
`,
`      {avaliador && !podeAvaliar && solicitacao.motivoSemPermissao && (\r
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 italic border-t border-zinc-100 dark:border-zinc-800 pt-2">\r
          {solicitacao.motivoSemPermissao}\r
        </p>\r
      )}\r
\r
      {podeAvaliar && (mostrarSelecaoDestino || isDestinoIndefinido) && (\r
`,
  ],
])

editar(arquivos.client, [
  [`  isSuperAdmin: boolean\r
`, `  /** O papel de quem olha avalia transferência (super_admin, RH Geral ou RH da Unidade). */\r
  podeAvaliarTransferencia: boolean\r
`],
  [
`  solicitacoesTransferencia, erroSolicitacoesTransferencia, isSuperAdmin,\r
`,
`  solicitacoesTransferencia, erroSolicitacoesTransferencia, podeAvaliarTransferencia,\r
`,
  ],
  [
` note={isSuperAdmin ? 'aguardando sua avaliação' : 'aguardando Administrador Geral'} />`,
` note={podeAvaliarTransferencia ? 'aguardando sua avaliação' : 'aguardando o RH'} />`,
  ],
  [
`        isSuperAdmin={isSuperAdmin}\r
`,
`        avaliador={podeAvaliarTransferencia}\r
`,
  ],
  // Escopo limitado (coordenador / RH da Unidade) passa a ver a secao QUANDO avalia — ate aqui
  // esse ramo devolvia sempre uma lista vazia, entao o RH da Unidade nao tinha onde clicar.
  [
`        <ImportacaoRhSection\r
          pendentesRh={pendentesRh}\r
          erroPendentesRh={erroPendentesRh}\r
          unidades={unidades}\r
          setores={setores}\r
          cargos={cargos}\r
        />\r
      </div>\r
    )\r
  }\r
`,
`        {podeAvaliarTransferencia && (\r
          <SolicitacoesTransferenciaSection\r
            solicitacoes={solicitacoesTransferencia}\r
            erro={erroSolicitacoesTransferencia}\r
            avaliador={podeAvaliarTransferencia}\r
            unidades={unidades}\r
            setores={setores}\r
          />\r
        )}\r
\r
        <ImportacaoRhSection\r
          pendentesRh={pendentesRh}\r
          erroPendentesRh={erroPendentesRh}\r
          unidades={unidades}\r
          setores={setores}\r
          cargos={cargos}\r
        />\r
      </div>\r
    )\r
  }\r
`,
  ],
])
