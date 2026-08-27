'use client'

/**
 * Barra de navegação entre escalas, no topo da grade.
 *
 * Quem administra muitos setores abria a grade, voltava para `/escalas`, refazia os filtros e
 * entrava na próxima — a cada escala. Aqui ele anda pela MESMA sequência da lista de onde veio
 * (`escalasNavegacao.ts` é a fonte única do filtro e da ordem) sem sair da tela.
 *
 * ⚠️ As setas navegam com `router.replace`, não `push`: com `push`, depois de percorrer cinco
 * escalas o "voltar" do navegador desfaria a navegação uma a uma em vez de devolver a lista.
 * O caminho de volta é explícito, no botão da esquerda.
 *
 * ⚠️ Os filtros de origem viajam na query `origem` — é o que faz o voltar cair na lista já
 * filtrada. Sem eles (link direto, favorito), a barra cai no filtro padrão da lista para o
 * período da grade, e a navegação continua funcionando.
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight, Layers, Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { createClient } from '@/utils/supabase/client'
import {
  agruparEscalas,
  buscarEscalasMensais,
  escalaVisivel,
  escreverFiltros,
  indiceDaEscala,
  lerFiltros,
  urlDaGrade,
  type GrupoEscala
} from '@/utils/escalasNavegacao'

interface Props {
  unidadeId: string
  setorId: string
  mes: number
  ano: number
  userProfile: any
  /**
   * Grade com lançamento ainda não gravado. A grade só vai ao banco no "Salvar Previsão", e sair
   * daqui a descarta — sem o aviso, a seta ao lado do botão de salvar viraria a forma mais fácil
   * de perder um mês inteiro de digitação.
   */
  gradeAlterada?: boolean
}

