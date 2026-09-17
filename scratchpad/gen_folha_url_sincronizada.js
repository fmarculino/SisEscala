/**
 * Mantem a URL da listagem em sincronia com os filtros escolhidos.
 *
 * Sem isto a URL que veio do "Voltar a lista" fica CONGELADA: o usuario volta da folha (URL com
 * os filtros de antes), troca a unidade na tela e aperta F5 — a URL vence o estado (essa
 * precedencia e deliberada) e ele recebe de volta os filtros ANTIGOS. O sintoma e o pior tipo:
 * a tela desfaz sozinha a escolha que a pessoa acabou de fazer.
 *
 * Usa `history.replaceState`, nao `router.replace`: o objetivo e so deixar a barra de enderecos
 * coerente com a tela. Passar pelo router do Next re-renderizaria a rota a cada tecla digitada
 * no campo de busca.
 */
const fs = require('fs')
const path = 'src/app/(dashboard)/folha-ponto/page.tsx'
let src = fs.readFileSync(path, 'utf8')
const EOL = src.includes('\r\n') ? '\r\n' : '\n'
const L = (...linhas) => linhas.join(EOL)

function trocarUnica(de, para, nome) {
  const n = src.split(de).length - 1
  if (n !== 1) {
    console.error('ABORTADO: ' + nome + ' — esperava 1 ocorrencia, achei ' + n)
    process.exit(1)
  }
  src = src.split(de).join(para)
}

// A sincronia mora junto da gravacao no sessionStorage: sao a mesma decisao ("guardar o que ele
// escolheu"), em dois lugares que precisam concordar.
trocarUnica(
  L(
    "  // Save filters to sessionStorage whenever they change",
    "  useEffect(() => {",
    "    sessionStorage.setItem('folha_ponto_filtro_mes', String(mes))"
  ),
  L(
    "  // Save filters to sessionStorage whenever they change",
    "  useEffect(() => {",
    "    sessionStorage.setItem('folha_ponto_filtro_mes', String(mes))"
  ),
  'ancora do efeito de gravacao (sanidade)'
)

const FIM_DO_EFEITO = "  }, [mes, ano, selectedUnidade, selectedSetor, searchTerm, filterEscalaStatus, filterFolhaStatus])"
trocarUnica(
  FIM_DO_EFEITO,
  L(
    "  }, [mes, ano, selectedUnidade, selectedSetor, searchTerm, filterEscalaStatus, filterFolhaStatus])",
    "",
    "  // A URL acompanha os filtros da tela.",
    "  //",
    "  // A URL vence o sessionStorage ao abrir (e o que faz o Voltar a lista devolver o estado",
    "  // daquela navegacao), entao deixa-la congelada faria um F5 depois de trocar de unidade",
    "  // ressuscitar os filtros antigos — a tela desfazendo sozinha a escolha recem-feita.",
    "  //",
    "  // `history.replaceState`, nunca `router.replace`: aqui so a barra de enderecos precisa ficar",
    "  // coerente. Passar pelo router re-renderizaria a rota a cada tecla no campo de busca.",
    "  useEffect(() => {",
    "    if (typeof window === 'undefined') return",
    "    const query = escreverFiltrosFolha({",
    "      mes: String(mes),",
    "      ano: String(ano),",
    "      unidade: selectedUnidade,",
    "      setor: selectedSetor,",
    "      busca: searchTerm,",
    "      buscaGlobal: buscaGlobal.trim(),",
    "      escalaStatus: filterEscalaStatus,",
    "      folhaStatus: filterFolhaStatus,",
    "      pagina: String(currentPage)",
    "    })",
    "    window.history.replaceState(window.history.state, '', window.location.pathname + '?' + query)",
    "  }, [mes, ano, selectedUnidade, selectedSetor, searchTerm, buscaGlobal, filterEscalaStatus, filterFolhaStatus, currentPage])"
  ),
  'efeito de sincronia da URL'
)

const invariantes = [
  ['gravacao no sessionStorage preservada', "sessionStorage.setItem('folha_ponto_filtro_folha_status'"],
  ['helper de filtro inicial preservado', 'function filtroInicial('],
  ['origem continua sendo montada', 'const origemAtual = escreverFiltrosFolha(filtrosAtuais)']
]
for (const [nome, marca] of invariantes) {
  if (!src.includes(marca)) {
    console.error('ABORTADO: invariante perdida — ' + nome)
    process.exit(1)
  }
}

fs.writeFileSync(path, src)
console.log('OK: URL sincronizada com os filtros (EOL=' + (EOL === '\r\n' ? 'CRLF' : 'LF') + ')')
