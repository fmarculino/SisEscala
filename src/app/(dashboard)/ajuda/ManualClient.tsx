'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3, BookOpen, CalendarDays, CalendarRange, ChevronDown, ChevronLeft, ChevronRight,
  Compass, Fingerprint, HelpCircle, Menu, Search, UserCheck, Users, X,
} from 'lucide-react'
import { MANUAL, TODAS_AS_SECOES } from './conteudo'
import { RenderBloco } from './Blocos'
import { indiceDaSecao, normalizar, type Papel } from './tipos'

const ICONES: Record<string, typeof BookOpen> = {
  Compass, CalendarRange, CalendarDays, Fingerprint, Users, BarChart3, UserCheck, HelpCircle,
}

/** Cor da etiqueta de perfil. Servidor e "Todos" ficam neutros; os de gestão, azuis. */
function corDoPapel(papel: Papel): string {
  if (papel === 'Todos') return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
  if (papel === 'Servidor') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
}

export function ManualClient({ versao }: { versao: string }) {
  const [secaoId, setSecaoId] = useState(TODAS_AS_SECOES[0].secao.id)
  const [busca, setBusca] = useState('')
  const [menuAberto, setMenuAberto] = useState(false)
  const [capitulosFechados, setCapitulosFechados] = useState<Set<string>>(new Set())
  const areaLeitura = useRef<HTMLDivElement>(null)

  /**
   * O índice de busca é montado uma vez. Ele cobre título, resumo, perfis e o texto de todos os
   * blocos — quem procura por uma frase que leu numa tabela precisa achar a seção que a contém,
   * e não só as que têm a palavra no título.
   */
  const indice = useMemo(
    () => TODAS_AS_SECOES.map(({ capitulo, secao }) => ({
      capituloId: capitulo.id,
      capituloTitulo: capitulo.titulo,
      secao,
      texto: indiceDaSecao(secao),
    })),
    []
  )

  const termo = normalizar(busca.trim())
  const resultados = useMemo(() => {
    if (termo.length < 2) return null
    // Todas as palavras precisam aparecer: buscar "ponto folha" tem que achar o cruzamento das
    // duas, e não tudo que fala de ponto.
    const palavras = termo.split(/\s+/)
    return indice.filter(i => palavras.every(p => i.texto.includes(p)))
  }, [indice, termo])

  const atual = TODAS_AS_SECOES.find(s => s.secao.id === secaoId) || TODAS_AS_SECOES[0]
  const posicao = TODAS_AS_SECOES.findIndex(s => s.secao.id === atual.secao.id)
  const anterior = posicao > 0 ? TODAS_AS_SECOES[posicao - 1] : null
  const proxima = posicao < TODAS_AS_SECOES.length - 1 ? TODAS_AS_SECOES[posicao + 1] : null

  /**
   * Trocar de seção rola a LEITURA para o topo, não a página. Sem isso, quem clica numa seção
   * longa e depois em outra começa a ler no meio do texto novo, sem entender por quê.
   */
  function irPara(id: string) {
    setSecaoId(id)
    setMenuAberto(false)
    areaLeitura.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Atalho: "/" foca a busca, como em qualquer documentação. Ignorado enquanto se digita.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null
      const digitando = alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)
      if (e.key === '/' && !digitando) {
        e.preventDefault()
        document.getElementById('manual-busca')?.focus()
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [])

  function alternarCapitulo(id: string) {
    setCapitulosFechados(prev => {
      const proximo = new Set(prev)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })
  }

  const navegacao = (
    <nav className="space-y-1">
      {MANUAL.map(cap => {
        const Icone = ICONES[cap.icone] || BookOpen
        const fechado = capitulosFechados.has(cap.id)
        const temAtual = cap.secoes.some(s => s.id === secaoId)
        return (
          <div key={cap.id}>
            <button
              type="button"
              onClick={() => alternarCapitulo(cap.id)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Icone
                className={`h-4 w-4 shrink-0 ${temAtual ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-zinc-800 dark:text-zinc-100">
                {cap.titulo}
              </span>
              {fechado ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              )}
            </button>

            {!fechado && (
              <div className="mb-1 ml-[1.05rem] border-l border-zinc-200 pl-2 dark:border-zinc-800">
                {cap.secoes.map(sec => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => irPara(sec.id)}
                    className={`block w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                      sec.id === secaoId
                        ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                        : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {sec.titulo}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[30rem] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* Cabeçalho */}
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setMenuAberto(v => !v)}
          className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-800"
          aria-label="Sumário"
        >
          {menuAberto ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <div className="hidden items-center gap-2 sm:flex">
          <div className="rounded-lg bg-blue-600 p-1.5">
            <BookOpen className="h-4 w-4 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold text-zinc-900 dark:text-white">Manual do SisEscala</p>
            <p className="text-[11px] text-zinc-400">versão {versao}</p>
          </div>
        </div>

        <div className="relative ml-auto w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            id="manual-busca"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar no manual…  (tecle /)"
            className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-8 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
              aria-label="Limpar busca"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sumário */}
        <aside
          className={`${
            menuAberto ? 'block' : 'hidden'
          } w-full shrink-0 overflow-y-auto border-r border-zinc-200 bg-zinc-50/60 p-3 lg:block lg:w-72 dark:border-zinc-800 dark:bg-zinc-900/50`}
        >
          {navegacao}
        </aside>

        {/* Leitura */}
        <div ref={areaLeitura} className={`${menuAberto ? 'hidden' : 'block'} min-w-0 flex-1 overflow-y-auto lg:block`}>
          {resultados ? (
            <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8">
              <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
                {resultados.length === 0
                  ? 'Nenhuma seção fala sobre isso.'
                  : `${resultados.length} ${resultados.length === 1 ? 'seção encontrada' : 'seções encontradas'} para “${busca.trim()}”`}
              </p>

              {resultados.length === 0 && (
                <div className="rounded-xl border border-zinc-200 p-5 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  Tente uma palavra mais curta, ou procure pelo nome da tela — “folha”, “plantão”,
                  “PIN”, “férias”, “relógio”.
                </div>
              )}

              <div className="space-y-2">
                {resultados.map(r => (
                  <button
                    key={r.secao.id}
                    type="button"
                    onClick={() => { setBusca(''); irPara(r.secao.id) }}
                    className="block w-full rounded-xl border border-zinc-200 p-4 text-left hover:border-blue-300 hover:bg-blue-50/40 dark:border-zinc-800 dark:hover:border-blue-800 dark:hover:bg-blue-500/5"
                  >
                    <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                      {r.capituloTitulo}
                    </p>
                    <p className="mt-0.5 font-semibold text-zinc-900 dark:text-white">{r.secao.titulo}</p>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {r.secao.resumo}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <article className="mx-auto max-w-3xl px-5 py-6 sm:px-8">
              <p className="text-[11px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                {atual.capitulo.titulo}
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl dark:text-white">
                {atual.secao.titulo}
              </h1>
              <p className="mt-2 text-zinc-500 dark:text-zinc-400">{atual.secao.resumo}</p>

              {atual.secao.papeis && atual.secao.papeis.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Perfis
                  </span>
                  {atual.secao.papeis.map(p => (
                    <span
                      key={p}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${corDoPapel(p)}`}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}

              <hr className="my-6 border-zinc-200 dark:border-zinc-800" />

              {atual.secao.blocos.map((bloco, i) => (
                <RenderBloco key={i} bloco={bloco} onIrParaSecao={irPara} />
              ))}

              {/* Continuar lendo — o manual tem ordem, e ela ajuda quem está aprendendo. */}
              <nav className="mt-10 flex flex-col gap-2 border-t border-zinc-200 pt-5 sm:flex-row dark:border-zinc-800">
                {anterior && (
                  <button
                    type="button"
                    onClick={() => irPara(anterior.secao.id)}
                    className="group flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-zinc-200 p-3 text-left hover:border-blue-300 dark:border-zinc-800 dark:hover:border-blue-800"
                  >
                    <ChevronLeft className="h-4 w-4 shrink-0 text-zinc-400 group-hover:text-blue-600" />
                    <span className="min-w-0">
                      <span className="block text-[11px] uppercase tracking-wide text-zinc-400">Anterior</span>
                      <span className="block truncate text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                        {anterior.secao.titulo}
                      </span>
                    </span>
                  </button>
                )}
                {proxima && (
                  <button
                    type="button"
                    onClick={() => irPara(proxima.secao.id)}
                    className="group flex min-w-0 flex-1 items-center justify-end gap-2 rounded-xl border border-zinc-200 p-3 text-right hover:border-blue-300 dark:border-zinc-800 dark:hover:border-blue-800"
                  >
                    <span className="min-w-0">
                      <span className="block text-[11px] uppercase tracking-wide text-zinc-400">Próxima</span>
                      <span className="block truncate text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                        {proxima.secao.titulo}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400 group-hover:text-blue-600" />
                  </button>
                )}
              </nav>
            </article>
          )}
        </div>
      </div>
    </div>
  )
}
