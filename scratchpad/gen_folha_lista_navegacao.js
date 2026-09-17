/**
 * Liga a listagem `/folha-ponto` a navegacao: filtros lidos tambem da URL (o caminho de volta),
 * filtro/ordem vindos da fonte unica, e `origem` viajando em cada link de abertura de folha.
 *
 * DETECTA o EOL do arquivo em vez de assumir CRLF: a convencao do projeto e CRLF, mas
 * `folha-ponto/page.tsx` esta em LF. Padrao montado com o EOL errado vira replace no-op
 * SILENCIOSO — o gerador "passaria" sem ter trocado nada (armadilhas 48 e 59). Aqui ele aborta,
 * porque conta ocorrencias.
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

// 1. Import da fonte unica.
trocarUnica(
  "import { h, raw } from '@/utils/htmlSeguro'",
  L(
    "import { h, raw } from '@/utils/htmlSeguro'",
    "import {",
    "  escreverFiltrosFolha,",
    "  filtrosPadraoFolha,",
    "  lerFiltrosFolha,",
    "  ordenarServidoresFolha,",
    "  servidorVisivelNaFolha,",
    "  urlDaFolha,",
    "  type FiltrosFolha",
    "} from '@/utils/folhaNavegacao'",
    "",
    "/**",
    " * De onde vem cada filtro ao abrir a tela, em ordem de precedencia:",
    " *   1. a URL — e como a folha devolve o usuario para ca com o que ele tinha (NavegacaoFolhas);",
    " *   2. o sessionStorage — preserva os filtros entre visitas avulsas, como sempre fez;",
    " *   3. o padrao.",
    " *",
    " * A URL vence o sessionStorage de proposito: quem clica em Voltar a lista esta pedindo o",
    " * estado DAQUELA navegacao, e o sessionStorage pode ter sido sobrescrito por outra aba aberta",
    " * na mesma tela.",
    " */",
    "function filtroInicial(campo: keyof FiltrosFolha, chaveSessao?: string): string {",
    "  const padrao = filtrosPadraoFolha()[campo] as string",
    "  if (typeof window === 'undefined') return padrao",
    "  if (window.location.search) return lerFiltrosFolha(window.location.search)[campo] as string",
    "  if (!chaveSessao) return padrao",
    "  const salvo = sessionStorage.getItem(chaveSessao)",
    "  return salvo === null ? padrao : salvo",
    "}"
  ),
  'import e helper de filtro inicial'
)

// 2. Inicializadores dos filtros passam a considerar a URL.
const inicializadores = [
  [
    L(
      "  const [mes, setMes] = useState<number>(() => {",
      "    if (typeof window !== 'undefined') {",
      "      const saved = sessionStorage.getItem('folha_ponto_filtro_mes')",
      "      if (saved) return parseInt(saved, 10)",
      "    }",
      "    return new Date().getMonth() + 1",
      "  })"
    ),
    "  const [mes, setMes] = useState<number>(() => parseInt(filtroInicial('mes', 'folha_ponto_filtro_mes'), 10))",
    'mes'
  ],
  [
    L(
      "  const [ano, setAno] = useState<number>(() => {",
      "    if (typeof window !== 'undefined') {",
      "      const saved = sessionStorage.getItem('folha_ponto_filtro_ano')",
      "      if (saved) return parseInt(saved, 10)",
      "    }",
      "    return new Date().getFullYear()",
      "  })"
    ),
    "  const [ano, setAno] = useState<number>(() => parseInt(filtroInicial('ano', 'folha_ponto_filtro_ano'), 10))",
    'ano'
  ],
  [
    L(
      "  const [selectedUnidade, setSelectedUnidade] = useState(() => {",
      "    if (typeof window !== 'undefined') {",
      "      return sessionStorage.getItem('folha_ponto_filtro_unidade') || ''",
      "    }",
      "    return ''",
      "  })"
    ),
    "  const [selectedUnidade, setSelectedUnidade] = useState(() => filtroInicial('unidade', 'folha_ponto_filtro_unidade'))",
    'unidade'
  ],
  [
    L(
      "  const [selectedSetor, setSelectedSetor] = useState(() => {",
      "    if (typeof window !== 'undefined') {",
      "      return sessionStorage.getItem('folha_ponto_filtro_setor') || ''",
      "    }",
      "    return ''",
      "  })"
    ),
    "  const [selectedSetor, setSelectedSetor] = useState(() => filtroInicial('setor', 'folha_ponto_filtro_setor'))",
    'setor'
  ],
  [
    L(
      "  const [searchTerm, setSearchTerm] = useState(() => {",
      "    if (typeof window !== 'undefined') {",
      "      return sessionStorage.getItem('folha_ponto_filtro_search') || ''",
      "    }",
      "    return ''",
      "  })"
    ),
    "  const [searchTerm, setSearchTerm] = useState(() => filtroInicial('busca', 'folha_ponto_filtro_search'))",
    'busca'
  ],
  [
    L(
      "  const [filterEscalaStatus, setFilterEscalaStatus] = useState(() => {",
      "    if (typeof window !== 'undefined') {",
      "      return sessionStorage.getItem('folha_ponto_filtro_escala_status') || 'todos'",
      "    }",
      "    return 'todos'",
      "  })"
    ),
    "  const [filterEscalaStatus, setFilterEscalaStatus] = useState(() => filtroInicial('escalaStatus', 'folha_ponto_filtro_escala_status'))",
    'escalaStatus'
  ],
  [
    L(
      "  const [filterFolhaStatus, setFilterFolhaStatus] = useState(() => {",
      "    if (typeof window !== 'undefined') {",
      "      return sessionStorage.getItem('folha_ponto_filtro_folha_status') || 'todos'",
      "    }",
      "    return 'todos'",
      "  })"
    ),
    "  const [filterFolhaStatus, setFilterFolhaStatus] = useState(() => filtroInicial('folhaStatus', 'folha_ponto_filtro_folha_status'))",
    'folhaStatus'
  ]
]
for (const [de, para, nome] of inicializadores) {
  trocarUnica(de, para, 'inicializador de ' + nome)
}

