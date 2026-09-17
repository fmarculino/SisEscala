/**
 * Encaixa a navegação entre folhas no FolhaPontoEditor.
 *
 * ⚠️ A barra entra como SLOT (`navegacao?: React.ReactNode`), montado pela page `[id]`, e não
 * por import direto: o mesmo editor é renderizado pelo PORTAL DO SERVIDOR
 * (ConsultarEscalaClient), que autentica por PIN e por isso recebe as actions por prop em vez de
 * importar `folha-ponto/actions`. Importar `NavegacaoFolhas` aqui arrastaria aquelas actions
 * para o grafo do portal.
 *
 * Aborta em qualquer contagem divergente.
 */
const fs = require('fs')
const path = 'src/app/(dashboard)/folha-ponto/[id]/FolhaPontoEditor.tsx'
let src = fs.readFileSync(path, 'utf8')

function trocarUnica(de, para, nome) {
  const n = src.split(de).length - 1
  if (n !== 1) {
    console.error(`ABORTADO: ${nome} — esperava 1 ocorrencia, achei ${n}`)
    process.exit(1)
  }
  src = src.split(de).join(para)
}

// 1. A prop de slot.
trocarUnica(
  "  isPortal?: boolean\r\n",
  [
    "  isPortal?: boolean",
    "  /**",
    "   * Barra de navegacao entre folhas (setas, voltar a lista, ir para a grade). Montada pela",
    "   * page para o editor nao importar as actions do dashboard — o Portal do Servidor renderiza",
    "   * este mesmo componente e recebe tudo por prop.",
    "   */",
    "  navegacao?: React.ReactNode",
    ""
  ].join('\r\n'),
  'prop navegacao na interface'
)

trocarUnica(
  "  isPortal = false,\r\n",
  "  isPortal = false,\r\n  navegacao,\r\n",
  'prop navegacao na desestruturacao'
)

// 2. A barra, acima do cabecalho da tela.
trocarUnica(
  "      {/* Header - Hidden on Print */}\r\n",
  [
    "      {/* Navegacao entre folhas — ausente no Portal do Servidor, que ve so a propria folha */}",
    "      {navegacao}",
    "",
    "      {/* Header - Hidden on Print */}",
    ""
  ].join('\r\n'),
  'slot da barra antes do header'
)

// 3. Com a barra no ar, a seta solta do cabecalho vira um segundo "voltar" sem rotulo, apontando
//    para a lista SEM os filtros de origem — o defeito que esta mudanca fecha. Ela so aparece
//    quando nao ha barra.
trocarUnica(
  "          ) : (\r\n            <Link href=\"/folha-ponto\" className=\"p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors\">\r\n              <ArrowLeft className=\"h-5 w-5 text-zinc-500\" />\r\n            </Link>\r\n          )}",
  "          ) : navegacao ? null : (\r\n            <Link href=\"/folha-ponto\" className=\"p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors\">\r\n              <ArrowLeft className=\"h-5 w-5 text-zinc-500\" />\r\n            </Link>\r\n          )}",
  'seta do cabecalho condicionada a ausencia da barra'
)

// 4. O caminho inverso do clique no nome do servidor da grade: daqui se volta para a grade pelo
//    proprio bloco SETOR do cabecalho do documento.
trocarUnica(
  "              <div className=\"text-[9px] font-black uppercase text-zinc-400 mb-0.5\">Setor / Jornada</div>\r\n              <div className=\"font-bold text-zinc-900 dark:text-white uppercase\">{setor?.nome}</div>",
  [
    "              <div className=\"text-[9px] font-black uppercase text-zinc-400 mb-0.5\">Setor / Jornada</div>",
    "              {!isPortal && escala?.unidade_id && escala?.setor_id ? (",
    "                <Link",
    "                  href={`/escalas/unidade/${escala.unidade_id}?setor=${escala.setor_id}&mes=${folha.mes}&ano=${folha.ano}`}",
    "                  className=\"font-bold text-zinc-900 dark:text-white uppercase hover:text-blue-600 dark:hover:text-blue-400 hover:underline transition-colors print:text-black print:no-underline print:hover:text-black\"",
    "                  title={`Abrir a grade de escala deste setor em ${String(folha.mes).padStart(2, '0')}/${folha.ano}`}",
    "                >",
    "                  {setor?.nome}",
    "                </Link>",
    "              ) : (",
    "                <div className=\"font-bold text-zinc-900 dark:text-white uppercase\">{setor?.nome}</div>",
    "              )}"
  ].join('\r\n'),
  'setor do cabecalho vira link para a grade'
)

// Invariantes: o que a edicao nao pode ter derrubado.
const invariantes = [
  ['botao de voltar do Portal preservado', "onClick={onBack}"],
  ['Link continua importado', "import Link from 'next/link'"],
  ['bloco de impressao do cabecalho preservado', "print:grid-cols-4"],
  ['jornada continua no cabecalho', "{jornada?.nome || 'Não Vinculada'}"]
]
for (const [nome, marca] of invariantes) {
  if (!src.includes(marca)) {
    console.error(`ABORTADO: invariante perdida — ${nome}`)
    process.exit(1)
  }
}

fs.writeFileSync(path, src)
console.log('OK: 5 trocas aplicadas, 4 invariantes conferidas')
