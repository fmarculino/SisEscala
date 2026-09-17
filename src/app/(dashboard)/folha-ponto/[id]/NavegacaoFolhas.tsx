'use client'

/**
 * Barra de navegação entre folhas de ponto, no topo da folha.
 *
 * Mesma ideia da `NavegacaoEscalas` da grade: quem confere uma competência inteira abria a
 * folha, voltava para `/folha-ponto`, refazia os filtros, achava a próxima pessoa e entrava —
 * a cada servidor. Aqui ele anda pela MESMA sequência da lista de onde veio
 * (`folhaNavegacao.ts` é a fonte única do filtro e da ordem) sem sair da tela.
 *
 * ⚠️ As setas navegam com `router.replace`, não `push`: com `push`, depois de percorrer dez
 * folhas o "voltar" do navegador desfaria a navegação uma a uma em vez de devolver a lista.
 * O caminho de volta é explícito, no botão da esquerda.
 *
 * ⚠️ Os filtros de origem viajam na query `origem` — é o que faz o voltar cair na lista já
 * filtrada, na mesma página. Sem eles (link direto, favorito, ou entrada pela grade), a barra
 * cai no filtro padrão para a competência da folha aberta, e a navegação continua funcionando.
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight, CalendarRange, Loader2, Users } from 'lucide-react'
import {
  buscaGlobalAtiva,
  escreverFiltrosFolha,
  indiceDaFolha,
  lerFiltrosFolha,
  sequenciaDeFolhas,
  urlDaFolha,
  urlDaListaDeFolhas,
  type ItemFolha
} from '@/utils/folhaNavegacao'
import { getSequenciaFolhasPonto, buscarServidoresFolhaPonto } from '../actions'

interface Props {
  folhaId: string
  mes: number
  ano: number
  /** Nome do servidor da folha aberta — só para o rótulo de "fora do filtro". */
  servidorNome?: string
  /** Destino do "Ver na Escala": a grade de onde esta folha nasceu. */
  escala: { unidadeId: string; setorId: string; unidadeNome: string; setorNome: string } | null
}

const VALIDADE_CACHE_MS = 2 * 60 * 1000

