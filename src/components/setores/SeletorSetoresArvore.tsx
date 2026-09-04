'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'

import {
  idsComFilhos as calcularIdsComFilhos,
  idsDaSubarvore,
  idsQueCasam,
  montarArvore,
  type No,
  type SetorNo,
} from './arvoreSetores'

/**
 * Seleção de setores em ÁRVORE, com marcação em cascata.
 *
 * Substitui a lista plana do modal do Dispositivo REP, onde a hierarquia aparecia só como recuo
 * ("↳ ") dentro do texto do item: numa unidade como o HMM, escolher os setores de um bloco
 * significava caçar e marcar dezenas de caixas uma a uma, sem nenhuma noção de onde um ramo
 * terminava e o outro começava.
 *
 * ⚠️ Clicar num nó marca (ou desmarca) ele E TODOS OS DESCENDENTES. É a operação que o usuário
 * quer no caso dominante — "este relógio atende a ALA - PSICOSSOCIAL inteira" — e é por isso que
 * a caixa do pai não é uma seleção "própria" independente dos filhos. Para marcar um pai sem os
 * filhos, marque o pai e desmarque os filhos: o pai fica com o traço de parcial.
 *
 * ⚠️ Setor INATIVO não é oferecido, mas continua listado quando já está selecionado — some da
 * lista sem sair da seleção seria perda silenciosa: o vínculo continuaria no banco, invisível
 * na tela que existe justamente para gerenciá-lo. Ele aparece marcado como "inativo", e
 * desmarcá-lo é a forma de tirá-lo.
 */

// A montagem da árvore, o filtro por texto e a lista de nós recolhíveis vivem em
// `./arvoreSetores` desde 03/09/2026 — são compartilhados com `SeletorSetorArvore` (seleção
// única). Duas cópias divergiriam no primeiro ajuste de ordenação ou de tratamento de órfão, e a
// mesma unidade passaria a desenhar hierarquias diferentes em duas telas.
export type { SetorNo } from './arvoreSetores'

/** Caixa com os três estados — o "parcial" precisa ser escrito via DOM, não existe em JSX. */
function Caixa({
  marcado,
  parcial,
  onChange,
}: {
  marcado: boolean
  parcial: boolean
  onChange: (valor: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !marcado && parcial
  }, [marcado, parcial])

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={marcado}
      onChange={(e) => onChange(e.target.checked)}
      className="shrink-0"
    />
  )
}

export function SeletorSetoresArvore({
  setores,
  selecionados,
  onChange,
  avisoPorSetor,
  alturaMax = 'max-h-72',
}: {
  setores: SetorNo[]
  selecionados: string[]
  onChange: (ids: string[]) => void
  /** Texto auxiliar por setor (ex.: "já em REP-iDClass-HMM-02"). */
  avisoPorSetor?: Map<string, string[]>
  alturaMax?: string
}) {
  const [busca, setBusca] = useState('')
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set())

  const selecionadosSet = useMemo(() => new Set(selecionados), [selecionados])

  // Inativo só entra se já estiver selecionado — ver o cabeçalho.
  const visiveis = useMemo(
    () => setores.filter((s) => s.ativo !== false || selecionadosSet.has(s.id)),
    [setores, selecionadosSet]
  )

  const raizes = useMemo(() => montarArvore(visiveis), [visiveis])

  // Filtro por texto: o nó casa se o nome dele casa OU se algum descendente casa (senão o ramo
  // inteiro sumiria e o resultado ficaria sem contexto de onde está).
  const termo = busca.trim().toLowerCase()
  const casa = useMemo(() => idsQueCasam(raizes, termo), [raizes, termo])

  const todosIds = useMemo(() => visiveis.map((s) => s.id), [visiveis])

  // Só nó COM filho pode ser recolhido — recolher folha não faz nada e deixaria o estado sujo.
  const idsComFilhos = useMemo(() => calcularIdsComFilhos(raizes), [raizes])

  function alternar(no: No, marcar: boolean) {
    const alvo = new Set(idsDaSubarvore(no))
    if (marcar) onChange([...new Set([...selecionados, ...alvo])])
    else onChange(selecionados.filter((id) => !alvo.has(id)))
  }

  function renderizar(no: No): React.ReactNode {
    if (termo && !casa.has(no.id)) return null

    const subarvore = idsDaSubarvore(no)
    const marcados = subarvore.filter((id) => selecionadosSet.has(id)).length
    const marcado = marcados === subarvore.length
    const parcial = marcados > 0 && !marcado
    // Durante a busca o ramo fica sempre aberto: recolher esconderia justamente o que casou.
    const recolhido = !termo && recolhidos.has(no.id)
    const avisos = avisoPorSetor?.get(no.id)

    return (
      <div key={no.id}>
        <div
          className="flex items-center gap-1.5 py-0.5 text-sm"
          style={{ paddingLeft: `${no.profundidade * 16}px` }}
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
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${recolhido ? '' : 'rotate-90'}`} />
            </button>
          ) : (
            <span className="w-[22px] shrink-0" />
          )}

          <label className="flex items-center gap-2 cursor-pointer min-w-0">
            <Caixa marcado={marcado} parcial={parcial} onChange={(v) => alternar(no, v)} />
            <span className={no.ativo === false ? 'text-zinc-400 line-through' : ''}>{no.nome}</span>
          </label>

          {no.ativo === false && (
            <span className="text-[10px] font-semibold uppercase text-zinc-400">inativo</span>
          )}
          {no.filhos.length > 0 && (
            <span className="text-[10px] text-zinc-400">
              {marcados}/{subarvore.length}
            </span>
          )}
          {avisos && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 truncate">
              já em {avisos.join(', ')}
            </span>
          )}
        </div>

        {!recolhido && no.filhos.map(renderizar)}
      </div>
    )
  }

  const totalSelecionados = selecionados.filter((id) => todosIds.includes(id)).length

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <button
          type="button"
          onClick={() => onChange([...new Set([...selecionados, ...todosIds])])}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Marcar todos
        </button>
        <button
          type="button"
          onClick={() => onChange(selecionados.filter((id) => !todosIds.includes(id)))}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Limpar
        </button>
        <button
          type="button"
          onClick={() => setRecolhidos(new Set(idsComFilhos))}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Recolher tudo
        </button>
        <button
          type="button"
          onClick={() => setRecolhidos(new Set())}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Expandir tudo
        </button>
        <span className="ml-auto text-zinc-500">
          {totalSelecionados} de {todosIds.length} selecionado{totalSelecionados === 1 ? '' : 's'}
        </span>
      </div>

      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Filtrar setor…"
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 pl-7 pr-3 py-1.5 text-xs"
        />
      </div>

      <div className={`${alturaMax} overflow-y-auto rounded-lg border border-zinc-300 dark:border-zinc-700 p-2`}>
        {raizes.length === 0 ? (
          <p className="text-xs text-zinc-400">Nenhum setor ativo nesta unidade.</p>
        ) : (
          raizes.map(renderizar)
        )}
      </div>
    </div>
  )
}
