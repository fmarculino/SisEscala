'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

/**
 * Seletor com busca incremental — substituto do `<select>` nativo em lista longa.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE (30/08/2026)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * O `<select>` nativo não filtra: para achar um nome é preciso rolar. Medido em produção:
 *
 *   servidores 1.392 · setores 646 (196 só na maior unidade) · cargos 260 · nomes de setor 232
 *
 * Com 1.392 opções, o seletor de "Servidor Específico" do Diagnóstico de Plantões é, na prática,
 * inutilizável — foi o que motivou este componente.
 *
 * ⚠️ **Abaixo de `LIMIAR_BUSCA` ele devolve o `<select>` NATIVO, de propósito.** Em lista curta o
 * nativo é melhor: abre o seletor do sistema no celular, funciona sem JavaScript, é o que o
 * usuário já conhece e não tem risco nenhum. Trocar tudo por um componente próprio seria pagar
 * complexidade onde não há problema — e a complexidade é onde moram os defeitos.
 *
 * ⚠️ **A busca é acento-insensível.** "JOSE" precisa achar "JOSÉ" e vice-versa: quem digita num
 * campo de filtro raramente acentua, e o cadastro é cheio de acento. Sem isso o componente
 * pareceria não achar registros que existem — pior que não ter busca, porque induz à conclusão
 * errada de que o servidor não está cadastrado.
 *
 * ⚠️ **Busca por qualquer pedaço, não só pelo começo.** Os rótulos deste sistema carregam a
 * matrícula entre parênteses (`FULANO DE TAL (57221)`) e o caminho do setor (`SHL \ BLOCO A`) —
 * quem procura por matrícula ou pelo nome da folha digita algo que está no MEIO do texto.
 */

export interface OpcaoSelect {
  value: string
  label: string
  /** Mostrada em cinza abaixo do rótulo — matrícula, caminho do setor, etc. */
  detalhe?: string
  disabled?: boolean
}

interface Props {
  value: string
  onChange: (value: string) => void
  opcoes: OpcaoSelect[]
  /** Rótulo da opção vazia. Quando ausente, não há opção vazia. */
  placeholder?: string
  className?: string
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

/**
 * Abaixo disto, `<select>` nativo. 12 é o ponto em que a lista ainda cabe na tela sem rolar
 * muito; acima, rolar para procurar começa a custar mais que digitar.
 */
const LIMIAR_BUSCA = 12

/** Remove acento e caixa. `NFD` separa a letra do diacrítico; o range apaga só os diacríticos. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function SelectComBusca({
  value, onChange, opcoes, placeholder, className = '', disabled = false, id,
  'aria-label': ariaLabel,
}: Props) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [destaque, setDestaque] = useState(0)
  const caixaRef = useRef<HTMLDivElement>(null)
  const buscaRef = useRef<HTMLInputElement>(null)
  const listaRef = useRef<HTMLUListElement>(null)

  const selecionada = opcoes.find(o => o.value === value)
  const rotuloAtual = selecionada?.label || placeholder || 'Selecione…'

  const filtradas = useMemo(() => {
    if (!busca.trim()) return opcoes
    const termo = normalizar(busca.trim())
    // Casa em qualquer pedaço do rótulo OU do detalhe — ver o comentário do cabeçalho.
    return opcoes.filter(o =>
      normalizar(o.label).includes(termo) || (o.detalhe ? normalizar(o.detalhe).includes(termo) : false))
  }, [opcoes, busca])

  // Fecha ao clicar fora. Sem isto o painel fica aberto por cima do resto da tela.
  useEffect(() => {
    if (!aberto) return
    function aoClicarFora(e: MouseEvent) {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => document.removeEventListener('mousedown', aoClicarFora)
  }, [aberto])

  // Foca a busca ao abrir: quem abriu um seletor de 1.392 itens veio para digitar.
  useEffect(() => {
    if (aberto) { setBusca(''); setDestaque(0); setTimeout(() => buscaRef.current?.focus(), 0) }
  }, [aberto])

  // Mantém a opção destacada visível durante a navegação por teclado.
  useEffect(() => {
    if (!aberto || !listaRef.current) return
    const el = listaRef.current.children[destaque] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [destaque, aberto])

  function escolher(v: string) {
    onChange(v)
    setAberto(false)
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setAberto(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setDestaque(d => Math.min(d + 1, filtradas.length - (placeholder ? 0 : 1))); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setDestaque(d => Math.max(d - 1, 0)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (placeholder && destaque === 0) { escolher(''); return }
      const alvo = filtradas[placeholder ? destaque - 1 : destaque]
      if (alvo && !alvo.disabled) escolher(alvo.value)
    }
  }

  // ── Lista curta: o nativo é melhor. Ver o aviso no cabeçalho. ────────────────────────────────
  if (opcoes.length < LIMIAR_BUSCA) {
    return (
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className={className}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {opcoes.map(o => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}{o.detalhe ? ` — ${o.detalhe}` : ''}
          </option>
        ))}
      </select>
    )
  }

  const itens: (OpcaoSelect | null)[] = placeholder ? [null, ...filtradas] : filtradas

  return (
    <div ref={caixaRef} className="relative">
      <button
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        disabled={disabled}
        onClick={() => setAberto(a => !a)}
        className={`${className} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${selecionada ? '' : 'text-zinc-400'}`}>{rotuloAtual}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>

      {aberto && (
        <div className="absolute z-50 mt-1 w-full min-w-[16rem] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl overflow-hidden">
          <div className="relative border-b border-zinc-100 dark:border-zinc-800">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              ref={buscaRef}
              type="text"
              value={busca}
              onChange={e => { setBusca(e.target.value); setDestaque(0) }}
              onKeyDown={aoTeclar}
              placeholder="Digite para filtrar…"
              className="w-full pl-9 pr-8 py-2.5 text-sm bg-transparent outline-none text-zinc-900 dark:text-white"
            />
            {busca && (
              <button
                type="button"
                onClick={() => { setBusca(''); buscaRef.current?.focus() }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600"
                aria-label="Limpar busca"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <ul ref={listaRef} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {itens.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-zinc-400">
                Nada encontrado para “{busca}”.
              </li>
            )}
            {itens.map((o, i) => {
              const ehVazia = o === null
              const escolhido = ehVazia ? !value : o!.value === value
              return (
                <li
                  key={ehVazia ? '__vazia' : o!.value}
                  role="option"
                  aria-selected={escolhido}
                  onMouseEnter={() => setDestaque(i)}
                  onClick={() => { if (ehVazia) escolher(''); else if (!o!.disabled) escolher(o!.value) }}
                  className={`flex items-start gap-2 px-3 py-2 text-sm ${
                    o?.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                  } ${i === destaque ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
                >
                  <Check className={`h-4 w-4 shrink-0 mt-0.5 ${escolhido ? 'text-emerald-600' : 'opacity-0'}`} />
                  <span className="min-w-0">
                    <span className={`block truncate ${ehVazia ? 'text-zinc-500 italic' : 'text-zinc-900 dark:text-white'}`}>
                      {ehVazia ? placeholder : o!.label}
                    </span>
                    {!ehVazia && o!.detalhe && (
                      <span className="block text-[11px] text-zinc-400 truncate">{o!.detalhe}</span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>

          {/* Quem tem 1.392 opções precisa saber que a lista está cortada pela busca, e quantas
              sobraram — senão parece que o cadastro tem só o que está à vista. */}
          {opcoes.length > filtradas.length && (
            <div className="px-3 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-400">
              {filtradas.length} de {opcoes.length}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