// 3. Busca global tambem volta da URL — sem ela, Voltar a lista devolveria a listagem por
//    unidade no lugar do resultado da busca que o usuario tinha na tela.
trocarUnica(
  "  const [buscaGlobal, setBuscaGlobal] = useState('')",
  "  const [buscaGlobal, setBuscaGlobal] = useState(() => filtroInicial('buscaGlobal'))",
  'buscaGlobal'
)

// 4. A pagina volta junto. Sem isso, quem estava na pagina 7 de uma unidade grande voltava para
//    a 1 e tinha que procurar de novo onde estava — o trabalho que esta mudanca existe para tirar.
trocarUnica(
  "  const [currentPage, setCurrentPage] = useState(1)",
  "  const [currentPage, setCurrentPage] = useState(() => Math.max(1, parseInt(filtroInicial('pagina'), 10) || 1))",
  'currentPage'
)

// 5. O reset de pagina nao pode disparar na MONTAGEM: ele rodaria depois do inicializador e
//    jogaria de volta para a pagina 1 justamente quem acabou de voltar da folha.
trocarUnica(
  L(
    "  // Reset selected timesheets on filter changes",
    "  useEffect(() => {",
    "    setSelectedFolhas(new Set())",
    "    setCurrentPage(1)",
    "  }, [selectedUnidade, selectedSetor, mes, ano, searchTerm, filterEscalaStatus, filterFolhaStatus, buscaGlobal])"
  ),
  L(
    "  // Reset selected timesheets on filter changes",
    "  //",
    "  // Pula a MONTAGEM: o efeito roda depois dos inicializadores de estado, e resetar ali",
    "  // devolveria a pagina 1 a quem acabou de voltar da folha na pagina 7 (a pagina vem na URL).",
    "  const filtrosJaMontados = useRef(false)",
    "  useEffect(() => {",
    "    if (!filtrosJaMontados.current) {",
    "      filtrosJaMontados.current = true",
    "      return",
    "    }",
    "    setSelectedFolhas(new Set())",
    "    setCurrentPage(1)",
    "  }, [selectedUnidade, selectedSetor, mes, ano, searchTerm, filterEscalaStatus, filterFolhaStatus, buscaGlobal])"
  ),
  'reset de pagina pulando a montagem'
)

trocarUnica(
  "import { useState, useEffect, useCallback } from 'react'",
  "import { useState, useEffect, useCallback, useRef } from 'react'",
  'import de useRef'
)

