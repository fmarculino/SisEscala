'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Search, X } from 'lucide-react'

import {
  caminhoAteONo,
  idsComFilhos as calcularIdsComFilhos,
  idsQueCasam,
  montarArvore,
  type No,
  type SetorNo,
} from './arvoreSetores'

/**
 * Seleção de UM setor, em árvore. Substitui o `<select>` plano de "Setor de Destino".
 *
 * ⚠️ **Não é o `SeletorSetoresArvore` com `selecionados.length === 1`.** Aquele marca em
 * CASCATA — clicar num pai marca todos os descendentes —, que é o que se quer para "este relógio
 * atende a ALA - PSICOSSOCIAL inteira" e é exatamente o oposto do que se quer aqui: a lotação de
 * um servidor é UM setor. Cascata neste lugar transferiria a pessoa para um setor que ninguém
 * escolheu. Por isso são dois componentes com a mesma árvore por baixo (`./arvoreSetores`) e
 * semânticas de clique diferentes.
 *
 * ⚠️ **O pai é selecionável.** Há servidor lotado no setor-pai, não só nas folhas — desabilitar
 * nó com filho tiraria da tela lotação que existe no cadastro.
 *
 * ⚠️ **O caminho completo fica no resumo, não em cada linha.** A árvore já mostra a hierarquia
 * pelo recuo; repetir "SHL \ BLOCO A" em toda linha é ruído. Mas depois de recolher um ramo — ou
 * de rolar a lista — o pai sai da tela, e é por isso que o setor escolhido aparece por extenso
 * na barra de cima. É a mesma razão pela qual `formatSectorPaths` existe (armadilha registrada
 * em 28/08/2026): nome de folha sozinho não identifica setor.
 *
 * ⚠️ **Setor inativo não é oferecido, mas o já escolhido continua listado.** Sumir da lista sem
 * sair da seleção é perda silenciosa — o valor continuaria no formulário, invisível. Ele aparece
 * riscado e marcado como "inativo". Mesma regra de `opcoesAtivas.ts`.
 */

export interface SetorNoUnico extends SetorNo {
  /** Caminho completo ("SHL \ BLOCO A"), só para o resumo. Cai para `nome` quando ausente. */
  caminho?: string
}

