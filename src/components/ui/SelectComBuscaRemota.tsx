'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react'

/**
 * Seletor com busca incremental **no servidor** — irmão de `SelectComBusca`, para o caso em que
 * a lista não pode ser carregada inteira no navegador.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE (31/08/2026)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * `SelectComBusca` filtra em memória uma lista que a tela já tem. Isso não serve quando:
 *
 *   1. **a lista não cabe** — 1.393 servidores ativos em produção, acima do corte SILENCIOSO de
 *      1.000 linhas do PostgREST (CLAUDE.md, armadilha 8): a busca pareceria funcionar e não
 *      acharia parte das pessoas; e
 *   2. **quem procura não pode ver a lista toda** — a RLS de `servidores` mostra a um coordenador
 *      só o próprio escopo, e o dado procurado é justamente o de fora dele. Quem atravessa a RLS
 *      é uma RPC `SECURITY DEFINER` *bounded por termo*, que por construção nunca devolve tudo.
 *
 * ⚠️ **Resposta atrasada nunca sobrescreve resposta nova.** Digitar rápido dispara buscas em
 * ordem e elas voltam fora de ordem; sem o descarte por número de sequência, a lista final é a
 * de um termo que o usuário já apagou — e o resultado errado é indistinguível do certo.
 *
 * ⚠️ **Abaixo de `minCaracteres` não há busca, e a tela DIZ isso.** Campo vazio calado passa a
 * impressão de que não achou nada.
 *
 * ⚠️ **O rótulo do que está selecionado vem de fora (`rotuloSelecionado`)**, não da lista: a
 * lista é o resultado da última busca e não contém, em geral, a opção já escolhida.
 */

export interface OpcaoRemota {
  value: string
  label: string
  /** Mostrada em cinza abaixo do rótulo — matrícula, lotação, etc. */
  detalhe?: string
  disabled?: boolean
  /** Por que está desabilitada. Aparece no lugar do detalhe. */
  motivoDesabilitado?: string
}