// 6. O init nao pode sobrescrever com o sessionStorage o que veio da URL.
trocarUnica(
  L(
    "            // Restore from sessionStorage if exists, otherwise default empty",
    "            const savedUnidade = sessionStorage.getItem('folha_ponto_filtro_unidade') || ''",
    "            const savedSetor = sessionStorage.getItem('folha_ponto_filtro_setor') || ''",
    "            setSelectedUnidade(savedUnidade)",
    "            setSelectedSetor(savedSetor)"
  ),
  L(
    "            // Mesma precedencia do inicializador (URL > sessionStorage > padrao). Ler o",
    "            // sessionStorage direto aqui sobrescreveria, depois do perfil carregar, a unidade",
    "            // e o setor que vieram na URL do Voltar a lista.",
    "            setSelectedUnidade(filtroInicial('unidade', 'folha_ponto_filtro_unidade'))",
    "            setSelectedSetor(filtroInicial('setor', 'folha_ponto_filtro_setor'))"
  ),
  'init respeitando a URL'
)

// 7. Filtro e ordem passam a sair da fonte unica.
trocarUnica(
  L(
    "  // Filter servers in memory",
    "  const filteredServidores = baseServidores.filter(s => {",
    "    const matchesSearch = s.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||",
    "      s.matricula?.toLowerCase().includes(searchTerm.toLowerCase()) ||",
    "      s.cargo?.toLowerCase().includes(searchTerm.toLowerCase())",
    "",
    "    const matchesEscalaStatus = filterEscalaStatus === 'todos' || s.escala_status === filterEscalaStatus",
    "    const matchesFolhaStatus = filterFolhaStatus === 'todos' || s.folha_status === filterFolhaStatus",
    "",
    "    return matchesSearch && matchesEscalaStatus && matchesFolhaStatus",
    "  })"
  ),
  L(
    "  // Os filtros da competencia, na forma em que viajam para a folha e voltam.",
    "  const filtrosAtuais: FiltrosFolha = {",
    "    mes: String(mes),",
    "    ano: String(ano),",
    "    unidade: selectedUnidade,",
    "    setor: selectedSetor,",
    "    busca: searchTerm,",
    "    buscaGlobal: termoBusca,",
    "    escalaStatus: filterEscalaStatus,",
    "    folhaStatus: filterFolhaStatus,",
    "    pagina: String(currentPage)",
    "  }",
    "",
    "  // Filtro e ordem vem da FONTE UNICA (src/utils/folhaNavegacao.ts), a mesma que as setas",
    "  // da folha usam. Reescrever qualquer um dos dois aqui faria proxima folha pular ou",
    "  // repetir gente em relacao a esta lista.",
    "  const filteredServidores = ordenarServidoresFolha(",
    "    baseServidores.filter(s => servidorVisivelNaFolha(s, filtrosAtuais))",
    "  )",
    "",
    "  // Viaja na query origem de cada folha aberta daqui — e o caminho de volta.",
    "  const origemAtual = escreverFiltrosFolha(filtrosAtuais)"
  ),
  'filtro e ordem pela fonte unica'
)

// 8. Os dois caminhos de abertura da folha carregam a origem.
trocarUnica(
  L(
    "                      onClick={() => {",
    "                        if (hasFolha) {",
    "                          router.push(`/folha-ponto/${s.folha_id}`)",
    "                        }",
    "                      }}"
  ),
  L(
    "                      onClick={() => {",
    "                        if (hasFolha) {",
    "                          router.push(urlDaFolha(s.folha_id, origemAtual))",
    "                        }",
    "                      }}"
  ),
  'clique na linha'
)

trocarUnica(
  "                              href={`/folha-ponto/${s.folha_id}`}",
  "                              href={urlDaFolha(s.folha_id, origemAtual)}",
  'botao Editar'
)

const invariantes = [
  ['gravacao dos filtros no sessionStorage preservada', "sessionStorage.setItem('folha_ponto_filtro_mes'"],
  ['exigencia de unidade para perfil irrestrito preservada', "isUnrestricted && !selectedUnidade && !buscaAtiva"],
  ['aviso de listagem incompleta preservado', "listagemCompleta"],
  ['paginacao da tela preservada', "filteredServidores.slice((currentPage - 1) * itemsPerPage"],
  ['base alternando com a busca global preservada', "buscaAtiva ? buscaResultado.servidores : servidoresData"]
]
for (const [nome, marca] of invariantes) {
  if (!src.includes(marca)) {
    console.error('ABORTADO: invariante perdida — ' + nome)
    process.exit(1)
  }
}

fs.writeFileSync(path, src)
console.log('OK: listagem ligada a navegacao (EOL=' + (EOL === '\r\n' ? 'CRLF' : 'LF') + '), 5 invariantes conferidas')
