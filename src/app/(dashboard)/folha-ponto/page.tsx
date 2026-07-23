'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import { FileText, Loader2, Search, Building2, Layers, Calendar, ChevronRight, Play, RefreshCw, AlertCircle, Printer } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { applyAccessFilters } from '@/utils/permissions'
import { getServidoresFolhaPonto, gerarFolhaPonto, gerarFolhasEmLote, getFolhasPontoPrintData } from './actions'
import { Modal } from '@/components/ui/Modal'
import { formatSectorsHierarchy } from '@/utils/sectors'

export default function FolhaPontoPage() {
  const supabase = createClient()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [loadingServidores, setLoadingServidores] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Filters
  const [mes, setMes] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('folha_ponto_filtro_mes')
      if (saved) return parseInt(saved, 10)
    }
    return new Date().getMonth() + 1
  })
  const [ano, setAno] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('folha_ponto_filtro_ano')
      if (saved) return parseInt(saved, 10)
    }
    return new Date().getFullYear()
  })
  const [selectedUnidade, setSelectedUnidade] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('folha_ponto_filtro_unidade') || ''
    }
    return ''
  })
  const [selectedSetor, setSelectedSetor] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('folha_ponto_filtro_setor') || ''
    }
    return ''
  })
  const [searchTerm, setSearchTerm] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('folha_ponto_filtro_search') || ''
    }
    return ''
  })
  const [filterEscalaStatus, setFilterEscalaStatus] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('folha_ponto_filtro_escala_status') || 'todos'
    }
    return 'todos'
  })
  const [filterFolhaStatus, setFilterFolhaStatus] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('folha_ponto_filtro_folha_status') || 'todos'
    }
    return 'todos'
  })

  // Static Data
  const [unidades, setUnidades] = useState<any[]>([])
  const [setores, setSetores] = useState<any[]>([])
  const [profile, setProfile] = useState<any>(null)

  // Server timesheet data
  const [servidoresData, setServidoresData] = useState<any[]>([])
  const [selectedFolhas, setSelectedFolhas] = useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)

  // Save filters to sessionStorage whenever they change
  useEffect(() => {
    sessionStorage.setItem('folha_ponto_filtro_mes', String(mes))
    sessionStorage.setItem('folha_ponto_filtro_ano', String(ano))
    sessionStorage.setItem('folha_ponto_filtro_unidade', selectedUnidade)
    sessionStorage.setItem('folha_ponto_filtro_setor', selectedSetor)
    sessionStorage.setItem('folha_ponto_filtro_search', searchTerm)
    sessionStorage.setItem('folha_ponto_filtro_escala_status', filterEscalaStatus)
    sessionStorage.setItem('folha_ponto_filtro_folha_status', filterFolhaStatus)
  }, [mes, ano, selectedUnidade, selectedSetor, searchTerm, filterEscalaStatus, filterFolhaStatus])

  // Reset selected timesheets on filter changes
  useEffect(() => {
    setSelectedFolhas(new Set())
    setCurrentPage(1)
  }, [selectedUnidade, selectedSetor, mes, ano, searchTerm, filterEscalaStatus, filterFolhaStatus])

  // Helper for batch printing minutes formatting
  const formatMinutesToTimeStr = (totalMinutes: number): string => {
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  // Modal
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean, title: string, message: string, type: 'default' | 'danger' | 'success' | 'warning' }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'default'
  })

  // Load user profile & initial filters
  useEffect(() => {
    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
            .eq('id', user.id)
            .single()
          
          if (prof) {
            const userProfile = {
              ...prof,
              permitted_unidades: prof.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
              permitted_setores: prof.profile_setores?.map((ps: any) => ps.setor_id) || []
            }
            setProfile(userProfile)

            // Fetch units & sectors
            let unitsQuery = supabase.from('unidades').select('id, nome').order('nome')
            unitsQuery = applyAccessFilters(unitsQuery, userProfile, { unidadeField: 'id' })
            const { data: uData } = await unitsQuery
            setUnidades(uData || [])

            let sectorsQuery = supabase.from('setores').select('id, unidade_id, parent_id, dicionario_setores(nome)')
            sectorsQuery = applyAccessFilters(sectorsQuery, userProfile, { setorField: 'id' })
            const { data: sRaw } = await sectorsQuery
            
            const sData = sRaw?.map(s => {
              const dictData = Array.isArray(s.dicionario_setores) 
                ? s.dicionario_setores[0] 
                : s.dicionario_setores
              return {
                id: s.id,
                unidade_id: s.unidade_id,
                parent_id: s.parent_id,
                nome: dictData?.nome || 'SETOR SEM NOME'
              }
            }) || []
            setSetores(formatSectorsHierarchy(sData))

            // Restore from sessionStorage if exists, otherwise default empty
            const savedUnidade = sessionStorage.getItem('folha_ponto_filtro_unidade') || ''
            const savedSetor = sessionStorage.getItem('folha_ponto_filtro_setor') || ''
            setSelectedUnidade(savedUnidade)
            setSelectedSetor(savedSetor)
          }
        }
      } catch (err) {
        console.error('Erro ao inicializar página:', err)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  // Auto filter sectors based on unit choice
  const filteredSetores = setores.filter(s => s.unidade_id === selectedUnidade)

  // Fetch timesheet servers when unit/sector/date is selected (unit and sector are optional)
  const fetchServidores = useCallback(async () => {
    setLoadingServidores(true)
    const res = await getServidoresFolhaPonto(mes, ano, selectedUnidade || undefined, selectedSetor || undefined)
    setLoadingServidores(false)
    if (res.error) {
      setAlertModal({
        isOpen: true,
        title: 'Erro',
        message: res.error,
        type: 'danger'
      })
    } else if (res.servidores) {
      setServidoresData(res.servidores)
    }
  }, [mes, ano, selectedUnidade, selectedSetor])

  useEffect(() => {
    fetchServidores()
  }, [fetchServidores])

  // Reset selected sector if it does not belong to the newly selected unit
  const handleUnidadeChange = (unidadeId: string) => {
    setSelectedUnidade(unidadeId)
    setSelectedSetor('')
  }

  // Generate individual timesheet
  const handleGerarIndividual = async (servidorId: string, forcarRascunho: boolean) => {
    setActionLoading(`gerar-${servidorId}`)
    const res = await gerarFolhaPonto(servidorId, mes, ano, forcarRascunho)
    setActionLoading(null)
    if (res.error) {
      setAlertModal({
        isOpen: true,
        title: 'Erro na Geração',
        message: res.error,
        type: 'warning'
      })
    } else {
      setAlertModal({
        isOpen: true,
        title: 'Sucesso',
        message: 'Folha de ponto gerada com sucesso!',
        type: 'success'
      })
      fetchServidores()
    }
  }

  // Bulk generation
  const handleGerarEmLote = async (forcarRascunho: boolean) => {
    setActionLoading(forcarRascunho ? 'lote-rascunho' : 'lote-definitiva')
    const res = await gerarFolhasEmLote(
      mes,
      ano,
      selectedUnidade || undefined,
      selectedSetor || undefined,
      forcarRascunho
    )
    setActionLoading(null)
    if (res.error) {
      setAlertModal({
        isOpen: true,
        title: 'Erro',
        message: res.error,
        type: 'danger'
      })
    } else {
      setAlertModal({
        isOpen: true,
        title: 'Lote Concluído',
        message: res.message || 'Geração finalizada.',
        type: 'success'
      })
      fetchServidores()
    }
  }

  // Filter servers in memory
  const filteredServidores = servidoresData.filter(s => {
    const matchesSearch = s.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.matricula?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.cargo?.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesEscalaStatus = filterEscalaStatus === 'todos' || s.escala_status === filterEscalaStatus
    const matchesFolhaStatus = filterFolhaStatus === 'todos' || s.folha_status === filterFolhaStatus

    return matchesSearch && matchesEscalaStatus && matchesFolhaStatus
  })

  const itemsPerPage = 10
  const totalItems = filteredServidores.length
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const paginatedServidores = filteredServidores.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  const getPageNumbers = () => {
    const range = 2
    const pages: number[] = []
    for (let i = Math.max(1, currentPage - range); i <= Math.min(totalPages, currentPage + range); i++) {
      pages.push(i)
    }
    return pages
  }

  // Selection handlers (only affects selectable servers on the CURRENT page)
  const selectableServidores = paginatedServidores.filter(s => s.folha_id !== null)
  const allSelected = selectableServidores.length > 0 && selectableServidores.every(s => selectedFolhas.has(s.folha_id))
  
  const handleToggleAll = () => {
    const newSelected = new Set(selectedFolhas)
    if (allSelected) {
      selectableServidores.forEach(s => newSelected.delete(s.folha_id))
    } else {
      selectableServidores.forEach(s => newSelected.add(s.folha_id))
    }
    setSelectedFolhas(newSelected)
  }

  const handleImprimirSelecionadas = async () => {
    if (selectedFolhas.size === 0) return
    setActionLoading('imprimir-lote')
    try {
      const ids = Array.from(selectedFolhas)
      const res = await getFolhasPontoPrintData(ids)
      if (res.error || !res.folhas) {
        throw new Error(res.error || 'Erro ao carregar dados de impressão.')
      }

      const win = window.open('', '_blank')
      if (!win) {
        throw new Error('Bloqueador de pop-ups detectado. Por favor, permita pop-ups para este site para realizar a impressão.')
      }

      const folhasHTML = res.folhas.map((folha: any) => {
        const { servidores: servidor, registros: regs, escala } = folha
        const { unidades: unidade, setores: setor, jornadas: jornada } = escala

        const mesesNomes = [
          'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
          'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
        ]
        const mesExt = mesesNomes[folha.mes - 1]

        const parsedRegs = Array.isArray(regs) ? regs : []

        const tableRowsHTML = parsedRegs.map((r: any) => {
          const isWorkDay = !!r.turno_codigo
          const isOffDay = r.feriado || r.afastamento || !isWorkDay
          const isWeekend = r.dia_semana === 'Sáb' || r.dia_semana === 'Dom'
          
          return `
            <tr class="${isOffDay ? 'bg-zinc-50/50' : ''} ${isWeekend && !isOffDay ? 'bg-zinc-50/30' : ''}">
              <td class="px-3 py-1.5 border-r border-zinc-300 text-center font-black text-zinc-950">${String(r.dia).padStart(2, '0')}</td>
              <td class="px-2 py-1.5 border-r border-zinc-300 text-center font-bold text-zinc-500">${r.dia_semana || ''}</td>
              <td class="px-3 py-1.5 border-r border-zinc-300 text-center font-mono font-bold">${isWorkDay && !r.afastamento && !r.feriado ? (r.entrada || '') : '-'}</td>
              <td class="px-3 py-1.5 border-r border-zinc-300 text-center font-mono font-bold">${isWorkDay && r.saida_intervalo && !r.afastamento && !r.feriado ? (r.saida_intervalo || '') : '-'}</td>
              <td class="px-3 py-1.5 border-r border-zinc-300 text-center font-mono font-bold">${isWorkDay && r.retorno_intervalo && !r.afastamento && !r.feriado ? (r.retorno_intervalo || '') : '-'}</td>
              <td class="px-3 py-1.5 border-r border-zinc-300 text-center font-mono font-bold">${isWorkDay && !r.afastamento && !r.feriado ? (r.saida || '') : '-'}</td>
              <td class="px-3 py-1.5 border-r border-zinc-300 text-center font-mono font-bold text-blue-600">${isWorkDay && r.hora_extra_minutos && r.hora_extra_minutos > 0 ? formatMinutesToTimeStr(r.hora_extra_minutos) : '-'}</td>
              <td class="px-4 py-1.5 border-r border-zinc-300 font-medium">${r.observacao || ''}</td>
              <td class="px-2 py-1.5 text-center"></td>
            </tr>
          `
        }).join('')

        return `
          <div class="print-page bg-white p-8 max-w-5xl mx-auto my-8 border border-zinc-200 rounded-3xl shadow-lg">
            <!-- Document Header -->
            <div class="flex justify-between items-start border-b border-zinc-300 pb-4 mb-6">
              <div class="flex items-center gap-4">
                ${res.logoUrl ? `
                  <div class="h-14 w-28 border border-zinc-200 rounded-lg p-1 bg-white flex items-center justify-center">
                    <img src="${res.logoUrl}" alt="Logo" class="max-h-full max-w-full object-contain" />
                  </div>
                ` : ''}
                ${setor?.logo_url || unidade?.logo_url ? `
                  <div class="h-14 w-28 border border-zinc-200 rounded-lg p-1 bg-white flex items-center justify-center">
                    <img src="${setor?.logo_url || unidade?.logo_url}" alt="Logo" class="max-h-full max-w-full object-contain" />
                  </div>
                ` : ''}
                <div>
                  <h3 class="text-xl font-black text-zinc-900 uppercase tracking-tight">Folha de Ponto Mensal</h3>
                  <p class="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Espelho Oficial de Frequência Individual</p>
                </div>
              </div>
              <div class="text-right">
                <div class="text-[9px] font-black uppercase text-zinc-400">Competência</div>
                <div class="text-lg font-bold text-zinc-900 uppercase">${mesExt} / ${folha.ano}</div>
              </div>
            </div>

            <!-- Metadata -->
            <div class="grid grid-cols-4 gap-4 text-xs mb-6 bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
               <div>
                 <div class="text-[9px] font-black uppercase text-zinc-400 mb-0.5">Servidor</div>
                 <div class="font-bold text-zinc-900 uppercase">${servidor.nome}</div>
                 <div class="text-[10px] text-zinc-500 font-bold">Matrícula: ${servidor.matricula || '---'}</div>
               </div>
               <div>
                 <div class="text-[9px] font-black uppercase text-zinc-400 mb-0.5">Cargo / Vínculo</div>
                 <div class="font-bold text-zinc-900 uppercase">${servidor.cargo || '---'}</div>
                 <div class="text-[10px] text-zinc-500">${servidor.vinculo || '---'}</div>
               </div>
               <div>
                 <div class="text-[9px] font-black uppercase text-zinc-400 mb-0.5">Unidade</div>
                 <div class="font-bold text-zinc-900 uppercase">${unidade.nome}</div>
                 <div class="text-[10px] text-zinc-500 truncate">${unidade.endereco || '---'}</div>
               </div>
               <div>
                 <div class="text-[9px] font-black uppercase text-zinc-400 mb-0.5">Setor / Jornada</div>
                 <div class="font-bold text-zinc-900 uppercase">${setor?.nome}</div>
                 <div class="text-[10px] text-zinc-500">${jornada?.nome || 'Não Vinculada'}</div>
               </div>
            </div>

            <!-- Entries Table -->
            <table class="w-full text-[10px] text-left border-collapse border border-zinc-300">
               <thead>
                 <tr class="bg-zinc-100 text-zinc-600 font-black uppercase tracking-wider border-b border-zinc-300">
                   <th class="px-3 py-2 text-center w-12 border-r border-zinc-300">Dia</th>
                   <th class="px-2 py-2 text-center w-12 border-r border-zinc-300">Sem</th>
                   <th class="px-3 py-2 text-center w-24 border-r border-zinc-300">Entrada</th>
                   <th class="px-3 py-2 text-center w-24 border-r border-zinc-300">Saída Int.</th>
                   <th class="px-3 py-2 text-center w-24 border-r border-zinc-300">Retorno Int.</th>
                   <th class="px-3 py-2 text-center w-24 border-r border-zinc-300">Saída</th>
                   <th class="px-3 py-2 text-center w-20 border-r border-zinc-300">Extra</th>
                   <th class="px-4 py-2 border-r border-zinc-300">Observações / Justificativas</th>
                   <th class="px-3 py-2 text-center w-24">Visto</th>
                 </tr>
               </thead>
               <tbody class="divide-y divide-zinc-200">
                 ${tableRowsHTML}
               </tbody>
            </table>

            <!-- Summary / Totals -->
            <div class="mt-6">
               <div class="grid grid-cols-4 gap-4 text-center mb-8">
                 <div class="bg-white border border-zinc-300 p-3 rounded-xl">
                   <div class="text-[8px] font-black uppercase text-zinc-400 mb-0.5">Horas Normais</div>
                   <div class="text-lg font-black text-zinc-900">${folha.total_horas_normais || 0}h</div>
                 </div>
                 <div class="bg-white border border-zinc-300 p-3 rounded-xl">
                   <div class="text-[8px] font-black uppercase text-zinc-400 mb-0.5">Horas Extra (50%)</div>
                   <div class="text-lg font-black text-blue-600">${folha.total_horas_extras_50 || 0}h</div>
                 </div>
                 <div class="bg-white border border-zinc-300 p-3 rounded-xl">
                   <div class="text-[8px] font-black uppercase text-zinc-400 mb-0.5">Horas Extra (100%)</div>
                   <div class="text-lg font-black text-violet-600">${folha.total_horas_extras_100 || 0}h</div>
                 </div>
                 <div class="bg-white border border-zinc-300 p-3 rounded-xl">
                   <div class="text-[8px] font-black uppercase text-zinc-400 mb-0.5">Total Faltas</div>
                   <div class="text-lg font-black text-red-500">${folha.total_faltas || 0}</div>
                 </div>
               </div>

               <!-- Signatures -->
               <div class="grid grid-cols-2 gap-10 px-4 mt-8">
                 <div class="text-center">
                   <div class="w-full border-t border-zinc-400 pt-2">
                     <div class="text-[9px] font-black uppercase text-zinc-950">${servidor.nome}</div>
                     <div class="text-[7px] text-zinc-400 font-bold uppercase tracking-widest mt-0.5">Assinatura do Servidor</div>
                   </div>
                 </div>
                 <div class="text-center">
                   <div class="w-full border-t border-zinc-400 pt-2">
                     <div class="text-[9px] font-black uppercase text-zinc-950">Chefia Imediata / Coordenação</div>
                     <div class="text-[7px] text-zinc-400 font-bold uppercase tracking-widest mt-0.5">Carimbo e Assinatura</div>
                   </div>
                 </div>
               </div>

               <div class="text-right text-[6px] text-zinc-400 mt-8">
                 Documento emitido digitalmente via SisEscala. Data da emissão: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}.
               </div>
            </div>
          </div>
        `
      }).join('')

      const printHTML = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>Impressão de Folhas de Ponto em Lote</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <style>
            @media print {
              .no-print { display: none !important; }
              body { background: white !important; padding: 0 !important; }
              .print-page {
                page-break-after: always;
                page-break-inside: avoid;
                margin: 0 !important;
                border: none !important;
                box-shadow: none !important;
                padding: 1.5cm !important;
                width: 100% !important;
                max-width: none !important;
              }
              @page {
                size: A4 portrait;
                margin: 0;
              }
            }
            body { font-family: 'Inter', sans-serif; background-color: #f4f4f5; }
            table { page-break-inside: auto; }
            tr { page-break-inside: avoid; page-break-after: auto; }
            thead { display: table-header-group; }
          </style>
        </head>
        <body class="p-4 bg-zinc-100">
          <div class="max-w-5xl mx-auto mb-6 bg-zinc-900 p-4 text-white flex justify-between items-center no-print rounded-2xl shadow-lg">
            <div>
              <h1 class="text-lg font-black tracking-tight uppercase">SIS ESCALA</h1>
              <p class="text-zinc-400 text-[10px] uppercase font-bold tracking-widest">Impressão em Lote (${res.folhas.length} folhas)</p>
            </div>
            <button onclick="window.print()" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow-lg flex items-center gap-2 text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
              Imprimir Selecionadas
            </button>
          </div>
          
          ${folhasHTML}
        </body>
        </html>
      `

      win.document.write(printHTML)
      win.document.close()
    } catch (err: any) {
      console.error(err)
      setAlertModal({
        isOpen: true,
        title: 'Erro de Impressão',
        message: err.message || 'Houve um erro ao processar a impressão em lote.',
        type: 'danger'
      })
    } finally {
      setActionLoading(null)
    }
  }

  const meses = [
    { value: 1, label: 'Janeiro' },
    { value: 2, label: 'Fevereiro' },
    { value: 3, label: 'Março' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Maio' },
    { value: 6, label: 'Junho' },
    { value: 7, label: 'Julho' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Setembro' },
    { value: 10, label: 'Outubro' },
    { value: 11, label: 'Novembro' },
    { value: 12, label: 'Dezembro' }
  ]

  const anos = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i)

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-500/20 text-white">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Folha de Ponto</h1>
            <p className="mt-1 text-zinc-500 text-sm font-medium">Geração e fechamento de relatórios de horas mensais de servidores.</p>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-6">
          {/* Mês/Ano */}
          <div className="space-y-2">
            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5" /> Referência
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select 
                className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                value={mes}
                onChange={(e) => setMes(parseInt(e.target.value))}
              >
                {meses.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <select 
                className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                value={ano}
                onChange={(e) => setAno(parseInt(e.target.value))}
              >
                {anos.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Unidade */}
          <div className="space-y-2">
            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5" /> Unidade
            </label>
            <select 
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
              value={selectedUnidade}
              onChange={(e) => handleUnidadeChange(e.target.value)}
            >
              <option value="">Selecione a Unidade...</option>
              {unidades.map(u => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </div>

          {/* Setor */}
          <div className="space-y-2">
            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Layers className="h-3.5 w-3.5" /> Setor
            </label>
            <select 
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
              disabled={!selectedUnidade}
              value={selectedSetor}
              onChange={(e) => setSelectedSetor(e.target.value)}
            >
              <option value="">Selecione o Setor...</option>
              {filteredSetores.map(s => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
          </div>

          {/* Status Escala */}
          <div className="space-y-2">
            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5" /> Escala Mensal
            </label>
            <select 
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold font-medium"
              value={filterEscalaStatus}
              onChange={(e) => setFilterEscalaStatus(e.target.value)}
            >
              <option value="todos">Todas as Escalas</option>
              <option value="Rascunho">Rascunho</option>
              <option value="Em Andamento">Em Andamento</option>
              <option value="Fechada">Fechada</option>
            </select>
          </div>

          {/* Status Folha */}
          <div className="space-y-2">
            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <FileText className="h-3.5 w-3.5" /> Status Folha
            </label>
            <select 
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold font-medium"
              value={filterFolhaStatus}
              onChange={(e) => setFilterFolhaStatus(e.target.value)}
            >
              <option value="todos">Todos os Status</option>
              <option value="Não Gerada">Não Gerada</option>
              <option value="Rascunho">Rascunho</option>
              <option value="Gerada">Gerada</option>
              <option value="Revisada">Definitiva</option>
            </select>
          </div>

          {/* Busca de Servidores */}
          <div className="space-y-2">
            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Search className="h-3.5 w-3.5" /> Filtrar Servidor
            </label>
            <input 
              type="text" 
              placeholder="Nome ou matrícula..."
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Global Batch Actions */}
        {servidoresData.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-t border-zinc-100 dark:border-zinc-800 pt-6 gap-4">
            <div className="flex items-center gap-2 text-xs font-bold text-zinc-500">
              <AlertCircle className="h-4 w-4 text-blue-500" />
              <span>Geração em lote afeta apenas os servidores com escalas configuradas no período.</span>
            </div>
            
            <div className="flex flex-wrap gap-3">
              <button 
                onClick={handleImprimirSelecionadas}
                disabled={selectedFolhas.size === 0 || actionLoading !== null}
                className="inline-flex items-center bg-zinc-800 hover:bg-zinc-900 text-white font-black text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50"
              >
                {actionLoading === 'imprimir-lote' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Printer className="h-4 w-4 mr-2" />}
                Imprimir Selecionadas (${selectedFolhas.size})
              </button>
              <button 
                onClick={() => handleGerarEmLote(true)}
                disabled={actionLoading !== null}
                className="inline-flex items-center bg-amber-500 hover:bg-amber-600 text-white font-black text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50"
              >
                {actionLoading === 'lote-rascunho' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                Gerar Rascunhos
              </button>
              <button 
                onClick={() => handleGerarEmLote(false)}
                disabled={actionLoading !== null}
                className="inline-flex items-center bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-md shadow-blue-500/20 active:scale-95 disabled:opacity-50"
              >
                {actionLoading === 'lote-definitiva' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                Gerar Todas (Definitivas)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main List Table */}
      <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
        {loadingServidores ? (
          <div className="p-20 text-center">
            <Loader2 className="h-10 w-10 animate-spin mx-auto text-blue-500 opacity-50 mb-4" />
            <p className="text-zinc-500 text-sm font-bold uppercase tracking-widest">Carregando servidores...</p>
          </div>
        ) : filteredServidores.length === 0 ? (
          <div className="p-20 text-center text-zinc-500">
            <Search className="mx-auto h-16 w-16 opacity-10 mb-6" />
            <p className="text-xl font-black uppercase tracking-tight">Nenhum servidor encontrado</p>
            <p className="text-sm mt-2">Nenhum servidor lotado ativo ou compatível com a busca foi retornado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
                  <th className="px-6 py-4 w-12 select-none">
                    <input 
                      type="checkbox"
                      checked={allSelected}
                      onChange={handleToggleAll}
                      className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
                    />
                  </th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Servidor</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Jornada Lotação</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Escala Mensal</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Status Folha</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 text-center">Horas Normais</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 text-center">Extras (50% / 100%)</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 text-center">Faltas</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 text-center w-36">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {paginatedServidores.map(s => {
                  const hasScale = s.escala_mensal_id !== null
                  const hasFolha = s.folha_id !== null

                  return (
                    <tr 
                      key={s.servidor_id} 
                      onClick={() => {
                        if (hasFolha) {
                          router.push(`/folha-ponto/${s.folha_id}`)
                        }
                      }}
                      className={`group transition-colors ${
                        hasFolha 
                          ? 'cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-900/10' 
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
                      }`}
                    >
                      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                        {hasFolha ? (
                          <input 
                            type="checkbox"
                            checked={selectedFolhas.has(s.folha_id)}
                            onChange={() => {
                              setSelectedFolhas(prev => {
                                const next = new Set(prev)
                                if (next.has(s.folha_id)) {
                                  next.delete(s.folha_id)
                                } else {
                                  next.add(s.folha_id)
                                }
                                return next
                              })
                            }}
                            className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
                          />
                        ) : (
                          <input 
                            type="checkbox"
                            disabled
                            className="rounded border-zinc-200 text-zinc-300 h-4 w-4 cursor-not-allowed opacity-30"
                          />
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className={`font-black text-zinc-900 dark:text-white uppercase tracking-tighter text-sm transition-colors ${
                          hasFolha ? 'group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:underline' : ''
                        }`}>
                          {s.nome}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-tight mt-0.5">
                          Matrícula: {s.matricula} • {s.cargo || 'CARGO NÃO INFORMADO'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-bold text-zinc-600 dark:text-zinc-400 text-sm">
                          {s.jornada_nome}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                          s.escala_status === 'Fechada' 
                            ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-850 dark:text-zinc-400' 
                            : s.escala_status === 'Em Andamento'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                        }`}>
                          {s.escala_status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                          s.folha_status === 'Gerada' 
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' 
                            : s.folha_status === 'Rascunho'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                            : s.folha_status === 'Revisada'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                            : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'
                        }`}>
                          {s.folha_status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="font-bold text-zinc-700 dark:text-zinc-300">
                          {hasFolha ? `${s.total_horas_normais}h` : '---'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="font-bold text-zinc-700 dark:text-zinc-300">
                          {hasFolha ? `${s.total_horas_extras_50}h / ${s.total_horas_extras_100}h` : '---'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`font-bold ${hasFolha && s.total_faltas > 0 ? 'text-red-500' : 'text-zinc-500'}`}>
                          {hasFolha ? s.total_faltas : '---'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-2">
                          {hasFolha ? (
                            <Link 
                              href={`/folha-ponto/${s.folha_id}`}
                              className="inline-flex items-center text-xs font-black uppercase bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-white px-4 py-2 rounded-xl transition-all"
                            >
                              Editar <ChevronRight className="ml-1 h-3.5 w-3.5" />
                            </Link>
                          ) : !hasScale ? (
                            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wide">Sem Escala</span>
                          ) : (
                            <div className="flex gap-1.5">
                              {s.escala_status === 'Em Andamento' ? (
                                <button 
                                  onClick={() => handleGerarIndividual(s.servidor_id, true)}
                                  disabled={actionLoading === `gerar-${s.servidor_id}`}
                                  className="inline-flex items-center text-[10px] font-black uppercase bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50"
                                >
                                  {actionLoading === `gerar-${s.servidor_id}` ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    'Rascunho'
                                  )}
                                </button>
                              ) : (
                                <button 
                                  onClick={() => handleGerarIndividual(s.servidor_id, false)}
                                  disabled={actionLoading === `gerar-${s.servidor_id}`}
                                  className="inline-flex items-center text-[10px] font-black uppercase bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-xl transition-all shadow-md shadow-blue-500/20 active:scale-95 disabled:opacity-50"
                                >
                                  {actionLoading === `gerar-${s.servidor_id}` ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    'Gerar'
                                  )}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        
        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between border-t border-zinc-200 dark:border-zinc-800 px-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/50 gap-4">
            <div className="text-xs font-black uppercase tracking-wider text-zinc-400">
              Mostrando <span className="font-extrabold text-zinc-900 dark:text-white">{(currentPage - 1) * itemsPerPage + 1}</span> a <span className="font-extrabold text-zinc-900 dark:text-white">{Math.min(totalItems, currentPage * itemsPerPage)}</span> de <span className="font-extrabold text-zinc-900 dark:text-white">{totalItems}</span> servidores
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold text-xs uppercase tracking-wider transition-all hover:bg-zinc-50 dark:hover:bg-zinc-700/50 disabled:opacity-50 active:scale-95"
              >
                Anterior
              </button>
              <div className="flex items-center gap-1">
                {getPageNumbers().map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 rounded-xl font-black text-xs transition-all active:scale-95 ${
                      currentPage === page
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                        : 'border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold text-xs uppercase tracking-wider transition-all hover:bg-zinc-50 dark:hover:bg-zinc-700/50 disabled:opacity-50 active:scale-95"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal alert */}
      <Modal
        isOpen={alertModal.isOpen}
        onClose={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
        title={alertModal.title}
        type={alertModal.type as any}
        footer={
          <button
            onClick={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
            className="w-full px-4 py-2 rounded-xl bg-zinc-900 dark:bg-white dark:text-zinc-900 text-white font-black uppercase tracking-widest text-[10px]"
          >
            Entendido
          </button>
        }
      >
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{alertModal.message}</p>
      </Modal>
    </div>
  )
}
