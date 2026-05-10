'use client'

import { useState, useEffect } from 'react'
import { Search, Calendar, Building2, LayoutGrid } from 'lucide-react'

interface FiltersProps {
  onFilterChange: (filters: any) => void
  unidades: any[]
  setores: any[]
  initialFilters?: any
}

export function ReportFilters({ onFilterChange, unidades, setores, initialFilters }: FiltersProps) {
  const [mes, setMes] = useState(initialFilters?.mes || new Date().getMonth() + 1)
  const [ano, setAno] = useState(initialFilters?.ano || new Date().getFullYear())
  const [unidadeId, setUnidadeId] = useState(initialFilters?.unidadeId || '')
  const [setorId, setSetorId] = useState(initialFilters?.setorId || '')

  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ]

  const anos = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i)

  useEffect(() => {
    onFilterChange({ mes, ano, unidadeId, setorId })
  }, [mes, ano, unidadeId, setorId])

  const filteredSetores = setores.filter(s => !unidadeId || s.unidade_id === unidadeId)

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl shadow-sm space-y-4 md:space-y-0 md:flex md:items-center md:gap-4">
      <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Mês */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Mês</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <select
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all appearance-none"
            >
              {meses.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Ano */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Ano</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <select
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
              className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all appearance-none"
            >
              {anos.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Unidade */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Unidade</label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <select
              value={unidadeId}
              onChange={(e) => {
                setUnidadeId(e.target.value)
                setSetorId('') // Reset setor when unidade changes
              }}
              className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all appearance-none"
            >
              <option value="">Todas as Unidades</option>
              {unidades.map(u => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Setor */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Setor</label>
          <div className="relative">
            <LayoutGrid className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <select
              value={setorId}
              onChange={(e) => setSetorId(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all appearance-none"
            >
              <option value="">Todos os Setores</option>
              {filteredSetores.map(s => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