export function NavegacaoEscalas({ unidadeId, setorId, mes, ano, userProfile, gradeAlterada }: Props) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [origem, setOrigem] = useState('')
  const [grupos, setGrupos] = useState<GrupoEscala[]>([])
  const [carregando, setCarregando] = useState(true)
  const [saidaPendente, setSaidaPendente] = useState<{ destino: string; rotulo: string; empilhar: boolean } | null>(null)

  useEffect(() => {
    let cancelado = false

    // Andar pela lista recarrega a rota inteira a cada seta. Guardar a sequência por 2 minutos
    // evita repetir a varredura de `escala_mensal` do mês a cada passo; o prazo curto é para
    // uma escala criada no meio da sessão aparecer sem exigir recarga manual.
    const chaveCache = (filtros: string) => `escalas:sequencia:${filtros}`
    const VALIDADE_MS = 2 * 60 * 1000

    const lerCache = (filtros: string): GrupoEscala[] | null => {
      try {
        const cru = sessionStorage.getItem(chaveCache(filtros))
        if (!cru) return null
        const { em, grupos } = JSON.parse(cru)
        if (!em || Date.now() - em > VALIDADE_MS) return null
        return grupos
      } catch {
        return null
      }
    }

    const gravarCache = (filtros: string, grupos: GrupoEscala[]) => {
      try {
        sessionStorage.setItem(chaveCache(filtros), JSON.stringify({ em: Date.now(), grupos }))
      } catch {
        // Sem sessionStorage (aba anônima, armazenamento bloqueado) a barra só fica mais lenta.
      }
    }

    const carregar = async () => {
      const query = new URLSearchParams(window.location.search)
      const origemCrua = query.get('origem') || ''
      // Sem filtros de origem, a barra assume o período da própria grade: é o que faz o link
      // direto para uma escala continuar navegável dentro da competência dela.
      const filtros = origemCrua
        ? lerFiltros(decodeURIComponent(origemCrua))
        : { ...lerFiltros(null), mes: String(mes), ano: String(ano) }

      const chave = escreverFiltros(filtros)
      if (cancelado) return
      setOrigem(chave)

      const emCache = lerCache(chave)
      if (emCache) {
        setGrupos(emCache)
        setCarregando(false)
        return
      }

      // Papel do Portal enxerga só a própria escala; `profiles.servidor_id` é a fonte única do
      // vínculo desde 22/08/2026 (armadilha 17), com queda para o e-mail nas contas que ainda
      // não foram vinculadas.
      let servidorVinculadoId: string | null = userProfile?.servidor_id || null
      if (!servidorVinculadoId && (userProfile?.role === 'comum' || userProfile?.role === 'servidor')) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user?.email) {
          const { data: servidor } = await supabase
            .from('servidores')
            .select('id')
            .eq('email', user.email)
            .maybeSingle()
          servidorVinculadoId = servidor?.id || null
        }
      }

      const { linhas, erro } = await buscarEscalasMensais(supabase, userProfile, {
        mes: filtros.mes,
        ano: filtros.ano
      })
      if (erro) console.error('Erro ao carregar a sequência de escalas:', erro)
      if (cancelado) return

      const visiveis = linhas.filter(e => escalaVisivel(e, filtros, userProfile, servidorVinculadoId))
      const sequencia = agruparEscalas(visiveis)
      // A linha representativa não vai ao cache: ela carrega a escala inteira e a barra só usa
      // os nomes e a chave.
      const enxuta = sequencia.map(g => ({ ...g, item: null }))
      gravarCache(chave, enxuta)
      setGrupos(enxuta)
      setCarregando(false)
    }

    carregar()
    return () => { cancelado = true }
  }, [supabase, userProfile, mes, ano, unidadeId, setorId])

  const indice = indiceDaEscala(grupos, { unidadeId, setorId, mes, ano })
  const anterior = indice > 0 ? grupos[indice - 1] : null
  const proxima = indice >= 0 && indice < grupos.length - 1 ? grupos[indice + 1] : null

  const rotulo = (grupo: GrupoEscala) =>
    `${grupo.unidade_nome} • ${grupo.setor_nome} (${String(grupo.mes).padStart(2, '0')}/${grupo.ano})`

  /**
   * `replace` para as escalas vizinhas: assim o "voltar" do navegador continua devolvendo a
   * lista, e não a escala anterior desta navegação. O caminho de volta é o botão da esquerda,
   * que usa `push` por ser uma saída deliberada da grade.
   */
  const navegar = (destino: string, rotuloDestino: string, empilhar = false) => {
    if (gradeAlterada) {
      setSaidaPendente({ destino, rotulo: rotuloDestino, empilhar })
      return
    }
    if (empilhar) router.push(destino)
    else router.replace(destino)
  }

  const irPara = (destino: GrupoEscala | null) => {
    if (!destino) return
    navegar(urlDaGrade(destino, origem), rotulo(destino))
  }

  const botao = 'inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-2 text-sm font-bold text-zinc-700 dark:text-zinc-200 transition-colors hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 dark:hover:bg-blue-900/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-zinc-800 disabled:hover:text-zinc-700 disabled:hover:border-zinc-300'

  return (
    <div className="px-4 pt-4 flex flex-wrap items-center gap-2 print:hidden">
      <button
        onClick={() => navegar(origem ? `/escalas?${origem}` : '/escalas', 'a lista de escalas', true)}
        className={botao}
        title="Voltar para a lista de escalas, com os filtros que você tinha selecionado"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar à lista
      </button>

      <div className="flex items-center gap-1">
        <button
          onClick={() => irPara(anterior)}
          disabled={!anterior}
          className={botao}
          title={anterior ? `Anterior: ${rotulo(anterior)}` : 'Esta é a primeira escala da lista'}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Anterior</span>
        </button>

        <div className="px-2 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 min-w-[6rem] justify-center">
          {carregando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : indice >= 0 ? (
            <>
              <Layers className="h-3.5 w-3.5 text-blue-500" />
              {indice + 1} de {grupos.length}
            </>
          ) : (
            <span title="A escala aberta não faz parte da lista filtrada de onde a navegação vem">
              fora do filtro
            </span>
          )}
        </div>

        <button
          onClick={() => irPara(proxima)}
          disabled={!proxima}
          className={botao}
          title={proxima ? `Próxima: ${rotulo(proxima)}` : 'Esta é a última escala da lista'}
        >
          <span className="hidden sm:inline">Próxima</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {!carregando && proxima && (
        <span className="hidden lg:inline text-xs text-zinc-400 dark:text-zinc-500 truncate max-w-[22rem]">
          Próxima: {rotulo(proxima)}
        </span>
      )}

      <Modal
        isOpen={!!saidaPendente}
        onClose={() => setSaidaPendente(null)}
        title="Há alterações não salvas"
        type="warning"
        footer={
          <>
            <button
              onClick={() => setSaidaPendente(null)}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              Ficar e salvar
            </button>
            <button
              onClick={() => {
                const saida = saidaPendente
                setSaidaPendente(null)
                if (!saida) return
                // Mesma regra da navegacao normal: seta troca a entrada atual, voltar empilha.
                if (saida.empilhar) router.push(saida.destino)
                else router.replace(saida.destino)
              }}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-700 text-white transition-colors"
            >
              Sair sem salvar
            </button>
          </>
        }
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Esta grade tem lançamentos que ainda não foram gravados. Sair agora para{' '}
          <strong className="text-zinc-900 dark:text-white">{saidaPendente?.rotulo}</strong> descarta essas alterações.
        </p>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          Use <strong>Salvar Previsão</strong> antes de continuar se quiser mantê-las.
        </p>
      </Modal>
    </div>
  )
}
