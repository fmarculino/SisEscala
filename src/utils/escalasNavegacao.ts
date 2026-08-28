/**
 * Lista de escalas — fonte única do filtro, da busca e da ORDEM.
 *
 * Existe para que a sequência percorrida pelas setas de navegação da grade
 * (`NavegacaoEscalas`) seja exatamente a lista que o usuário viu em `/escalas`. Se cada tela
 * derivasse a sua, "próxima escala" pularia ou repetiria itens em relação à lista de origem —
 * o mesmo tipo de divergência que já obrigou `fn_projecao_marcacoes_dia` a ser fonte única no
 * banco.
 *
 * Três coisas moram aqui e não podem ser reescritas em nenhuma das duas telas: o predicado de
 * visibilidade (`escalaVisivel`), o agrupamento por (unidade, setor, mês, ano) com ORDEM
 * DETERMINÍSTICA (`agruparEscalas`) e a leitura/escrita dos filtros na URL.
 */
import { applyAccessFilters, hasSectorAccess, type UserProfile } from './permissions'
import { buscarCaminhosDeSetor } from './sectors'

/** Os filtros da tela `/escalas`, na forma em que trafegam pela URL. */
export interface FiltrosEscalas {
  /** Texto livre sobre nome de unidade/setor. */
  busca: string
  /** Nome, matrícula ou CPF do servidor. */
  servidor: string
  /** `todas` ou o id da unidade. */
  unidade: string
  /** `todos` ou 1..12. */
  mes: string
  /** `todos` ou o ano. */
  ano: string
  /** `todos` | `previsao` | `fechada`. */
  status: string
  incluirInativas: boolean
}

/**
 * Mês/ano corrente pelo relógio do NAVEGADOR — mesmo comportamento que a tela já tinha. É o
 * default de um filtro de tela, não data de domínio: não passa por `configuracoes_globais`
 * (a armadilha 12 trata de derivar dia a partir de timestamp, que não é o caso aqui).
 */
export function filtrosPadrao(): FiltrosEscalas {
  const agora = new Date()
  return {
    busca: '',
    servidor: '',
    unidade: 'todas',
    mes: String(agora.getMonth() + 1),
    ano: String(agora.getFullYear()),
    status: 'todos',
    incluirInativas: false
  }
}

/** Lê os filtros de uma query string (`location.search`, `?a=b` ou `a=b`). */
export function lerFiltros(entrada: string | URLSearchParams | null | undefined): FiltrosEscalas {
  const padrao = filtrosPadrao()
  if (!entrada) return padrao
  const sp = typeof entrada === 'string' ? new URLSearchParams(entrada.replace(/^\?/, '')) : entrada
  return {
    busca: sp.get('busca') ?? padrao.busca,
    servidor: sp.get('servidor') ?? padrao.servidor,
    unidade: sp.get('unidade') ?? padrao.unidade,
    mes: sp.get('mes') ?? padrao.mes,
    ano: sp.get('ano') ?? padrao.ano,
    status: sp.get('status') ?? padrao.status,
    incluirInativas: sp.get('inativas') === '1'
  }
}

/**
 * Serializa os filtros. Mês e ano vão SEMPRE, mesmo iguais ao padrão: o padrão é "hoje", então
 * um link guardado hoje e aberto no mês que vem abriria outra competência se eles fossem
 * omitidos.
 */
export function escreverFiltros(f: FiltrosEscalas): string {
  const sp = new URLSearchParams()
  if (f.busca) sp.set('busca', f.busca)
  if (f.servidor) sp.set('servidor', f.servidor)
  if (f.unidade !== 'todas') sp.set('unidade', f.unidade)
  sp.set('mes', f.mes)
  sp.set('ano', f.ano)
  if (f.status !== 'todos') sp.set('status', f.status)
  if (f.incluirInativas) sp.set('inativas', '1')
  return sp.toString()
}

