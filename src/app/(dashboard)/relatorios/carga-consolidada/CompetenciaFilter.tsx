'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Calendar } from 'lucide-react'

/**
 * Filtro de competência do relatório de Carga Consolidada.
 *
 * ⚠️ Não tem filtro de unidade nem de setor, e isso é o ponto do relatório: a pergunta é "quanto
 * esta PESSOA tem no mês", e a resposta cruza setores e unidades por definição. Filtrar por
 * unidade devolveria de novo a conta parcial que o relatório existe para corrigir.
 */
export function CompetenciaFilter({ mes, ano }: { mes: number; ano: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ]
  const anos = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i)

  const trocar = (chave: string, valor: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set(chave, valor)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl shadow-sm flex flex-wrap items-end gap-4 print:hidden">
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Mês</label>
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <select
            value={mes}
            onChange={(e) => trocar('mes', e.target.value)}
            className="pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
          >
            {meses.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Ano</label>
        <select
          value={ano}
          onChange={(e) => trocar('ano', e.target.value)}
          className="px-4 py-2 bg-zinc-50 dark:bg-zinc-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
        >
          {anos.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
