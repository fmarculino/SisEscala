/**
 * Lista de folhas de ponto — fonte única do filtro, da busca e da ORDEM.
 *
 * Espelha `escalasNavegacao.ts`, e existe pelo mesmo motivo: a sequência percorrida pelas setas
 * da folha (`NavegacaoFolhas`) tem que ser exatamente a lista que o usuário viu em
 * `/folha-ponto`. Se cada tela derivasse a sua, "próxima folha" pularia ou repetiria gente em
 * relação à lista de origem.
 *
 * Três coisas moram aqui e não podem ser reescritas em nenhuma das duas telas: o predicado de
 * visibilidade (`servidorVisivelNaFolha`), a ORDEM DETERMINÍSTICA (`ordenarServidoresFolha`,
 * usada também dentro das actions que montam a lista) e a leitura/escrita dos filtros na URL.
 */

/** Os filtros da tela `/folha-ponto`, na forma em que trafegam pela URL. */
export interface FiltrosFolha {
  /** 1..12 */
  mes: string
  ano: string
  /** Vazio = nenhuma escolhida. Perfil irrestrito precisa de uma para a listagem carregar. */
  unidade: string
  setor: string
  /** "Filtrar Servidor" — peneira em memória o que já está na tela (nome, matrícula, cargo). */
  busca: string
  /** Busca global: vai ao banco e dispensa a Unidade. Troca a BASE da lista. */
  buscaGlobal: string
  /** `todos` ou o status da escala. */
  escalaStatus: string
  /** `todos` ou o status da folha. */
  folhaStatus: string
  /** Página da listagem, para o voltar cair onde o usuário estava. */
  pagina: string
}

/** Menos que isto não busca no banco — mesmo piso que a tela aplica na busca global. */
export const MINIMO_BUSCA_GLOBAL = 3

/**
 * Mês/ano corrente pelo relógio do NAVEGADOR — mesmo comportamento que a tela já tinha. É o
 * default de um filtro de tela, não data de domínio (a armadilha 12 trata de derivar dia a
 * partir de timestamp, que não é o caso aqui).
 */
export function filtrosPadraoFolha(): FiltrosFolha {
  const agora = new Date()
  return {
    mes: String(agora.getMonth() + 1),
    ano: String(agora.getFullYear()),
    unidade: '',
    setor: '',
    busca: '',
    buscaGlobal: '',
    escalaStatus: 'todos',
    folhaStatus: 'todos',
    pagina: '1'
  }
}

/** Lê os filtros de uma query string (`location.search`, com ou sem a interrogação inicial). */
export function lerFiltrosFolha(entrada: string | URLSearchParams | null | undefined): FiltrosFolha {
  const padrao = filtrosPadraoFolha()
  if (!entrada) return padrao
  const sp = typeof entrada === 'string' ? new URLSearchParams(entrada.replace(/^\?/, '')) : entrada
  return {
    mes: sp.get('mes') ?? padrao.mes,
    ano: sp.get('ano') ?? padrao.ano,
    unidade: sp.get('unidade') ?? padrao.unidade,
    setor: sp.get('setor') ?? padrao.setor,
    busca: sp.get('busca') ?? padrao.busca,
    buscaGlobal: sp.get('q') ?? padrao.buscaGlobal,
    escalaStatus: sp.get('escala') ?? padrao.escalaStatus,
    folhaStatus: sp.get('folha') ?? padrao.folhaStatus,
    pagina: sp.get('pagina') ?? padrao.pagina
  }
}

/**
 * Serializa os filtros. Mês e ano vão SEMPRE, mesmo iguais ao padrão: o padrão é "hoje", então
 * um link guardado hoje e aberto no mês que vem abriria outra competência se fossem omitidos.
 */
export function escreverFiltrosFolha(f: FiltrosFolha): string {
  const sp = new URLSearchParams()
  sp.set('mes', f.mes)
  sp.set('ano', f.ano)
  if (f.unidade) sp.set('unidade', f.unidade)
  if (f.setor) sp.set('setor', f.setor)
  if (f.busca) sp.set('busca', f.busca)
  if (f.buscaGlobal) sp.set('q', f.buscaGlobal)
  if (f.escalaStatus !== 'todos') sp.set('escala', f.escalaStatus)
  if (f.folhaStatus !== 'todos') sp.set('folha', f.folhaStatus)
  if (f.pagina && f.pagina !== '1') sp.set('pagina', f.pagina)
  return sp.toString()
}

