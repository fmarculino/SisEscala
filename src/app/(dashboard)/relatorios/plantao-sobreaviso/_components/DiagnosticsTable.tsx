'use client'

import { useState, useMemo } from 'react'
import { AlertTriangle, ShieldCheck, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileSpreadsheet } from 'lucide-react'

interface ServerDiagnostic {
  servidorId: string
  nome: string
  matricula: string
  cargo: string
  vinculo: string
  unidade: string
  setor: string
  plantaoHours: number
  sobreavisoScheduledHours: number
  sobreavisoActivatedHours: number
  activationRate: number
  totalEffectiveHours: number
  fatigueAlertsCount: number
  alertMessages: string[]
}

interface TableProps {
  data: ServerDiagnostic[]
}

export function DiagnosticsTable({ data }: TableProps) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)

  // Sort and pagination
  const totalCount = data.length
  const totalPages = Math.ceil(totalCount / pageSize)

  const paginatedData = useMemo(() => {
    const from = (page - 1) * pageSize
    const to = from + pageSize
    return data.slice(from, to)
  }, [data, page, pageSize])

  const getFatigueRisk = (item: ServerDiagnostic) => {
    if (item.totalEffectiveHours > 160 || item.fatigueAlertsCount >= 4) {
      return { label: 'Crítico', color: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/20 dark:text-rose-450 dark:border-rose-900/30' }
    }
    if (item.totalEffectiveHours > 80 || item.fatigueAlertsCount > 0) {
      return { label: 'Médio', color: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/20 dark:text-amber-450 dark:border-amber-900/30' }
    }
    return { label: 'Baixo', color: 'bg-emerald-105 text-emerald-800 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-450 dark:border-emerald-900/30' }
  }

  // Export CSV function
  const handleExportCSV = () => {
    if (data.length === 0) return

    const headers = [
      'Servidor', 'Matrícula', 'Cargo', 'Vínculo', 'Unidade', 'Setor', 
      'Horas Plantão', 'Sobreaviso Escalado (h)', 'Sobreaviso Acionado (h)', 
      'Taxa de Acionamento (%)', 'Horas Efetivas Totais', 'Alertas de Fadiga'
    ]

    const rows = data.map(item => [
      `"${item.nome}"`,
      `"${item.matricula || ''}"`,
      `"${item.cargo}"`,
      `"${item.vinculo}"`,
      `"${item.unidade}"`,
      `"${item.setor}"`,
      item.plantaoHours,
      item.sobreavisoScheduledHours,
      item.sobreavisoActivatedHours,
      `${item.activationRate.toFixed(1)}%`,
      item.totalEffectiveHours,
      item.fatigueAlertsCount
    ])

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `diagnostico_escalas_${new Date().toISOString().substring(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-xl overflow-hidden space-y-4">
      {/* Header action */}
      <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-black text-zinc-900 dark:text-white uppercase text-sm tracking-widest">Detalhamento por Servidor</h3>
          <p className="text-zinc-500 text-xs mt-0.5">Analise de fadiga, acionamentos e conformidade operacional.</p>
        </div>
        <button
          onClick={handleExportCSV}
          disabled={data.length === 0}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-zinc-850 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-500 rounded-xl text-xs font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400 transition-all cursor-pointer disabled:opacity-50"
        >
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Exportar CSV da Análise
        </button>
      </div>

      {/* Table grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
              <th className="px-6 py-4 font-black uppercase tracking-widest text-zinc-500">Servidor</th>
              <th className="px-6 py-4 font-black uppercase tracking-widest text-zinc-500">Unidade/Setor</th>
              <th className="px-6 py-4 font-black uppercase tracking-widest text-zinc-500 text-center">Plantões (h)</th>
              <th className="px-6 py-4 font-black uppercase tracking-widest text-zinc-500 text-center">Sobreaviso (Escalado/Acionado)</th>
              <th className="px-6 py-4 font-black uppercase tracking-widest text-zinc-500 text-center">Taxa Acionamento</th>
              <th className="px-6 py-4 font-black uppercase tracking-widest text-zinc-500 text-center">Horas Efetivas</th>
              <th className="px-6 py-4 font-black uppercase tracking-widest text-zinc-500 text-center">Risco de Fadiga</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {paginatedData.map((item) => {
              const risk = getFatigueRisk(item)
              return (
                <tr key={item.servidorId} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-bold text-zinc-900 dark:text-white uppercase text-[11px]">{item.nome}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">Mat: {item.matricula || '---'} • {item.cargo}</div>
                    <div className="mt-1 text-[9px] inline-block px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-600 dark:text-zinc-400 uppercase font-bold">{item.vinculo}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-zinc-700 dark:text-zinc-300 font-medium">{item.unidade}</div>
                    <div className="text-[10px] text-zinc-500">{item.setor}</div>
                  </td>
                  <td className="px-6 py-4 text-center font-bold text-zinc-700 dark:text-zinc-300">{item.plantaoHours}h</td>
                  <td className="px-6 py-4 text-center text-zinc-700 dark:text-zinc-300">
                    <span className="font-bold">{item.sobreavisoScheduledHours}h</span>
                    <span className="text-zinc-400 text-[10px] mx-1">/</span>
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">{item.sobreavisoActivatedHours}h</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className={`inline-block px-2 py-0.5 rounded-full font-black text-[10px] ${
                      item.activationRate > 30 ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400' : 'text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800'
                    }`}>
                      {item.activationRate.toFixed(1)}%
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center font-black text-indigo-600 dark:text-indigo-400 text-sm">
                    {item.totalEffectiveHours}h
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className={`inline-block px-2.5 py-1 text-[9px] font-black uppercase rounded-full border ${risk.color}`}>
                        {risk.label}
                      </span>
                      {item.fatigueAlertsCount > 0 && (
                        <div 
                          className="flex items-center gap-1 text-[9px] text-rose-500 font-bold"
                          title={item.alertMessages.join('\n')}
                        >
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          <span>{item.fatigueAlertsCount} Alerta(s)</span>
                        </div>
                      )}
                      {item.fatigueAlertsCount === 0 && (
                        <div className="flex items-center gap-0.5 text-[9px] text-emerald-500 font-bold">
                          <ShieldCheck className="h-3 w-3 text-emerald-500" /> Regular
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-20 text-center text-zinc-400 font-bold uppercase tracking-widest opacity-40">
                  Nenhum registro encontrado para os filtros selecionados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {data.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6 bg-zinc-50/50 dark:bg-zinc-800/20 border-t border-zinc-100 dark:border-zinc-800/80 print:hidden select-none">
          <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
            Mostrando <span className="text-zinc-800 dark:text-zinc-200">{totalCount === 0 ? 0 : (page - 1) * pageSize + 1}</span> - <span className="text-zinc-800 dark:text-zinc-200">{Math.min(page * pageSize, totalCount)}</span> de <span className="text-zinc-800 dark:text-zinc-200">{totalCount}</span> servidores analisados
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Exibir</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
              }}
              className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-full px-3 py-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer shadow-sm"
            >
              <option value={15}>15</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button 
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-full hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-zinc-900 transition-all shadow-sm"
              title="Primeira página"
            >
              <ChevronsLeft className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
            </button>
            <button 
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-full hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-zinc-900 transition-all shadow-sm"
              title="Página anterior"
            >
              <ChevronLeft className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
            </button>
            
            <div className="bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700 rounded-full px-4 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 min-w-[70px] text-center shadow-sm">
              {page} <span className="text-zinc-400 dark:text-zinc-500 text-[10px] font-normal mx-1">DE</span> {totalPages || 1}
            </div>

            <button 
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || totalPages === 0}
              className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-full hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-zinc-900 transition-all shadow-sm"
              title="Próxima página"
            >
              <ChevronRight className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
            </button>
            <button 
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages || totalPages === 0}
              className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-full hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-zinc-900 transition-all shadow-sm"
              title="Última página"
            >
              <ChevronsRight className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