/** A URL da grade de uma escala, carregando junto os filtros de origem (o caminho de volta). */
export function urlDaGrade(
  grupo: { unidade_id: string; setor_id: string; mes: number; ano: number },
  origem: string
): string {
  const base = `/escalas/unidade/${grupo.unidade_id}?setor=${grupo.setor_id}&mes=${grupo.mes}&ano=${grupo.ano}`
  return origem ? `${base}&origem=${encodeURIComponent(origem)}` : base
}

const TAMANHO_PAGINA = 1000

/**
 * Busca as linhas de `escala_mensal` do período, já com o nome do setor resolvido.
 *
 * ⚠️ PAGINA por `Range` (armadilha 8): o PostgREST corta em 1000 linhas **em silêncio**, e
 * `escala_mensal` tem uma linha por servidor — um mês inteiro do parque passa disso. Sem a
 * paginação, tanto a lista quanto a navegação perderiam escalas sem erro nenhum na tela.
 * A ordem inclui `id` como desempate: `range` sobre ordenação instável repete e pula linhas.
 *
 * ⚠️ O nome do setor sai daqui como CAMINHO COMPLETO (`SHL \ BLOCO A`). O embed
 * `setores(dicionario_setores(nome))` só traz a FOLHA, e "BLOCO A" existe embaixo de mais de um
 * pai — a lista mostrava dois cards indistinguíveis, e a seta "Próxima" dizia o mesmo nome duas
 * vezes. Como `setor_nome` nasce aqui, arrumar neste ponto conserta a lista, a navegação e a
 * busca por texto de uma vez (buscar "SHL" passa a achar os filhos, o que é o desejado).
 */
export async function buscarEscalasMensais(
  supabase: any,
  profile: UserProfile | null,
  /** Só o período vai ao banco; o resto do filtro é aplicado por `escalaVisivel`, em memória. */
  periodo: { mes: string; ano: string }
): Promise<{ linhas: any[]; erro: any }> {
  const linhas: any[] = []
  const caminhoSetor = await buscarCaminhosDeSetor(supabase)

  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    let query = supabase
      .from('escala_mensal')
      .select('*, servidores(id, nome, cpf, matricula), unidades(nome), setores(dicionario_setores(nome))')
      .order('ano', { ascending: false })
      .order('mes', { ascending: false })
      .order('id')
      .range(inicio, inicio + TAMANHO_PAGINA - 1)

    if (profile) query = applyAccessFilters(query, profile)
    if (periodo.mes !== 'todos') query = query.eq('mes', parseInt(periodo.mes, 10))
    if (periodo.ano !== 'todos') query = query.eq('ano', parseInt(periodo.ano, 10))

    const { data, error } = await query
    if (error) return { linhas, erro: error }

    const pagina = (data || []).map((e: any) => {
      const setor = Array.isArray(e.setores) ? e.setores[0] : e.setores
      const dicionario = setor
        ? (Array.isArray(setor.dicionario_setores) ? setor.dicionario_setores[0] : setor.dicionario_setores)
        : null
      // Caminho quando o setor está no mapa; a folha do embed é o fallback (setor fora do escopo
      // de leitura de `setores` não teria caminho a montar, e sumir com o nome seria pior).
      const nome = caminhoSetor.get(e.setor_id) || dicionario?.nome || 'SETOR SEM NOME'
      return { ...e, setores: setor ? { nome } : null }
    })

    linhas.push(...pagina)
    if (pagina.length < TAMANHO_PAGINA) break
  }

  return { linhas, erro: null }
}

/** Confere se o texto casa com nome, matrícula ou CPF do servidor da linha. */
function casaServidor(escala: any, termo: string): boolean {
  const alvo = termo.trim().toLowerCase()
  if (!alvo) return true
  const cpfBuscado = termo.replace(/\D/g, '')

  const nome = (escala.servidores?.nome || '').toLowerCase()
  const matricula = (escala.servidores?.matricula || '').toLowerCase()
  const cpf = (escala.servidores?.cpf || '').replace(/\D/g, '')
  const cpfCru = (escala.servidores?.cpf || '').toLowerCase()

  return nome.includes(alvo)
    || matricula.includes(alvo)
    || (cpfBuscado ? cpf.includes(cpfBuscado) : cpfCru.includes(alvo))
}