interface Props {
  value: string
  /** Texto do que está selecionado (a opção pode não estar na lista da busca atual). */
  rotuloSelecionado?: string
  onChange: (opcao: OpcaoRemota | null) => void
  buscar: (termo: string) => Promise<OpcaoRemota[]>
  minCaracteres?: number
  placeholder?: string
  className?: string
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

/** Tempo parado antes de consultar o servidor. Curto o bastante para parecer instantâneo. */
const ESPERA_MS = 300

export function SelectComBuscaRemota({
  value, rotuloSelecionado, onChange, buscar, minCaracteres = 3, placeholder = 'Selecione…',
  className = '', disabled = false, id, 'aria-label': ariaLabel,
}: Props) {
  const [aberto, setAberto] = useState(false)
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<OpcaoRemota[]>([])
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [destaque, setDestaque] = useState(0)

  const caixaRef = useRef<HTMLDivElement>(null)
  const buscaRef = useRef<HTMLInputElement>(null)
  const listaRef = useRef<HTMLUListElement>(null)
  /** Número da última busca disparada — o que descarta resposta que chegou fora de ordem. */
  const sequenciaRef = useRef(0)

  const executarBusca = useCallback(async (texto: string) => {
    const meu = ++sequenciaRef.current
    if (texto.trim().length < minCaracteres) {
      setResultados([]); setBuscando(false); setErro(null)
      return
    }
    setBuscando(true); setErro(null)
    try {
      const achados = await buscar(texto.trim())
      if (meu !== sequenciaRef.current) return // chegou tarde: já há busca mais nova
      setResultados(achados)
      setDestaque(0)
    } catch (e: any) {
      if (meu !== sequenciaRef.current) return
      setResultados([])
      setErro(e?.message || 'Falha ao buscar.')
    } finally {
      if (meu === sequenciaRef.current) setBuscando(false)
    }
  }, [buscar, minCaracteres])

  // Debounce: só consulta o servidor depois que o usuário para de digitar.
  useEffect(() => {
    if (!aberto) return
    const t = setTimeout(() => { executarBusca(termo) }, ESPERA_MS)
    return () => clearTimeout(t)
  }, [termo, aberto, executarBusca])

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!aberto) return
    function aoClicarFora(e: MouseEvent) {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => document.removeEventListener('mousedown', aoClicarFora)
  }, [aberto])

  // Quem abriu um campo de busca veio para digitar.
  useEffect(() => {
    if (aberto) {
      setTermo(''); setResultados([]); setErro(null); setDestaque(0)
      setTimeout(() => buscaRef.current?.focus(), 0)
    }
  }, [aberto])

  useEffect(() => {
    if (!aberto || !listaRef.current) return
    const el = listaRef.current.children[destaque] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [destaque, aberto])

  function escolher(o: OpcaoRemota) {
    if (o.disabled) return
    onChange(o)
    setAberto(false)
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setAberto(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setDestaque(d => Math.min(d + 1, resultados.length - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setDestaque(d => Math.max(d - 1, 0)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const alvo = resultados[destaque]
      if (alvo) escolher(alvo)
    }
  }

  const curto = termo.trim().length > 0 && termo.trim().length < minCaracteres

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
        <span className={`truncate ${value ? '' : 'text-zinc-400'}`}>
          {value ? (rotuloSelecionado || 'Selecionado') : placeholder}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {value && !disabled && (
            <X
              className="h-4 w-4 text-zinc-400 hover:text-red-500"
              role="button"
              aria-label="Limpar seleção"
              onClick={(e) => { e.stopPropagation(); onChange(null) }}
            />
          )}
          <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${aberto ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {aberto && (
        <div className="absolute z-50 mt-1 w-full min-w-[18rem] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl overflow-hidden">
          <div className="relative border-b border-zinc-100 dark:border-zinc-800">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              ref={buscaRef}
              type="text"
              value={termo}
              onChange={e => setTermo(e.target.value)}
              onKeyDown={aoTeclar}
              placeholder={`Digite ao menos ${minCaracteres} caracteres…`}
              className="w-full pl-9 pr-8 py-2.5 text-sm bg-transparent outline-none text-zinc-900 dark:text-white"
            />
            {buscando && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-zinc-400" />}
            {!buscando && termo && (
              <button
                type="button"
                onClick={() => { setTermo(''); buscaRef.current?.focus() }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600"
                aria-label="Limpar busca"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <ul ref={listaRef} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {erro && (
              <li className="px-3 py-4 text-center text-xs text-red-600 dark:text-red-400">{erro}</li>
            )}
            {!erro && curto && (
              <li className="px-3 py-6 text-center text-xs text-zinc-400">
                Digite ao menos {minCaracteres} caracteres para buscar.
              </li>
            )}
            {!erro && !curto && !termo.trim() && (
              <li className="px-3 py-6 text-center text-xs text-zinc-400">
                Comece a digitar o nome ou a matrícula.
              </li>
            )}
            {!erro && !curto && !!termo.trim() && !buscando && resultados.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-zinc-400">
                Nada encontrado para “{termo.trim()}”.
              </li>
            )}
            {!erro && resultados.map((o, i) => {
              const escolhido = o.value === value
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={escolhido}
                  onMouseEnter={() => setDestaque(i)}
                  onClick={() => escolher(o)}
                  className={`flex items-start gap-2 px-3 py-2 text-sm ${
                    o.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  } ${i === destaque && !o.disabled ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
                >
                  <Check className={`h-4 w-4 shrink-0 mt-0.5 ${escolhido ? 'text-emerald-600' : 'opacity-0'}`} />
                  <span className="min-w-0">
                    <span className="block truncate text-zinc-900 dark:text-white">{o.label}</span>
                    {(o.motivoDesabilitado || o.detalhe) && (
                      <span className={`block text-[11px] truncate ${o.motivoDesabilitado ? 'text-amber-600 dark:text-amber-500' : 'text-zinc-400'}`}>
                        {o.motivoDesabilitado || o.detalhe}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>

          {/* A RPC corta o resultado. Sem dizer isso, uma lista cheia parece a lista completa. */}
          {!erro && resultados.length >= 30 && (
            <div className="px-3 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-400">
              Mostrando os 30 primeiros — refine a busca.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