export function NavegacaoFolhas({ folhaId, mes, ano, servidorNome, escala }: Props) {
  const router = useRouter()

  const [origem, setOrigem] = useState('')
  const [sequencia, setSequencia] = useState<ItemFolha[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let cancelado = false

    // Andar pela lista recarrega a rota inteira a cada seta. Guardar a sequência por 2 minutos
    // evita repetir a varredura da competência a cada passo; o prazo curto é para uma folha
    // gerada no meio da sessão aparecer sem exigir recarga manual.
    const chaveCache = (filtros: string) => `folhas:sequencia:${filtros}`

    const lerCache = (filtros: string): ItemFolha[] | null => {
      try {
        const cru = sessionStorage.getItem(chaveCache(filtros))
        if (!cru) return null
        const { em, itens } = JSON.parse(cru)
        if (!em || Date.now() - em > VALIDADE_CACHE_MS) return null
        return itens
      } catch {
        return null
      }
    }

    const gravarCache = (filtros: string, itens: ItemFolha[]) => {
      try {
        sessionStorage.setItem(chaveCache(filtros), JSON.stringify({ em: Date.now(), itens }))
      } catch {
        // Sem sessionStorage (aba anônima, armazenamento bloqueado) a barra só fica mais lenta.
      }
    }

    const carregar = async () => {
      const query = new URLSearchParams(window.location.search)
      const origemCrua = query.get('origem') || ''
      // Sem filtros de origem, a barra assume a competência da própria folha: é o que faz o
      // link direto (ou a entrada pela grade) continuar navegável dentro daquele mês.
      const filtros = origemCrua
        ? lerFiltrosFolha(decodeURIComponent(origemCrua))
        : { ...lerFiltrosFolha(null), mes: String(mes), ano: String(ano) }

      const chave = escreverFiltrosFolha(filtros)
      if (cancelado) return
      setOrigem(chave)

      const emCache = lerCache(chave)
      if (emCache) {
        setSequencia(sequenciaDeFolhas(emCache, filtros))
        setCarregando(false)
        return
      }

      // A base é a MESMA das duas telas: busca global quando ela estava ativa, listagem por
      // unidade/setor caso contrário. Trocar uma pela outra faria a seta percorrer um conjunto
      // que o usuário não viu.
      const res = buscaGlobalAtiva(filtros)
        ? await buscarServidoresFolhaPonto(filtros.buscaGlobal.trim(), Number(filtros.mes), Number(filtros.ano))
        : await getSequenciaFolhasPonto(
            Number(filtros.mes),
            Number(filtros.ano),
            filtros.unidade || undefined,
            filtros.setor || undefined
          )

      if (cancelado) return

      if ((res as any)?.error) {
        // Perfil irrestrito sem unidade escolhida cai aqui de propósito (a listagem exige a
        // Unidade). A folha continua aberta e utilizável; só não há sequência para percorrer.
        setSequencia([])
        setCarregando(false)
        return
      }

      const base: ItemFolha[] = ((res as any)?.servidores || []).map((s: any) => ({
        servidor_id: s.servidor_id,
        nome: s.nome,
        matricula: s.matricula ?? null,
        cargo: s.cargo ?? null,
        escala_mensal_id: s.escala_mensal_id ?? null,
        escala_status: s.escala_status ?? null,
        folha_id: s.folha_id ?? null,
        folha_status: s.folha_status ?? null
      }))

      gravarCache(chave, base)
      setSequencia(sequenciaDeFolhas(base, filtros))
      setCarregando(false)
    }

    carregar()
    return () => { cancelado = true }
  }, [folhaId, mes, ano])

  const indice = indiceDaFolha(sequencia, folhaId)
  const anterior = indice > 0 ? sequencia[indice - 1] : null
  const proxima = indice >= 0 && indice < sequencia.length - 1 ? sequencia[indice + 1] : null

  const rotulo = (item: ItemFolha) =>
    item.matricula ? `${item.nome} (mat. ${item.matricula})` : item.nome

  const urlDaGrade = useMemo(() => {
    if (!escala) return null
    // Sem `origem`: os filtros daqui são os da LISTA DE FOLHAS, e a barra da grade leria a
    // querystring dela como se fossem os filtros de `/escalas`. Sem eles, a grade cai no
    // filtro padrão para a competência que está abrindo, que é o comportamento correto.
    return `/escalas/unidade/${escala.unidadeId}?setor=${escala.setorId}&mes=${mes}&ano=${ano}`
  }, [escala, mes, ano])

  const botao = 'inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-2 text-sm font-bold text-zinc-700 dark:text-zinc-200 transition-colors hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 dark:hover:bg-blue-900/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-zinc-800 disabled:hover:text-zinc-700 disabled:hover:border-zinc-300'

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <button
        onClick={() => router.push(urlDaListaDeFolhas(origem))}
        className={botao}
        title="Voltar para a lista de folhas, com os filtros e a página que você tinha"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar à lista
      </button>

      <div className="flex items-center gap-1">
        <button
          onClick={() => anterior && router.replace(urlDaFolha(anterior.folha_id as string, origem))}
          disabled={!anterior}
          className={botao}
          title={anterior ? `Anterior: ${rotulo(anterior)}` : 'Esta é a primeira folha da lista'}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Anterior</span>
        </button>

        <div className="px-2 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 min-w-[6rem] justify-center">
          {carregando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : indice >= 0 ? (
            <>
              <Users className="h-3.5 w-3.5 text-blue-500" />
              {indice + 1} de {sequencia.length}
            </>
          ) : (
            <span title={`${servidorNome || 'Esta folha'} não faz parte da lista filtrada de onde a navegação vem`}>
              fora do filtro
            </span>
          )}
        </div>

        <button
          onClick={() => proxima && router.replace(urlDaFolha(proxima.folha_id as string, origem))}
          disabled={!proxima}
          className={botao}
          title={proxima ? `Próxima: ${rotulo(proxima)}` : 'Esta é a última folha da lista'}
        >
          <span className="hidden sm:inline">Próxima</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {urlDaGrade && (
        <button
          onClick={() => router.push(urlDaGrade)}
          className={botao}
          title={`Abrir a grade de escala de ${escala?.unidadeNome} • ${escala?.setorNome} em ${String(mes).padStart(2, '0')}/${ano}`}
        >
          <CalendarRange className="h-4 w-4" />
          <span className="hidden sm:inline">Ver na Escala</span>
        </button>
      )}

      {!carregando && proxima && (
        <span className="hidden lg:inline text-xs text-zinc-400 dark:text-zinc-500 truncate max-w-[20rem]">
          Próxima: {rotulo(proxima)}
        </span>
      )}
    </div>
  )
}
