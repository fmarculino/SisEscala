'use client'

import { Printer, FileSpreadsheet } from 'lucide-react'

interface Props {
  onExport?: () => void
  showExport?: boolean
}

export function ReportActions({ onExport, showExport = true }: Props) {
  return (
    <div className="flex items-center gap-2">
      {showExport && (
        <button 
          onClick={onExport}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-bold uppercase tracking-wider text-zinc-600 hover:border-indigo-500 transition-all print:hidden"
        >
          <FileSpreadsheet className="h-4 w-4" /> Exportar CSV
        </button>
      )}
      <button 
        onClick={() => window.print()}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-indigo-700 shadow-lg shadow-indigo-600/20 transition-all print:hidden"
      >
        <Printer className="h-4 w-4" /> Imprimir
      </button>
    </div>
  )
}