export function SeletorSetorArvore({
  setores,
  selecionado,
  onChange,
  placeholder = 'Nenhum setor selecionado',
  alturaMax = 'max-h-56',
  disabled = false,
}: {
  setores: SetorNoUnico[]
  selecionado: string
  onChange: (id: string) => void
  placeholder?: string
  alturaMax?: string
  disabled?: boolean
}) {
  const [busca, setBusca] = useState('')
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set())

  // Inativo só entra se já for o valor atual — ver o cabeçalho.
  const visiveis = useMemo(
    () => setores.filter((s) => s.ativo !== false || s.id === selecionado),
    [setores, selecionado]
  )

  const raizes = useMemo(() => montarArvore(visiveis), [visiveis])

  const termo = busca.trim().toLowerCase()
  const casa = useMemo(() => idsQueCasam(raizes, termo), [raizes, termo])
  const idsComFilhos = useMemo(() => calcularIdsComFilhos(raizes), [raizes])

  const escolhido = useMemo(
    () => visiveis.find((s) => s.id === selecionado) || null,
    [visiveis, selecionado]
  )

  /**
   * O ramo do setor já escolhido nasce ABERTO — se ele estiver três níveis abaixo de um pai
   * recolhido, a tela abriria sem mostrar em lugar nenhum o valor que o formulário vai enviar.
   * Roda só quando a seleção muda, para não reabrir o que a pessoa acabou de recolher à mão.
   */
  const ultimoAberto = useRef<string | null>(null)
  useEffect(() => {
    if (!selecionado || ultimoAberto.current === selecionado) return
    ultimoAberto.current = selecionado
    const trilha = caminhoAteONo(raizes, selecionado)
    if (trilha.length === 0) return
    setRecolhidos((prev) => {
      const proximo = new Set(prev)
      trilha.forEach((id) => proximo.delete(id))
      return proximo
    })
  }, [selecionado, raizes])

  function renderizar(no: No): React.ReactNode {
    if (termo && !casa.has(no.id)) return null

    const marcado = no.id === selecionado
    // Durante a busca o ramo fica sempre aberto: recolher esconderia justamente o que casou.
    const recolhido = !termo && recolhidos.has(no.id)

    return (
      <div key={no.id}>
        <div
          className="flex items-center gap-1.5"
          style={{ paddingLeft: `${no.profundidade * 14}px` }}
        >
          {no.filhos.length > 0 ? (
            <button
              type="button"
              onClick={() =>
                setRecolhidos((prev) => {
                  const proximo = new Set(prev)
                  if (proximo.has(no.id)) proximo.delete(no.id)
                  else proximo.add(no.id)
                  return proximo
                })
              }
              className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label={recolhido ? 'Expandir' : 'Recolher'}
              title={recolhido ? 'Expandir' : 'Recolher'}
            >
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${recolhido ? '' : 'rotate-90'}`}
              />
            </button>
          ) : (
            <span className="w-[20px] shrink-0" />
          )}

          {/* Botão, não <input type="radio">: a área de clique precisa cobrir a linha inteira, e
              o estado "escolhido" é um só na árvore toda — não há grupo a nomear. */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(no.id)}
            aria-pressed={marcado}
            className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              marcado
                ? 'bg-emerald-100 font-semibold text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200'
                : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Check
              className={`h-3.5 w-3.5 shrink-0 ${marcado ? 'text-emerald-600 dark:text-emerald-400' : 'text-transparent'}`}
            />
            <span className={`truncate ${no.ativo === false ? 'text-zinc-400 line-through' : ''}`}>
              {no.nome}
            </span>
            {no.ativo === false && (
              <span className="shrink-0 text-[10px] font-semibold uppercase text-zinc-400">
                inativo
              </span>
            )}
          </button>
        </div>

        {!recolhido && no.filhos.map(renderizar)}
      </div>
    )
  }

  const nadaCasou = termo.length > 0 && casa.size === 0

  return (
    <div className="space-y-1.5">
      {/* Resumo: o caminho completo do escolhido, que a árvore sozinha não garante visível. */}
      <div className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800">
        {escolhido ? (
          <>
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="min-w-0 flex-1 truncate font-semibold text-zinc-900 dark:text-white">
              {escolhido.caminho || escolhido.nome}
            </span>
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700"
                aria-label="Limpar seleção"
                title="Limpar seleção"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        ) : (
          <span className="text-zinc-400">{placeholder}</span>
        )}
      </div>

      {setores.length > 0 && (
        <>
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Filtrar setor…"
                disabled={disabled}
                className="w-full rounded-md border border-zinc-300 bg-white py-1 pl-7 pr-2 text-xs dark:border-zinc-700 dark:bg-zinc-800"
              />
            </div>
            {idsComFilhos.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setRecolhidos(new Set(idsComFilhos))}
                  className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Recolher
                </button>
                <button
                  type="button"
                  onClick={() => setRecolhidos(new Set())}
                  className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Expandir
                </button>
              </>
            )}
          </div>

          <div
            className={`${alturaMax} overflow-y-auto rounded-md border border-zinc-300 p-1 dark:border-zinc-700`}
          >
            {nadaCasou ? (
              <p className="px-1.5 py-1 text-xs text-zinc-400">Nenhum setor casa com “{busca}”.</p>
            ) : (
              raizes.map(renderizar)
            )}
          </div>
        </>
      )}

      {setores.length === 0 && (
        <p className="text-[11px] text-zinc-400">Selecione a unidade primeiro.</p>
      )}
    </div>
  )
}
