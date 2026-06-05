'use client'

import { useState, useEffect } from 'react'
import { Printer, FileSpreadsheet } from 'lucide-react'
import { getReportBaseHtml, templates, ReportConfig } from '@/utils/report-templates'
import { createClient } from '@/utils/supabase/client'

interface Props {
  onExport?: () => void
  showExport?: boolean
  reportData?: any
  reportType?: 'consolidado' | 'frequencia' | 'rh' | 'distribuicao'
  filters?: Record<string, string | number | undefined>
  title?: string
}

export function ReportActions({ onExport, showExport = true, reportData, reportType, filters, title }: Props) {
  const [headerLogoUrl, setHeaderLogoUrl] = useState<string>('')
  const supabase = createClient()

  useEffect(() => {
    async function fetchHeaderLogo() {
      const { data } = await supabase
        .from('configuracoes_globais')
        .select('valor')
        .eq('chave', 'instituicao_cabecalho_url')
        .single()
      if (data?.valor) {
        setHeaderLogoUrl(data.valor)
      }
    }
    fetchHeaderLogo()
  }, [])

  const handlePrint = () => {
    if (!reportType || !reportData) {
      window.print();
      return;
    }

    const config: ReportConfig = {
      title: title || 'Relatório SisEscala',
      filters: filters || {},
      generationDate: new Date().toLocaleString('pt-BR'),
      instituicaoCabecalhoUrl: headerLogoUrl || undefined,
    };

    let content = '';
    if (reportType === 'consolidado') content = templates.consolidado(reportData);
    if (reportType === 'rh') content = templates.rh(reportData);
    if (reportType === 'frequencia') content = templates.frequencia(reportData, config);
    if (reportType === 'distribuicao') content = templates.distribuicao(reportData);

    const html = getReportBaseHtml(config, content);
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

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
        onClick={handlePrint}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-indigo-700 shadow-lg shadow-indigo-600/20 transition-all print:hidden"
      >
        <Printer className="h-4 w-4" /> Imprimir
      </button>
    </div>
  )
}