/** A busca global só troca a base da lista depois do piso de caracteres. */
export function buscaGlobalAtiva(f: FiltrosFolha): boolean {
  return (f.buscaGlobal || '').trim().length >= MINIMO_BUSCA_GLOBAL
}

/** A URL da folha, carregando junto os filtros de origem (o caminho de volta). */
export function urlDaFolha(folhaId: string, origem: string): string {
  const base = '/folha-ponto/' + folhaId
  return origem ? base + '?origem=' + encodeURIComponent(origem) : base
}

/** A URL da lista, já filtrada como o usuário a tinha deixado. */
export function urlDaListaDeFolhas(origem: string): string {
  return origem ? '/folha-ponto?' + origem : '/folha-ponto'
}

/** Uma linha da lista — o que a navegação precisa saber de cada servidor. */
export interface ItemFolha {
  servidor_id: string
  nome: string
  matricula?: string | null
  cargo?: string | null
  escala_mensal_id: string | null
  escala_status?: string | null
  folha_id: string | null
  folha_status?: string | null
}

/**
 * ORDEM DETERMINÍSTICA da lista.
 *
 * ⚠️ O desempate não é enfeite. A ordenação era `nome.localeCompare(nome)` pura, e a base TEM
 * nomes idênticos — duplo vínculo é a mesma pessoa em duas matrículas (armadilha 59: PAULINO,
 * ELZENIR). Empate sem desempate deixa a ordem indefinida: tolerável numa lista que se lê de
 * uma vez, inaceitável numa seta "próxima", onde duas visitas percorreriam ordens diferentes e
 * a navegação pularia ou repetiria uma folha.
 *
 * Ordena uma CÓPIA: a lista que chega pode ser o estado do React, e ordenar no lugar mutaria o
 * array já renderizado sem disparar re-render.
 */
export function ordenarServidoresFolha<T extends { nome: string; matricula?: string | null; escala_mensal_id?: string | null; servidor_id?: string }>(
  lista: T[]
): T[] {
  return [...lista].sort((a, b) =>
    (a.nome || '').localeCompare(b.nome || '')
    || (a.matricula || '').localeCompare(b.matricula || '')
    || (a.escala_mensal_id || '').localeCompare(b.escala_mensal_id || '')
    || (a.servidor_id || '').localeCompare(b.servidor_id || '')
  )
}

/**
 * O que o usuário escolheu ver, depois de a base já ter vindo do banco.
 *
 * Não há camada de papel aqui, ao contrário de `escalaVisivel`: a lista da folha sai de uma
 * server action que já aplica `applyAccessFilters` + RLS, e a navegação consome a MESMA action.
 */
export function servidorVisivelNaFolha(s: ItemFolha, f: FiltrosFolha): boolean {
  const termo = (f.busca || '').toLowerCase()
  if (termo) {
    const casa = (s.nome || '').toLowerCase().includes(termo)
      || (s.matricula || '').toLowerCase().includes(termo)
      || (s.cargo || '').toLowerCase().includes(termo)
    if (!casa) return false
  }
  if (f.escalaStatus !== 'todos' && s.escala_status !== f.escalaStatus) return false
  if (f.folhaStatus !== 'todos' && s.folha_status !== f.folhaStatus) return false
  return true
}

/**
 * A sequência que as setas percorrem: só quem TEM folha gerada.
 *
 * ⚠️ Linha sem folha fica de fora de propósito. Ela aparece na lista (é onde se clica em
 * "Gerar"), mas não tem tela para onde navegar — incluí-la faria a seta parar num destino
 * inexistente, e o contador "X de N" contaria gente que a navegação não alcança.
 */
export function sequenciaDeFolhas(base: ItemFolha[], f: FiltrosFolha): ItemFolha[] {
  return ordenarServidoresFolha(base.filter(s => servidorVisivelNaFolha(s, f))).filter(s => !!s.folha_id)
}

/** Posição da folha aberta dentro da sequência; -1 quando ela não passa no filtro de origem. */
export function indiceDaFolha(sequencia: ItemFolha[], folhaId: string): number {
  return sequencia.findIndex(s => s.folha_id === folhaId)
}