/**
 * O que o usuário pode e escolheu ver. A camada de papel é secundária — quem restringe de
 * verdade é a RLS —, mas continua aqui porque a grade navega pelo mesmo conjunto.
 */
export function escalaVisivel(
  escala: any,
  filtros: FiltrosEscalas,
  profile: any,
  servidorVinculadoId: string | null
): boolean {
  const termo = filtros.busca.toLowerCase()
  const unidade = (escala.unidades?.nome || '').toLowerCase()
  const setor = (escala.setores?.nome || '').toLowerCase()

  if (!unidade.includes(termo) && !setor.includes(termo)) return false
  if (filtros.unidade !== 'todas' && escala.unidade_id !== filtros.unidade) return false
  if (!filtros.incluirInativas && escala.ativo === false) return false
  if (filtros.status === 'fechada' && escala.status !== 'Fechada') return false
  if (filtros.status === 'previsao' && escala.status === 'Fechada') return false
  if (!casaServidor(escala, filtros.servidor)) return false

  const papel = profile?.role
  if (papel === 'super_admin' || papel === 'rh' || papel === 'rh_unidade') return true
  if (papel === 'admin' || papel === 'coordenador' || papel === 'ass_adm') {
    return hasSectorAccess(profile, escala.setor_id, escala.unidade_id)
  }
  if (papel === 'comum' || papel === 'servidor') {
    return escala.servidor_id === servidorVinculadoId
  }
  return true
}

/** Uma escala da lista: o par (unidade, setor) numa competência. */
export interface GrupoEscala {
  chave: string
  unidade_id: string
  setor_id: string
  mes: number
  ano: number
  unidade_nome: string
  setor_nome: string
  /** Linha representativa — de onde saem status e `ativo` no card. */
  item: any
}

export function chaveEscala(e: any): string {
  return `${e.unidade_id}|${e.setor_id}|${e.mes}|${e.ano}`
}

/**
 * Agrupa as linhas em escalas e ORDENA: competência mais recente primeiro, depois unidade e
 * setor por nome.
 *
 * ⚠️ A ordem por nome não é enfeite. Antes, dentro de cada competência a sequência era a ordem
 * de chegada do PostgREST — indefinida, porque a consulta não desempata —, o que é tolerável
 * numa lista que se lê de uma vez e inaceitável numa seta "próxima": duas visitas à mesma lista
 * poderiam percorrer ordens diferentes.
 */
export function agruparEscalas(linhas: any[]): GrupoEscala[] {
  const grupos = new Map<string, GrupoEscala>()

  linhas.forEach(e => {
    const chave = chaveEscala(e)
    if (grupos.has(chave)) return
    grupos.set(chave, {
      chave,
      unidade_id: e.unidade_id,
      setor_id: e.setor_id,
      mes: e.mes,
      ano: e.ano,
      unidade_nome: e.unidades?.nome || '',
      setor_nome: e.setores?.nome || '',
      item: e
    })
  })

  return Array.from(grupos.values()).sort((a, b) =>
    b.ano - a.ano
    || b.mes - a.mes
    || a.unidade_nome.localeCompare(b.unidade_nome)
    || a.setor_nome.localeCompare(b.setor_nome)
  )
}

/** Posição da escala aberta dentro da sequência; -1 quando ela não passa no filtro de origem. */
export function indiceDaEscala(
  grupos: GrupoEscala[],
  atual: { unidadeId: string; setorId: string; mes: number; ano: number }
): number {
  return grupos.findIndex(g =>
    g.unidade_id === atual.unidadeId
    && g.setor_id === atual.setorId
    && g.mes === atual.mes
    && g.ano === atual.ano
  )
}
