'use client'

import { useState, useMemo, useEffect } from 'react'
import { Users, Plus, UserCircle, Building2, Search, Filter, Layers, UserX, UserCheck, FileDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import Link from 'next/link'

interface Servidor {
  id: string
  nome: string
  matricula: string
  cargo: string
  vinculo: string
  unidade_id: string
  setor_id: string
  status: 'Ativo' | 'Inativo'
  cpf?: string
  unidades?: { nome: string }
  setores?: { nome: string }
}

interface Unidade {
  id: string
  nome: string
}

interface Setor {
  id: string
  nome: string
  unidade_id: string
}

interface ServidoresClientProps {
  initialServidores: Servidor[]
  unidades: Unidade[]
  setores: Setor[]
}

export function ServidoresClient({ initialServidores, unidades, setores }: ServidoresClientProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedUnidade, setSelectedUnidade] = useState('')
  const [selectedSetor, setSelectedSetor] = useState('')
  const [selectedVinculo, setSelectedVinculo] = useState('')
  const [selectedStatus, setSelectedStatus] = useState<string>('Ativo')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false)

  // Reset page and clear selections when filters change
  useEffect(() => {
    setPage(1)
    setSelectedIds(new Set())
  }, [searchTerm, selectedUnidade, selectedSetor, selectedVinculo, selectedStatus])

  // Filter sectors based on selected unit
  const filteredSetoresOptions = useMemo(() => {
    if (!selectedUnidade) return setores
    return setores.filter(s => s.unidade_id === selectedUnidade)
  }, [selectedUnidade, setores])

  // Main filtering logic
  const filteredServidores = useMemo(() => {
    const cleanSearch = searchTerm.toLowerCase().trim()
    const cleanSearchCpf = cleanSearch.replace(/[.\-/]/g, '')
    
    return initialServidores.filter(s => {
      const normNome = s.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      const normSearch = cleanSearch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const cleanCpf = s.cpf?.replace(/[.\-/]/g, '') || ''

      const matchesSearch = 
        normNome.includes(normSearch) || 
        s.matricula?.toLowerCase().includes(cleanSearch) ||
        s.cargo?.toLowerCase().includes(cleanSearch) ||
        cleanCpf.includes(cleanSearchCpf)
      
      const matchesUnidade = !selectedUnidade || s.unidade_id === selectedUnidade
      const matchesSetor = !selectedSetor || s.setor_id === selectedSetor
      const matchesVinculo = !selectedVinculo || s.vinculo === selectedVinculo
      const matchesStatus = !selectedStatus || s.status === selectedStatus

      return matchesSearch && matchesUnidade && matchesSetor && matchesVinculo && matchesStatus
    })
  }, [initialServidores, searchTerm, selectedUnidade, selectedSetor, selectedVinculo, selectedStatus])

  // Paginated servers local calculation
  const totalCount = filteredServidores.length
  const totalPages = Math.ceil(totalCount / pageSize)
  
  const paginatedServidores = useMemo(() => {
    const from = (page - 1) * pageSize
    const to = from + pageSize
    return filteredServidores.slice(from, to)
  }, [filteredServidores, page, pageSize])

  // Selection handlers for PDF
  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  const isAllSelected = paginatedServidores.length > 0 && paginatedServidores.every(s => selectedIds.has(s.id))

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      paginatedServidores.forEach(s => {
        if (checked) {
          next.add(s.id)
        } else {
          next.delete(s.id)
        }
      })
      return next
    })
  }

  // PDF Generator in A4 portrait (vertical) orientation
  const handleGeneratePDF = () => {
    setIsGeneratingPDF(true)
    try {
      const serversToPrint = selectedIds.size > 0 
        ? filteredServidores.filter(s => selectedIds.has(s.id))
        : filteredServidores

      if (serversToPrint.length === 0) {
        alert("Nenhum servidor selecionado ou na lista filtrada para gerar o PDF.")
        setIsGeneratingPDF(false)
        return
      }

      const reportTitle = "Relatório de Servidores"
      const generationDate = new Date().toLocaleString('pt-BR')
      
      const unidadeName = selectedUnidade 
        ? unidades.find(u => u.id === selectedUnidade)?.nome 
        : 'Todas'
      const vinculoName = selectedVinculo || 'Todos'
      const statusName = selectedStatus || 'Todos'
      const searchDescription = searchTerm ? `"${searchTerm}"` : 'Nenhum'

      const tableRows = serversToPrint.map((servidor) => `
        <tr class="border-b border-zinc-200">
          <td class="py-3 px-3 text-[10px] font-bold text-zinc-950 uppercase">
            ${servidor.nome}
            <div class="text-[8px] text-zinc-500 font-normal mt-0.5">Matrícula: ${servidor.matricula || '---'}</div>
          </td>
          <td class="py-3 px-3 text-[10px] text-zinc-800">${servidor.cargo || '---'}</td>
          <td class="py-3 px-3 text-[10px] text-zinc-800">${servidor.vinculo}</td>
          <td class="py-3 px-3 text-[10px] text-zinc-800">
            <div class="font-medium">${servidor.unidades?.nome || 'Sem Unidade'}</div>
            <div class="text-[8px] text-blue-600 font-bold mt-0.5">${servidor.setores?.nome || '---'}</div>
          </td>
          <td class="py-3 px-3 text-center">
            <span class="inline-block px-2 py-0.5 rounded text-[8px] font-bold ${
              servidor.status === 'Ativo' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-red-100 text-red-800 border border-red-200'
            }">
              ${servidor.status.toUpperCase()}
            </span>
          </td>
        </tr>
      `).join('')

      const reportHtml = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>${reportTitle}</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <style>
            @media print {
              .no-print { display: none !important; }
              body { background: white !important; padding: 0 !important; }
              .container { max-width: none !important; width: 100% !important; box-shadow: none !important; border: none !important; }
              @page {
                size: A4 portrait;
                margin: 1.5cm;
              }
            }
            body { font-family: 'Inter', sans-serif; background-color: #f4f4f5; }
            table { page-break-inside: auto; }
            tr { page-break-inside: avoid; page-break-after: auto; }
            thead { display: table-header-group; }
          </style>
        </head>
        <body class="p-8">
          <div class="max-w-4xl mx-auto bg-white shadow-2xl rounded-2xl overflow-hidden border border-zinc-200 container">
            <div class="bg-zinc-900 p-6 text-white flex justify-between items-center no-print">
              <div>
                <h1 class="text-xl font-black tracking-tight">SIS ESCALA</h1>
                <p class="text-zinc-400 text-xs uppercase font-bold tracking-widest">Relatório de Servidores</p>
              </div>
              <button onclick="window.print()" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg font-bold transition-all shadow-lg flex items-center gap-2 text-sm">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                Imprimir / Salvar PDF
              </button>
            </div>

            <div class="p-8">
              <div class="flex justify-between items-start border-b-2 border-zinc-900 pb-4 mb-6">
                <div>
                  <h2 class="text-2xl font-black text-zinc-900 uppercase tracking-tighter">${reportTitle}</h2>
                  <p class="text-zinc-500 text-xs font-medium">Quadro de Funcionários e Vínculos</p>
                </div>
                <div class="text-right">
                  <p class="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Emissão</p>
                  <p class="text-sm font-bold text-zinc-900">${generationDate}</p>
                </div>
              </div>

              <div class="grid grid-cols-4 gap-4 mb-6 bg-zinc-50 p-4 rounded-xl border border-zinc-100 text-xs">
                <div>
                  <p class="text-[9px] font-black text-zinc-400 uppercase">Unidade</p>
                  <p class="font-bold text-zinc-800">${unidadeName}</p>
                </div>
                <div>
                  <p class="text-[9px] font-black text-zinc-400 uppercase">Vínculo</p>
                  <p class="font-bold text-zinc-800">${vinculoName}</p>
                </div>
                <div>
                  <p class="text-[9px] font-black text-zinc-400 uppercase">Status</p>
                  <p class="font-bold text-zinc-800">${statusName}</p>
                </div>
                <div>
                  <p class="text-[9px] font-black text-zinc-400 uppercase">Busca</p>
                  <p class="font-bold text-zinc-800 truncate">${searchDescription}</p>
                </div>
              </div>

              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="bg-zinc-100 border-y-2 border-zinc-900">
                    <th class="py-2.5 px-3 text-[9px] font-black uppercase text-zinc-700">Servidor</th>
                    <th class="py-2.5 px-3 text-[9px] font-black uppercase text-zinc-700">Cargo</th>
                    <th class="py-2.5 px-3 text-[9px] font-black uppercase text-zinc-700">Vínculo</th>
                    <th class="py-2.5 px-3 text-[9px] font-black uppercase text-zinc-700">Unidade / Setor</th>
                    <th class="py-2.5 px-3 text-[9px] font-black uppercase text-zinc-700 text-center">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-zinc-200">
                  ${tableRows}
                </tbody>
              </table>

              <div class="mt-8 pt-4 border-t border-zinc-200 flex justify-between items-center text-[8px] text-zinc-400 uppercase font-bold tracking-widest">
                <span>SisEscala - Gestão Inteligente de Escalas</span>
                <span>Total de Servidores: ${serversToPrint.length}</span>
              </div>
            </div>
          </div>
          <div class="text-center mt-6 text-zinc-400 text-[10px] no-print">
            Este relatório foi gerado automaticamente para fins de consulta e gestão.
          </div>
        </body>
        </html>
      `

      const win = window.open('', '_blank')
      if (win) {
        win.document.write(reportHtml)
        win.document.close()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsGeneratingPDF(false)
    }
  }

  const vinculos = ['Contratada', 'Concursada', 'Efetiva', 'Comissionada']

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Servidores</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Gerencie o quadro de funcionários e seus vínculos.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleGeneratePDF}
            disabled={isGeneratingPDF}
            className="inline-flex items-center rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-900 dark:text-white shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-all disabled:opacity-50"
          >
            <FileDown className="mr-2 h-4 w-4" />
            {isGeneratingPDF ? 'Gerando...' : 'Gerar PDF'}
          </button>
          <Link
            href="/servidores/importar"
            className="inline-flex items-center rounded-lg bg-zinc-100 dark:bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-zinc-900 dark:text-white shadow-sm hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
          >
            Importar CSV
          </Link>
          <Link
            href="/servidores/novo"
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-all"
          >
            <Plus className="mr-2 h-4 w-4" />
            Novo Servidor
          </Link>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 bg-zinc-50 dark:bg-zinc-800/40 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Buscar por nome, matrícula, CPF..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <select
          value={selectedUnidade}
          onChange={(e) => {
            setSelectedUnidade(e.target.value)
            setSelectedSetor('') // Reset sector when unit changes
          }}
          className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">Todas as Unidades</option>
          {unidades.map(u => (
            <option key={u.id} value={u.id}>{u.nome}</option>
          ))}
        </select>

        <select
          value={selectedVinculo}
          onChange={(e) => setSelectedVinculo(e.target.value)}
          className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">Todos os Vínculos</option>
          {vinculos.map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="Ativo">Apenas Ativos</option>
          <option value="Inativo">Apenas Inativos</option>
          <option value="">Todos os Status</option>
        </select>

        <button 
          onClick={() => {
            setSearchTerm('')
            setSelectedUnidade('')
            setSelectedSetor('')
            setSelectedVinculo('')
            setSelectedStatus('Ativo')
            setSelectedIds(new Set())
          }}
          className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
        >
          Limpar Filtros
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 w-10">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500 bg-white dark:bg-zinc-950"
                  />
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Servidor</th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Matrícula</th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Cargo</th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Status</th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Vínculo</th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Unidade / Setor</th>
                <th className="relative px-6 py-4"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {paginatedServidores.map((servidor) => (
                <tr key={servidor.id} className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors group ${servidor.status === 'Inativo' ? 'opacity-60 grayscale-[0.5]' : ''}`}>
                  <td className="px-6 py-4 whitespace-nowrap w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(servidor.id)}
                      onChange={(e) => handleSelectRow(servidor.id, e.target.checked)}
                      className="rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500 bg-white dark:bg-zinc-955"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className={`h-9 w-9 flex-shrink-0 rounded-full flex items-center justify-center transition-colors ${
                        servidor.status === 'Inativo' 
                        ? 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800' 
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 group-hover:text-blue-600'
                      }`}>
                        <UserCircle className="h-7 w-7" />
                      </div>
                      <div className="ml-4">
                        <div className={`text-sm font-bold ${servidor.status === 'Inativo' ? 'text-zinc-500 line-through' : 'text-zinc-900 dark:text-white'}`}>
                          {servidor.nome}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-600 dark:text-zinc-400 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{servidor.matricula || '---'}</span>
                      {servidor.matricula && /^T\d{7}$/.test(servidor.matricula) && (
                        <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-900/30">
                          Temporária
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-600 dark:text-zinc-400">
                    {servidor.cargo || '---'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {servidor.status === 'Inativo' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-700 dark:bg-red-900/20 dark:text-red-400">
                        <UserX className="h-3 w-3" />
                        Inativo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                        <UserCheck className="h-3 w-3" />
                        Ativo
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`inline-flex rounded-md px-2.5 py-0.5 text-xs font-bold ${
                      servidor.vinculo === 'Efetiva' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800' : 
                      servidor.vinculo === 'Contratada' ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800' :
                      servidor.vinculo === 'Concursada' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800' :
                      'bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800'
                    }`}>
                      {servidor.vinculo}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-600 dark:text-zinc-400">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center">
                        <Building2 className="mr-2 h-3.5 w-3.5 opacity-50" />
                        {servidor.unidades?.nome || 'Sem Unidade'}
                      </div>
                      <div className="flex items-center font-semibold text-blue-600 dark:text-blue-400">
                        <Layers className="mr-2 h-3.5 w-3.5 opacity-50" />
                        {servidor.setores?.nome || '---'}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Link href={`/servidores/${servidor.id}`} className="inline-flex items-center text-blue-600 hover:text-blue-900 font-bold px-3 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all">
                      Gerenciar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filteredServidores.length === 0 && (
          <div className="flex flex-col items-center justify-center p-16 text-zinc-500 dark:text-zinc-400">
            <div className="h-16 w-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
              <Users className="h-8 w-8 opacity-20" />
            </div>
            <p className="font-medium">Nenhum servidor encontrado com estes filtros.</p>
            <button 
              onClick={() => {
                setSearchTerm('')
                setSelectedUnidade('')
                setSelectedSetor('')
                setSelectedVinculo('')
                setSelectedStatus('Ativo')
                setSelectedIds(new Set())
              }}
              className="mt-2 text-blue-600 hover:underline text-sm font-bold"
            >
              Limpar todos os filtros
            </button>
          </div>
        )}

        {/* Paginação */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6 bg-zinc-50/50 dark:bg-zinc-800/20 border-t border-zinc-100 dark:border-zinc-800/80 print:hidden select-none">
          <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
            Mostrando <span className="text-zinc-800 dark:text-zinc-200">{totalCount === 0 ? 0 : (page - 1) * pageSize + 1}</span> - <span className="text-zinc-800 dark:text-zinc-200">{Math.min(page * pageSize, totalCount)}</span> de <span className="text-zinc-800 dark:text-zinc-200">{totalCount}</span> registros
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Exibir</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
              }}
              className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-full px-3 py-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer shadow-sm hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
            >
              <option value={20}>20</option>
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
      </div>
    </div>
  )
}
