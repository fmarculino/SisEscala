'use client'

import React from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ChevronRight, Info, Lightbulb, Scale, ArrowRight,
} from 'lucide-react'
import type { Bloco, Tom } from './tipos'

/**
 * Renderizadores dos blocos do manual. Um tipo de bloco = uma aparência, no manual inteiro.
 *
 * ⚠️ Não acrescente estilo direto no conteúdo (`conteudo.ts`). Se um trecho precisa de uma
 * aparência que não existe aqui, o certo é criar um TIPO de bloco novo — senão o manual vira
 * trinta variações da mesma caixa e a próxima pessoa não sabe qual copiar.
 */

/**
 * Marcação leve dentro do texto: **negrito** e `código`.
 *
 * ⚠️ É interpretação de texto do PRÓPRIO manual (escrito por quem desenvolve, versionado no
 * repositório), nunca de conteúdo vindo do banco ou do usuário — por isso pode virar elemento
 * React sem sanitização. Nada aqui usa `dangerouslySetInnerHTML`.
 */
export function textoRico(texto: string): React.ReactNode {
  const partes = texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return partes.map((parte, i) => {
    if (parte.startsWith('**') && parte.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-zinc-900 dark:text-white">
          {parte.slice(2, -2)}
        </strong>
      )
    }
    if (parte.startsWith('`') && parte.endsWith('`')) {
      return (
        <code
          key={i}
          className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
        >
          {parte.slice(1, -1)}
        </code>
      )
    }
    return <React.Fragment key={i}>{parte}</React.Fragment>
  })
}

const TONS: Record<Tom, { classe: string; icone: typeof Info; rotulo: string }> = {
  atencao: {
    classe: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-200',
    icone: AlertTriangle,
    rotulo: 'Atenção',
  },
  cuidado: {
    classe: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-500/10 dark:text-rose-200',
    icone: AlertTriangle,
    rotulo: 'Cuidado',
  },
  dica: {
    classe: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-500/10 dark:text-sky-200',
    icone: Lightbulb,
    rotulo: 'Dica',
  },
  legal: {
    classe: 'border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-900/60 dark:bg-violet-500/10 dark:text-violet-200',
    icone: Scale,
    rotulo: 'Regra legal',
  },
}

export function RenderBloco({
  bloco,
  onIrParaSecao,
}: {
  bloco: Bloco
  onIrParaSecao: (id: string) => void
}) {
  switch (bloco.tipo) {
    case 'titulo':
      return (
        <h3 className="mt-8 mb-3 text-lg font-bold text-zinc-900 first:mt-0 dark:text-white">
          {bloco.texto}
        </h3>
      )

    case 'p':
      return (
        <p className="mb-4 leading-relaxed text-zinc-600 dark:text-zinc-300">
          {textoRico(bloco.texto)}
        </p>
      )

    case 'lista':
      return (
        <ul className="mb-4 space-y-2">
          {bloco.itens.map((item, i) => (
            <li key={i} className="flex gap-2.5 leading-relaxed text-zinc-600 dark:text-zinc-300">
              <span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
              <span>{textoRico(item)}</span>
            </li>
          ))}
        </ul>
      )

    case 'passos':
      return (
        <ol className="mb-5 space-y-3">
          {bloco.itens.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                {i + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="font-semibold text-zinc-900 dark:text-white">{textoRico(item.titulo)}</p>
                {item.texto && (
                  <p className="mt-0.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {textoRico(item.texto)}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )

    case 'tabela':
      // A tabela rola dentro do próprio contêiner: a página nunca rola na horizontal.
      return (
        <div className="mb-5 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/60">
              <tr>
                {bloco.colunas.map((c, i) => (
                  <th
                    key={i}
                    className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {bloco.linhas.map((linha, i) => (
                <tr key={i} className="align-top">
                  {linha.map((celula, j) => (
                    <td
                      key={j}
                      className={`px-4 py-2.5 leading-relaxed ${
                        j === 0
                          ? 'font-medium text-zinc-900 dark:text-white'
                          : 'text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {textoRico(celula)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )

    case 'aviso': {
      const { classe, icone: Icone, rotulo } = TONS[bloco.tom]
      return (
        <div className={`mb-5 flex gap-3 rounded-xl border p-4 ${classe}`}>
          <Icone className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold">{bloco.titulo || rotulo}</p>
            <p className="mt-1 text-sm leading-relaxed">{textoRico(bloco.texto)}</p>
          </div>
        </div>
      )
    }

    case 'cartoes':
      return (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {bloco.itens.map((item, i) => (
            <div
              key={i}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <p className="font-semibold text-zinc-900 dark:text-white">{textoRico(item.titulo)}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {textoRico(item.texto)}
              </p>
            </div>
          ))}
        </div>
      )

    case 'caminho':
      // Onde a ferramenta fica no menu. Quando há `href`, vira atalho para a tela de verdade.
      return (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/50">
          <span className="text-xs font-bold uppercase tracking-wide text-zinc-400">No menu</span>
          {bloco.itens.map((item, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />}
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{item}</span>
            </span>
          ))}
          {bloco.href && (
            <Link
              href={bloco.href}
              className="ml-auto inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Abrir a tela <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )

    case 'veja':
      return (
        <button
          type="button"
          onClick={() => onIrParaSecao(bloco.secaoId)}
          className="mb-5 inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 dark:border-zinc-700 dark:text-blue-400 dark:hover:bg-blue-500/10"
        >
          {bloco.texto || 'Ver também'} <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )
  }
}
