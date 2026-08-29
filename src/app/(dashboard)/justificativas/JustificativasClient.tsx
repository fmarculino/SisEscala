'use client'

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { createClient } from '@/utils/supabase/client'
import { 
  ClipboardCheck, Search, Filter, Loader2, Calendar, Building2, Layers, 
  CheckCircle2, Clock, AlertCircle, FileText, Plus, Edit3, Trash2, CheckSquare, 
  Square, ChevronLeft, ChevronRight, MessageSquare, ShieldCheck, Sparkles, UserCheck, XCircle, Printer, Check
} from 'lucide-react'
import { 
  getEventosPendentes, salvarJustificativa, salvarJustificativasBulk, 
  validarSugestao, getTemplatesPadrao, salvarTemplatePadrao, toggleTemplatePadrao 
} from './actions'
import { JustificativaModal } from '@/components/justificativas/JustificativaModal'
import { JustificativaBulkModal } from '@/components/justificativas/JustificativaBulkModal'
import { TemplatePadraoModal } from '@/components/justificativas/TemplatePadraoModal'
import { ValidarSugestaoModal } from '@/components/justificativas/ValidarSugestaoModal'
import { AssinaturaDigitalModal } from '@/components/justificativas/AssinaturaDigitalModal'
import { RelatorioEventoPrintView } from '@/components/reports/RelatorioEventoPrintView'
import { formatSectorsHierarchy } from '@/utils/sectors'
import { formatarHora } from '@/utils/horario'
import { PAPEIS_REVERTEM_DESFECHO, type Desfecho } from '@/utils/gestaoJustificativas'
import { rotularInativo } from '@/utils/opcoesAtivas'

interface JustificativasClientProps {
  unidades: any[]
  setores: any[]
  servidores?: any[]
  userProfile: any
}

export function JustificativasClient({
  unidades,
  setores,
  servidores = [],
  userProfile
}: JustificativasClientProps) {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'fila' | 'sugestoes' | 'templates' | 'relatorios'>('fila')

  // Filters with sessionStorage persistence
  const [selectedUnidade, setSelectedUnidade] = useState(() => {
    if (typeof window !== 'undefined') {
      // `?? ` e não `|| `: string vazia agora é uma escolha legítima ("Todas as Unidades"), e
      // com `||` ela caía de volta para a primeira unidade a cada recarga — a opção existiria
      // na tela e não sobreviveria a um F5.
      const salvo = sessionStorage.getItem('justificativa_filtro_unidade')
      if (salvo !== null) return salvo
    }
    return unidades[0]?.id || ''
  })
  const [selectedSetor, setSelectedSetor] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('justificativa_filtro_setor') || ''
    }
    return ''
  })
  const [selectedServidor, setSelectedServidor] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('justificativa_filtro_servidor') || ''
    }
    return ''
  })
  const [servidorSearchText, setServidorSearchText] = useState('')
  const [isServidorDropdownOpen, setIsServidorDropdownOpen] = useState(false)
  const servidorDropdownRef = useRef<HTMLDivElement>(null)

  // Click-outside listener for Servidor Combobox
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (servidorDropdownRef.current && !servidorDropdownRef.current.contains(event.target as Node)) {
        setIsServidorDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  const [mes, setMes] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('justificativa_filtro_mes')
      if (saved) return parseInt(saved, 10)
    }
    return new Date().getMonth() + 1
  })
  const [ano, setAno] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('justificativa_filtro_ano')
      if (saved) return parseInt(saved, 10)
    }
    return new Date().getFullYear()
  })
  const [filterCategoria, setFilterCategoria] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('justificativa_filtro_categoria') || 'todos'
    }
    return 'todos'
  })
  const [filterStatus, setFilterStatus] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('justificativa_filtro_status') || 'todos'
    }
    return 'todos'
  })
  const [currentPage, setCurrentPage] = useState(1)

  // Save filters to sessionStorage
  useEffect(() => {
    sessionStorage.setItem('justificativa_filtro_unidade', selectedUnidade)
    sessionStorage.setItem('justificativa_filtro_setor', selectedSetor)
    sessionStorage.setItem('justificativa_filtro_servidor', selectedServidor)
    sessionStorage.setItem('justificativa_filtro_mes', String(mes))
    sessionStorage.setItem('justificativa_filtro_ano', String(ano))
    sessionStorage.setItem('justificativa_filtro_categoria', filterCategoria)
    sessionStorage.setItem('justificativa_filtro_status', filterStatus)
  }, [selectedUnidade, selectedSetor, selectedServidor, mes, ano, filterCategoria, filterStatus])

  // Data states
  const [eventosData, setEventosData] = useState<{
    total: number
    justificados: number
    pendentes: number
    /** Sobreaviso cumprido que ninguém justificou. Não é cobrança — é o grupo do lote. */
    cumpridos_sem_justificativa?: number
    /** Nada pendente de ação: justificado OU cumprido. É o que a barra de progresso mede. */
    resolvidos?: number
    /** Quantos casam com o filtro de Status. `total` é o mês inteiro; este é o recorte. */
    filtrados?: number
    sugestoes: number
    em_avaliacao?: number
    faltas?: number
    items: any[]
  }>({
    total: 0, justificados: 0, pendentes: 0, cumpridos_sem_justificativa: 0,
    resolvidos: 0, sugestoes: 0, em_avaliacao: 0, faltas: 0, items: []
  })

  /** Erro da última carga da fila. `null` = carregou. Ver o tratamento em `fetchEventos`. */
  const [erroCarga, setErroCarga] = useState<string | null>(null)

  const [templates, setTemplates] = useState<any[]>([])
  const [selectedEventoIds, setSelectedEventoIds] = useState<Set<string>>(new Set())

  // Modal States
  const [singleModalEvento, setSingleModalEvento] = useState<any | null>(null)
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false)
  const [templateModalData, setTemplateModalData] = useState<{ isOpen: boolean; template: any | null }>({ isOpen: false, template: null })
  const [validarSugestaoData, setValidarSugestaoData] = useState<any | null>(null)
  const [isA1ModalOpen, setIsA1ModalOpen] = useState(false)

  // Print view state
  const [printReport, setPrintReport] = useState<{
    isOpen: boolean
    servidorId?: string
    modoAssinatura: 'manual' | 'a1' | 'govbr' | 'mista'
    tipo: 'individual' | 'mensal'
  } | null>(null)

  // Filter sectors and servers for selected unit/sector/search
  const filteredSetores = useMemo(() => {
    const unformatted = setores.filter(s => !selectedUnidade || s.unidade_id === selectedUnidade)
    return formatSectorsHierarchy(unformatted)
  }, [setores, selectedUnidade])
  
  const filteredServidores = useMemo(() => {
    return (servidores || []).filter(s => {
      if (selectedUnidade && s.unidade_id !== selectedUnidade) return false
      if (selectedSetor && s.setor_id !== selectedSetor) return false
      if (servidorSearchText.trim()) {
        const term = servidorSearchText.toLowerCase().trim()
        const matchesNome = s.nome?.toLowerCase().includes(term)
        const matchesMatricula = s.matricula?.toLowerCase().includes(term)
        return matchesNome || matchesMatricula
      }
      return true
    })
  }, [servidores, selectedUnidade, selectedSetor, servidorSearchText])

  // Load events via Server Action
  const fetchEventos = useCallback(async () => {
    // Sem unidade escolhida a busca ACONTECE — é o modo "Todas as Unidades". O `return` que
    // existia aqui era metade do motivo de a visão global não existir.
    setLoading(true)
    const res = await getEventosPendentes({
      unidadeId: selectedUnidade || undefined,
      setorId: selectedSetor || undefined,
      servidorId: selectedServidor || undefined,
      mes,
      ano,
      categoria: filterCategoria,
      status: filterStatus,
      page: currentPage,
      perPage: 20
    })

    if (res.data) {
      setErroCarga(null)
      setEventosData({
        total: res.data.total || 0,
        justificados: res.data.justificados || 0,
        pendentes: res.data.pendentes || 0,
        cumpridos_sem_justificativa: res.data.cumpridos_sem_justificativa || 0,
        resolvidos: res.data.resolvidos || 0,
        filtrados: res.data.filtrados ?? (res.data.items || []).length,
        sugestoes: res.data.sugestoes || 0,
        em_avaliacao: res.data.em_avaliacao || 0,
        faltas: res.data.faltas || 0,
        items: res.data.items || []
      })
    } else if (res.error) {
      // 🚨 ISTO ERA SÓ UM console.error — a falha não chegava a lugar nenhum.
      // Quando a busca morria em HTTP 414 (SMS e HMI com "Todos os Setores", medido em
      // 29/08/2026), a tela ficava com os dados ANTERIORES ou com zeros, sem uma palavra de
      // erro. Fila vazia é indistinguível de fila que não carregou — e num módulo que decide
      // falta de servidor público, "não apareceu nada" tem de ser distinguível de "não há nada".
      console.error('Erro ao carregar eventos:', res.error)
      setErroCarga(res.error)
      setEventosData(prev => ({ ...prev, total: 0, justificados: 0, pendentes: 0,
        cumpridos_sem_justificativa: 0, resolvidos: 0, filtrados: 0, sugestoes: 0,
        em_avaliacao: 0, faltas: 0, items: [] }))
    }
    setLoading(false)
  }, [selectedUnidade, selectedSetor, selectedServidor, mes, ano, filterCategoria, filterStatus, currentPage])

  // Load templates
  const fetchTemplates = useCallback(async () => {
    const res = await getTemplatesPadrao(selectedUnidade || undefined)
    if (res.templates) {
      setTemplates(res.templates)
    }
  }, [selectedUnidade])

  useEffect(() => {
    fetchEventos()
    fetchTemplates()
  }, [fetchEventos, fetchTemplates])

  // Select / Deselect All
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const ids = new Set(eventosData.items.map(e => e.escala_diaria_id))
      setSelectedEventoIds(ids)
    } else {
      setSelectedEventoIds(new Set())
    }
  }

  const handleToggleSelectOne = (id: string) => {
    setSelectedEventoIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Selected events array for bulk modal
  const selectedEventosList = eventosData.items.filter(e => selectedEventoIds.has(e.escala_diaria_id))

  // Handle Save Single Justification
  const handleSaveSingle = async (texto: string, templateId?: string, resultado?: Desfecho) => {
    if (!singleModalEvento) return
    const res = await salvarJustificativa({
      escalaDiariaId: singleModalEvento.escala_diaria_id,
      servidorId: singleModalEvento.servidor_id,
      escalaMensalId: singleModalEvento.escala_mensal_id,
      dia: singleModalEvento.dia,
      mes: singleModalEvento.mes,
      ano: singleModalEvento.ano,
      categoria: singleModalEvento.categoria,
      texto,
      justificativaPadraoId: templateId,
      resultado
    })
    if (res.error) throw new Error(res.error)
    await fetchEventos()
  }

  // Handle Save Bulk Justifications
  const handleSaveBulk = async (texto: string, templateId?: string) => {
    const payload = selectedEventosList.map(e => ({
      escala_diaria_id: e.escala_diaria_id,
      servidor_id: e.servidor_id,
      escala_mensal_id: e.escala_mensal_id,
      dia: e.dia,
      mes: e.mes,
      ano: e.ano,
      categoria: e.categoria,
      texto,
      justificativa_padrao_id: templateId
    }))
    const res = await salvarJustificativasBulk(payload)
    if (res.error) throw new Error(res.error)
    setSelectedEventoIds(new Set())
    await fetchEventos()
  }

  // Handle Validate Server Suggestion
  const handleValidarSugestao = async (params: {
    justificativaId: string
    acao: 'aprovar' | 'rejeitar'
    textoEditado?: string
    motivoRejeicao?: string
  }) => {
    const res = await validarSugestao(params)
    if (res.error) throw new Error(res.error)
    await fetchEventos()
  }

  // Handle Save Template
  const handleSaveTemplate = async (dados: any) => {
    const res = await salvarTemplatePadrao(dados)
    if (res.error) throw new Error(res.error)
    await fetchTemplates()
  }

  // Handle Toggle Template
  const handleToggleTemplate = async (id: string, ativo: boolean) => {
    await toggleTemplatePadrao(id, ativo)
    await fetchTemplates()
  }

  // A barra mede NADA PENDENTE DE AÇÃO, não "quantos textos foram escritos" — sobreaviso
  // cumprido entra como resolvido (decisão de 23/08/2026), senão a barra passaria a medir
  // burocracia em vez de pendência num setor de sobreaviso. É por isso que `resolvidos` existe
  // separado de `justificados`: antes os dois eram o mesmo número, e o card dizia 100% com
  // linha sem justificativa nenhuma na lista logo abaixo.
  const resolvidos = eventosData.resolvidos ?? eventosData.justificados
  const percentJustificado = eventosData.total > 0
    ? Math.round((resolvidos / eventosData.total) * 100)
    : 100

  const categoriaBadgeColors: Record<string, string> = {
    'Extra': 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200',
    'Plantão': 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200',
    'Sobreaviso': 'bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-cyan-200',
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 pb-32">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-zinc-200 dark:border-zinc-800 pb-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-600/20">
            <ClipboardCheck className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Justificativas de Eventos</h1>
            <p className="text-zinc-500 text-sm font-medium">Gestão e registro motivacional individual para Horas Extras, Plantões e Sobreavisos.</p>
          </div>
        </div>
      </div>

      {/* FILTROS DO CABEÇALHO */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          {/* Unidade */}
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Unidade</label>
            <select
              value={selectedUnidade}
              onChange={(e) => { setSelectedUnidade(e.target.value); setSelectedSetor(''); setSelectedServidor(''); setCurrentPage(1) }}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-xs font-bold text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              {/*
                "TODAS AS UNIDADES" — 29/08/2026.
                A tela abria na PRIMEIRA unidade em ordem alfabética e não tinha opção de sair
                dela: `fetchEventos` nem buscava sem unidade, e a action filtrava duro por
                `unidade_id`. Com 33 unidades cadastradas (11 com escala em 08/2026), um
                Administrador Geral — que por definição enxerga tudo — só conseguia ver a rede
                visitando unidade por unidade. O escopo por papel sempre esteve certo; o que
                faltava era a tela permitir exercê-lo.
                Quem é escopado não ganha nada indevido: `applyAccessFilters` continua sendo
                quem recorta, e "todas" significa "todas as que já são minhas".
              */}
              <option value="">Todas as Unidades</option>
              {unidades.map(u => (
                <option key={u.id} value={u.id}>{rotularInativo(u as any, ' (inativa)')}</option>
              ))}
            </select>
          </div>

          {/* Setor */}
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Setor</label>
            <select
              value={selectedSetor}
              onChange={(e) => { setSelectedSetor(e.target.value); setSelectedServidor(''); setCurrentPage(1) }}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-xs font-bold text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="">Todos os Setores</option>
              {filteredSetores.map(s => (
                <option key={s.id} value={s.id}>{rotularInativo(s as any)}</option>
              ))}
            </select>
          </div>

          {/* Servidor (Combobox Pesquisável) */}
          <div className="space-y-1 relative" ref={servidorDropdownRef}>
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Servidor</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Pesquisar por nome ou matrícula..."
                value={
                  isServidorDropdownOpen
                    ? servidorSearchText
                    : (servidores.find(s => s.id === selectedServidor)?.nome || (servidorSearchText ? servidorSearchText : 'Todos os Servidores'))
                }
                onFocus={(e) => {
                  setIsServidorDropdownOpen(true)
                  e.target.select()
                }}
                onChange={(e) => {
                  const val = e.target.value
                  setServidorSearchText(val)
                  setIsServidorDropdownOpen(true)
                  if (!val) {
                    setSelectedServidor('')
                    setCurrentPage(1)
                  }
                }}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl pl-3 pr-9 py-2.5 text-xs font-bold text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500 outline-none truncate cursor-pointer"
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-2.5 gap-1">
                {(selectedServidor || servidorSearchText) ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedServidor('')
                      setServidorSearchText('')
                      setIsServidorDropdownOpen(false)
                      setCurrentPage(1)
                    }}
                    className="p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <Search className="h-3.5 w-3.5 text-zinc-400 pointer-events-none" />
                )}
              </div>
            </div>

            {/* Menu flutuante de resultados da busca */}
            {isServidorDropdownOpen && (
              <div className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl py-1 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedServidor('')
                    setServidorSearchText('')
                    setIsServidorDropdownOpen(false)
                    setCurrentPage(1)
                  }}
                  className={`w-full text-left px-3.5 py-2.5 font-bold hover:bg-indigo-50 dark:hover:bg-zinc-700 transition-colors flex items-center justify-between ${!selectedServidor ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/20 font-black' : 'text-zinc-500 dark:text-zinc-400'}`}
                >
                  <span>Todos os Servidores</span>
                  {!selectedServidor && <Check className="h-3.5 w-3.5 text-indigo-600" />}
                </button>

                <div className="border-t border-zinc-100 dark:border-zinc-700/60 my-1" />

                {filteredServidores.length === 0 ? (
                  <div className="px-3.5 py-4 text-center text-zinc-400 dark:text-zinc-500 italic text-[11px]">
                    Nenhum servidor encontrado com "{servidorSearchText}".
                  </div>
                ) : (
                  filteredServidores.slice(0, 80).map(s => {
                    const isSelected = selectedServidor === s.id
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSelectedServidor(s.id)
                          setServidorSearchText(s.nome)
                          setIsServidorDropdownOpen(false)
                          setCurrentPage(1)
                        }}
                        className={`w-full text-left px-3.5 py-2 hover:bg-indigo-50 dark:hover:bg-zinc-700 transition-colors flex items-center justify-between ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-black' : 'text-zinc-800 dark:text-zinc-200'}`}
                      >
                        <div className="truncate pr-2">
                          <div className="font-bold truncate">{s.nome}</div>
                          {s.matricula && <div className="text-[10px] text-zinc-400 font-mono">Mat: {s.matricula}</div>}
                        </div>
                        {isSelected && <Check className="h-3.5 w-3.5 text-indigo-600 shrink-0" />}
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>

          {/* Mês */}
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Mês</label>
            <select
              value={mes}
              onChange={(e) => { setMes(parseInt(e.target.value, 10)); setCurrentPage(1) }}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-xs font-bold text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1, 1).toLocaleString('pt-BR', { month: 'long' }).toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {/* Ano */}
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Ano</label>
            <select
              value={ano}
              onChange={(e) => { setAno(parseInt(e.target.value, 10)); setCurrentPage(1) }}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-xs font-bold text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              {[2024, 2025, 2026, 2027].map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          {/* Categoria */}
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Categoria</label>
            <select
              value={filterCategoria}
              onChange={(e) => { setFilterCategoria(e.target.value); setCurrentPage(1) }}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-xs font-bold text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="todos">Todas</option>
              <option value="Extra">Hora Extra</option>
              <option value="Plantão">Plantão</option>
              <option value="Sobreaviso">Sobreaviso</option>
            </select>
          </div>

          {/* Status */}
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setCurrentPage(1) }}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-xs font-bold text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="todos">Todos os Status</option>
              <option value="pendentes">Pendentes de Justificativa</option>
              {/*
                O RECORTE QUE A VALIDAÇÃO EM MASSA NUNCA TEVE.
                O botão "Justificar N selecionados" existe desde sempre, mas não havia filtro que
                devolvesse um grupo homogêneo para selecionar — e para Sobreaviso cumprido a
                opção "Pendentes" devolvia VAZIO, porque a classificação automática sobrescrevia
                o status da justificativa (corrigido em 28/08/2026). Na prática, escrever a
                motivação de um mês de prontidão exigia abrir linha por linha.
              */}
              <option value="cumpridos_sem_justificativa">Cumpridos sem justificativa (opcional)</option>
              {/*
                "Pendente de justificativa" e "em avaliação" NÃO são a mesma coisa, e é por isso
                que este filtro existe: um evento pode já ter texto escrito (status `aprovada`) e
                mesmo assim continuar sem desfecho — em 08/2026 são 6 casos, justificativas
                antigas escritas como motivação, em dias sem registro completo de ponto. Sem esta
                opção eles só apareceriam em "Já Justificados", que é justamente onde ninguém
                procura o que ainda falta decidir.
              */}
              <option value="em_avaliacao">Em avaliação (aguardando decisão)</option>
              <option value="falta">Registrados como falta</option>
              <option value="preenchidas">Já Justificados</option>
              <option value="sugestoes">Sugestões de Servidores</option>
            </select>
          </div>
        </div>
      </div>

      {/* A falha de carga precisa ser VISÍVEL: fila vazia não pode parecer "não há nada". */}
      {erroCarga && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-4 rounded-2xl flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-black text-red-700 dark:text-red-300 uppercase tracking-wide">
              Não foi possível carregar a fila
            </p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-1 leading-relaxed">
              Os números abaixo estão zerados por falha de carga, não por ausência de eventos.
              Detalhe técnico: {erroCarga}
            </p>
          </div>
        </div>
      )}

      {/* CARDS DE MÉTRICAS RÁPIDAS */}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-6">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm space-y-2">
          <div className="flex items-center justify-between text-zinc-500">
            <span className="text-xs font-black uppercase tracking-wider">Total de Eventos</span>
            <Calendar className="h-5 w-5 text-indigo-500" />
          </div>
          <p className="text-3xl font-black text-zinc-900 dark:text-white tracking-tight">{eventosData.total}</p>
          <p className="text-[11px] text-zinc-400">Horas Extras, Plantões e Sobreavisos no mês</p>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm space-y-2">
          <div className="flex items-center justify-between text-amber-600">
            <span className="text-xs font-black uppercase tracking-wider">Pendentes</span>
            <Clock className="h-5 w-5" />
          </div>
          <p className="text-3xl font-black text-amber-600 dark:text-amber-400 tracking-tight">{eventosData.pendentes}</p>
          <p className="text-[11px] text-zinc-400">Aguardando justificativa do coordenador</p>

          {/*
            O NÚMERO QUE FALTAVA NA TELA.
            "Pendentes" conta só o que é COBRADO de alguém — sobreaviso cumprido não é (decisão
            de 23/08/2026). Mas ele existe, aparece na fila com o botão "Justificar", e antes
            não tinha número nenhum aqui: o card dizia 0 com linha "Nenhuma justificativa" logo
            abaixo, e não havia como selecionar esse grupo em lote. Clicar filtra por ele.
          */}
          {(eventosData.cumpridos_sem_justificativa ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => { setFilterStatus('cumpridos_sem_justificativa'); setCurrentPage(1) }}
              className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold hover:underline text-left"
            >
              + {eventosData.cumpridos_sem_justificativa} cumprido(s) sem justificativa — opcional
            </button>
          )}
        </div>

        {/*
          EM AVALIAÇÃO NÃO É "PENDENTE".
          "Pendentes" conta quem não tem TEXTO; este card conta quem não tem DECISÃO sobre o
          cumprimento — e são conjuntos diferentes. Em 08/2026 há 6 eventos com justificativa já
          escrita (portanto fora de "Pendentes") que continuam sem desfecho porque o ponto não
          provou o plantão. Estas são as horas que o anexo vai deixar de somar.
        */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm space-y-2">
          <div className="flex items-center justify-between text-orange-600">
            <span className="text-xs font-black uppercase tracking-wider">Em Avaliação</span>
            <AlertCircle className="h-5 w-5" />
          </div>
          <p className="text-3xl font-black text-orange-600 dark:text-orange-400 tracking-tight">{eventosData.em_avaliacao ?? 0}</p>
          <p className="text-[11px] text-zinc-400">
            Sem registro completo de ponto e sem decisão
            {(eventosData.faltas ?? 0) > 0 && <> · <strong className="text-red-500">{eventosData.faltas} falta(s)</strong></>}
          </p>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm space-y-2">
          <div className="flex items-center justify-between text-blue-600">
            <span className="text-xs font-black uppercase tracking-wider">Sugestões</span>
            <MessageSquare className="h-5 w-5" />
          </div>
          <p className="text-3xl font-black text-blue-600 dark:text-blue-400 tracking-tight">{eventosData.sugestoes}</p>
          <p className="text-[11px] text-zinc-400">Enviadas pelos servidores para validação</p>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm space-y-3">
          <div className="flex items-center justify-between text-green-600">
            <span className="text-xs font-black uppercase tracking-wider">Progresso (%)</span>
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-black text-green-600 dark:text-green-400 tracking-tight">{percentJustificado}%</span>
            <span className="text-xs font-bold text-zinc-400">{resolvidos}/{eventosData.total}</span>
          </div>
          <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2.5 rounded-full overflow-hidden">
            <div className="bg-green-500 h-full transition-all duration-500" style={{ width: `${percentJustificado}%` }} />
          </div>
        </div>
      </div>

      {/* NAVEGAÇÃO ENTRE ABAS */}
      <div className="flex items-center gap-2 p-1.5 bg-zinc-100 dark:bg-zinc-800/80 rounded-2xl border border-zinc-200 dark:border-zinc-700/60">
        <button
          type="button"
          onClick={() => setActiveTab('fila')}
          className={`flex items-center gap-2.5 px-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all ${
            activeTab === 'fila'
              ? 'bg-white dark:bg-zinc-900 text-indigo-600 shadow-md border border-zinc-200/80 dark:border-zinc-700'
              : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          <ClipboardCheck className="h-4 w-4" />
          {/*
            Era `items.length` — os itens da PÁGINA, no máximo 20. Com 40 eventos a aba dizia
            "(20)" e o card dizia 40, sem nada explicando a diferença. Agora conta o que casa
            com o filtro, que é o que a aba de fato lista.
          */}
          Fila de Justificativas ({eventosData.filtrados ?? eventosData.items.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sugestoes')}
          className={`flex items-center gap-2.5 px-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all relative ${
            activeTab === 'sugestoes'
              ? 'bg-white dark:bg-zinc-900 text-blue-600 shadow-md border border-zinc-200/80 dark:border-zinc-700'
              : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          Sugestões dos Servidores
          {eventosData.sugestoes > 0 && (
            <span className="px-2 py-0.5 text-[10px] font-black bg-blue-600 text-white rounded-full">
              {eventosData.sugestoes}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('templates')}
          className={`flex items-center gap-2.5 px-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all ${
            activeTab === 'templates'
              ? 'bg-white dark:bg-zinc-900 text-purple-600 shadow-md border border-zinc-200/80 dark:border-zinc-700'
              : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          <FileText className="h-4 w-4" />
          Templates Padrão ({templates.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('relatorios')}
          className={`flex items-center gap-2.5 px-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all ${
            activeTab === 'relatorios'
              ? 'bg-white dark:bg-zinc-900 text-green-600 shadow-md border border-zinc-200/80 dark:border-zinc-700'
              : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          <Printer className="h-4 w-4" />
          Emissão de Relatórios
        </button>
      </div>

      {/* ABA 1: FILA DE JUSTIFICATIVAS */}
      {activeTab === 'fila' && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-sm overflow-hidden space-y-4">
          {/* Header da Tabela */}
          <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-black text-zinc-900 dark:text-white uppercase tracking-tight text-base">Fila Operacional de Eventos</h3>
              <p className="text-xs text-zinc-500">Selecione eventos individuais ou em lote para aplicar justificativas motivacionais.</p>

              {/*
                OS CARDS MEDEM O MÊS; A LISTA MEDE O FILTRO — e nada dizia isso.
                Com o Status em qualquer recorte, "PENDENTES 21" convivia com "Nenhum evento
                encontrado" logo abaixo, e a leitura natural era que a tela tinha parado de
                mostrar os eventos. Pior: o filtro é sticky em sessionStorage, então seguia o
                usuário ao trocar de unidade, setor e mês. A frase abaixo é o que faltava para
                os dois números serem comparáveis.
              */}
              {filterStatus !== 'todos' && (
                <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                  Exibindo {eventosData.filtrados ?? 0} de {eventosData.total} evento(s) do mês —
                  filtro de status ativo.{' '}
                  <button
                    type="button"
                    onClick={() => { setFilterStatus('todos'); setCurrentPage(1) }}
                    className="underline hover:no-underline"
                  >
                    Limpar filtro
                  </button>
                </p>
              )}
            </div>

            {selectedEventoIds.size > 0 && (
              <button
                type="button"
                onClick={() => setIsBulkModalOpen(true)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-indigo-600/20 flex items-center gap-2 transition-all animate-fade-in"
              >
                <CheckSquare className="h-4 w-4" />
                Justificar {selectedEventoIds.size} Evento(s) Selecionado(s)
              </button>
            )}
          </div>

          {loading ? (
            <div className="p-16 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600 mx-auto mb-3" />
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Carregando Fila de Justificativas...</p>
            </div>
          ) : eventosData.items.length === 0 ? (
            <div className="p-16 text-center space-y-3">
              <CheckCircle2 className="h-12 w-12 text-zinc-300 mx-auto" />
              <h4 className="font-bold text-zinc-700 dark:text-zinc-300">Nenhum evento encontrado para este filtro.</h4>
              <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                Altere os filtros de Unidade, Setor, Mês ou Status para visualizar outros registros.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800 text-zinc-400 font-black uppercase tracking-wider">
                    <th className="p-4 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedEventoIds.size > 0 && selectedEventoIds.size === eventosData.items.length}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </th>
                    <th className="p-4">Servidor</th>
                    <th className="p-4">Dia</th>
                    <th className="p-4">Categoria</th>
                    <th className="p-4">Turno</th>
                    <th className="p-4">Ponto</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Justificativa</th>
                    <th className="p-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {eventosData.items.map((ev) => {
                    const isSelected = selectedEventoIds.has(ev.escala_diaria_id)
                    // `isJustificado` = EXISTE TEXTO GRAVADO, e nada mais. Antes o status era
                    // sobrescrito por `auto_validado` em todo sobreaviso cumprido, então isto
                    // dava `false` mesmo com a justificativa salva — o botão continuava
                    // "Justificar" em azul e o coordenador concluía que não tinha gravado.
                    const isJustificado = ev.justificativa_status === 'aprovada'
                    const isSugestao = ev.justificativa_status === 'sugestao_pendente'
                    // Eixo do desfecho: cumprido, não se cobra texto de ninguém. Convive com
                    // `isJustificado` em vez de apagá-lo.
                    const semAcaoNecessaria = !!ev.sem_acao_necessaria

                    return (
                      <tr 
                        key={ev.escala_diaria_id} 
                        className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors ${isSelected ? 'bg-indigo-50/50 dark:bg-indigo-950/20' : ''}`}
                      >
                        <td className="p-4 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectOne(ev.escala_diaria_id)}
                            className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="p-4">
                          <div className="font-bold text-zinc-900 dark:text-white">{ev.servidor_nome}</div>
                          <div className="text-[10px] text-zinc-400 font-mono">Mat: {ev.servidor_matricula || '—'}</div>
                          {/*
                            Só aparece quando a lista mistura unidades. Sem unidade escolhida,
                            a fila junta a rede inteira e "FERNANDO, dia 01, Sobreaviso" deixa
                            de identificar o evento — a mesma pessoa pode estar escalada em mais
                            de um lugar (armadilha 23). Com uma unidade escolhida a linha seria
                            ruído: o filtro no topo já diz onde você está.
                          */}
                          {!selectedUnidade && (
                            <div className="text-[10px] text-zinc-400 mt-0.5 truncate max-w-[220px]"
                                 title={`${ev.unidade_nome} / ${ev.setor_nome}`}>
                              {ev.unidade_nome} <span className="text-zinc-300">/</span> {ev.setor_nome}
                            </div>
                          )}
                        </td>
                        <td className="p-4 font-mono font-bold text-zinc-700 dark:text-zinc-300">
                          {String(ev.dia).padStart(2, '0')}/{String(ev.mes).padStart(2, '0')}/{ev.ano}
                        </td>
                        <td className="p-4">
                          <span className={`px-2.5 py-1 rounded-full font-black text-[10px] uppercase border ${categoriaBadgeColors[ev.categoria] || 'bg-zinc-100'}`}>
                            {ev.categoria}
                          </span>
                        </td>
                        <td className="p-4 font-mono font-bold text-zinc-600 dark:text-zinc-400">
                          {ev.turno_codigo || '—'}
                        </td>
                        {/*
                          O PONTO DAQUELE DIA, ANTES DA DECISÃO.
                          Até 24/08/2026 a fila mostrava servidor/dia/categoria/turno/status e
                          nada dizia se houve batida — o coordenador teria que abrir a grade em
                          outra aba para saber. A decisão que esta tela pede agora (validar ou
                          registrar falta) é sobre exatamente esse fato.
                        */}
                        <td className="p-4 font-mono text-[11px] whitespace-nowrap">
                          {ev.categoria === 'Sobreaviso' ? (
                            <span className="text-zinc-400">—</span>
                          ) : ev.presenca_entrada_em || ev.presenca_saida_em ? (
                            <span className={ev.presenca_entrada_em && ev.presenca_saida_em
                              ? 'font-bold text-emerald-600 dark:text-emerald-400'
                              : 'font-bold text-amber-600 dark:text-amber-400'}>
                              {ev.presenca_entrada_em ? formatarHora(ev.presenca_entrada_em) : '—:—'}
                              {' → '}
                              {ev.presenca_saida_em ? formatarHora(ev.presenca_saida_em) : '—:—'}
                            </span>
                          ) : (
                            <span className="font-bold text-red-500">sem registro</span>
                          )}
                        </td>
                        <td className="p-4">
                          {/*
                            O DESFECHO VEM ANTES DO STATUS DE JUSTIFICATIVA.
                            "Justificado" diz que alguém escreveu um texto; `falta` e
                            `em avaliação` dizem o que vai acontecer com aquelas horas no anexo.
                            É a segunda informação que decide se o coordenador precisa agir, e
                            ela não pode ficar escondida atrás de um selo verde.
                            O estado vem de fn_desfecho_evento_dia — a tela não reclassifica nada.
                          */}
                          {ev.resultado === 'falta' ? (
                            <span
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 font-bold text-[10px] border border-red-200"
                              title={ev.resultado_origem === 'decurso_de_prazo'
                                ? 'Convertida em falta no fechamento, por ninguém ter decidido dentro do prazo'
                                : 'Falta registrada pelo coordenador'}
                            >
                              <XCircle className="h-3 w-3" /> Falta
                            </span>
                          ) : ev.estado === 'em_avaliacao' ? (
                            <span
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 font-bold text-[10px] border border-orange-200"
                              title={ev.estado_motivo || 'Sem registro completo de ponto e sem decisão do coordenador'}
                            >
                              <AlertCircle className="h-3 w-3" /> Em avaliação
                            </span>
                          ) : semAcaoNecessaria ? (
                            // Sobreaviso cumprido — sem acionamento, ou acionado e atendido.
                            // Não pede nada de ninguém: cobrar justificativa de quem ficou de
                            // prontidão e não foi chamado é pedir texto sobre um não-evento.
                            //
                            // O selo continua sendo o do DESFECHO (é ele que diz o que acontece
                            // com as horas no anexo), mas agora informa também se há texto
                            // gravado — era a ausência disso que fazia salvar não mudar nada na
                            // linha. A prova de que gravou não pode ficar só na outra coluna.
                            <span
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold text-[10px] border border-emerald-200"
                              title={isJustificado
                                ? 'Prontidão cumprida — validado automaticamente. Justificativa registrada.'
                                : 'Prontidão cumprida — validado automaticamente, sem ação necessária'}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              {isJustificado ? 'Cumprido · justificado' : 'Cumprido'}
                            </span>
                          ) : isJustificado ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300 font-bold text-[10px] border border-green-200">
                              <CheckCircle2 className="h-3 w-3" /> Justificado
                            </span>
                          ) : isSugestao ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold text-[10px] border border-blue-200">
                              <MessageSquare className="h-3 w-3" /> Sugestão
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold text-[10px] border border-amber-200">
                              <Clock className="h-3 w-3" /> Pendente
                            </span>
                          )}
                        </td>
                        <td className="p-4 max-w-xs">
                          {ev.texto_justificativa ? (
                            <p className="text-zinc-700 dark:text-zinc-300 text-xs truncate" title={ev.texto_justificativa}>
                              {ev.texto_justificativa}
                            </p>
                          ) : (
                            <span className="text-zinc-400 italic text-[11px]">Nenhuma justificativa</span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          {isSugestao ? (
                            <button
                              type="button"
                              onClick={() => setValidarSugestaoData({ id: ev.justificativa_id, ...ev })}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[11px] shadow-sm transition-all"
                            >
                              Analisar Sugestão
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setSingleModalEvento(ev)}
                              title={semAcaoNecessaria && !isJustificado
                                ? 'Opcional: este evento já está cumprido e não cobra justificativa'
                                : undefined}
                              /*
                                O AZUL É CTA DE PENDÊNCIA, E SÓ PENDÊNCIA DEVE USÁ-LO.
                                Antes todo sobreaviso cumprido saía em azul chamando "Justificar"
                                enquanto o card dizia PENDENTES = 0 — a tela se contradizia, e a
                                leitura natural era que o card estava errado. Justificar aqui é
                                opcional, então o botão é secundário.
                              */
                              className={`px-3 py-1.5 rounded-lg font-bold text-[11px] shadow-sm transition-all ${
                                isJustificado || semAcaoNecessaria
                                  ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200'
                                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/20'
                              }`}
                            >
                              {isJustificado ? 'Editar' : 'Justificar'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginação Padrão do SisEscala */}
          {eventosData.total > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between border-t border-zinc-200 dark:border-zinc-800 px-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/50 gap-4">
              <div className="text-xs font-black uppercase tracking-wider text-zinc-400">
                Mostrando <span className="font-extrabold text-zinc-900 dark:text-white">{eventosData.total === 0 ? 0 : (currentPage - 1) * 20 + 1}</span> a <span className="font-extrabold text-zinc-900 dark:text-white">{Math.min(eventosData.total, currentPage * 20)}</span> de <span className="font-extrabold text-zinc-900 dark:text-white">{eventosData.total}</span> eventos
              </div>
              {Math.ceil(eventosData.total / 20) > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold text-xs uppercase tracking-wider transition-all hover:bg-zinc-50 dark:hover:bg-zinc-700/50 disabled:opacity-50 active:scale-95"
                  >
                    Anterior
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.ceil(eventosData.total / 20) }, (_, i) => i + 1)
                      .filter(page => {
                        const totalPages = Math.ceil(eventosData.total / 20)
                        if (totalPages <= 5) return true
                        return Math.abs(page - currentPage) <= 2 || page === 1 || page === totalPages
                      })
                      .map((page, idx, arr) => {
                        const prevPage = arr[idx - 1]
                        const showEllipsis = prevPage && page - prevPage > 1
                        return (
                          <Fragment key={page}>
                            {showEllipsis && (
                              <span className="px-1 text-zinc-400 font-bold text-xs">...</span>
                            )}
                            <button
                              type="button"
                              onClick={() => setCurrentPage(page)}
                              className={`w-8 h-8 rounded-xl font-black text-xs transition-all active:scale-95 ${
                                currentPage === page
                                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                                  : 'border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50'
                              }`}
                            >
                              {page}
                            </button>
                          </Fragment>
                        )
                      })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(eventosData.total / 20)))}
                    disabled={currentPage >= Math.ceil(eventosData.total / 20)}
                    className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold text-xs uppercase tracking-wider transition-all hover:bg-zinc-50 dark:hover:bg-zinc-700/50 disabled:opacity-50 active:scale-95"
                  >
                    Próxima
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ABA 2: SUGESTÕES DOS SERVIDORES */}
      {activeTab === 'sugestoes' && (
        <div className="space-y-6">
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 p-6 rounded-3xl space-y-2">
            <h3 className="font-black text-blue-900 dark:text-blue-200 uppercase tracking-tight text-sm flex items-center gap-2">
              <MessageSquare className="h-5 w-5" /> Sugestões Enviadas Pelos Servidores
            </h3>
            <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
              Aqui estão as justificativas submetidas pelos próprios servidores através do portal de consultas. Você pode aprovar (com ou sem edição de texto) ou rejeitar com justificativa.
            </p>
          </div>

          {eventosData.items.filter(e => e.justificativa_status === 'sugestao_pendente').length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-16 rounded-3xl text-center space-y-3">
              <CheckCircle2 className="h-12 w-12 text-zinc-300 mx-auto" />
              <h4 className="font-bold text-zinc-700 dark:text-zinc-300">Nenhuma sugestão pendente no momento.</h4>
              <p className="text-xs text-zinc-400">Todas as justificativas dos servidores foram analisadas ou não há envios para os filtros selecionados.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {eventosData.items.filter(e => e.justificativa_status === 'sugestao_pendente').map(ev => (
                <div key={ev.escala_diaria_id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm space-y-4">
                  <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
                    <div>
                      <h4 className="font-black text-zinc-900 dark:text-white text-sm">{ev.servidor_nome}</h4>
                      <p className="text-[11px] text-zinc-400">Matrícula: {ev.servidor_matricula || '—'}</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full font-black text-[10px] uppercase border ${categoriaBadgeColors[ev.categoria] || 'bg-zinc-100'}`}>
                      {ev.categoria}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500 font-medium">
                    <div><strong className="text-zinc-700 dark:text-zinc-300">Dia:</strong> {String(ev.dia).padStart(2, '0')}/{String(ev.mes).padStart(2, '0')}/{ev.ano}</div>
                    <div><strong className="text-zinc-700 dark:text-zinc-300">Turno:</strong> {ev.turno_codigo || '—'}</div>
                  </div>

                  <div className="p-4 bg-zinc-50 dark:bg-zinc-800/80 rounded-2xl border border-zinc-200 dark:border-zinc-700 space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 block">Texto da Sugestão:</span>
                    <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 leading-relaxed italic">
                      "{ev.texto_justificativa}"
                    </p>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setValidarSugestaoData({ id: ev.justificativa_id, ...ev })}
                      className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Analisar & Decidir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ABA 3: TEMPLATES PADRÃO */}
      {activeTab === 'templates' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-black text-zinc-900 dark:text-white uppercase tracking-tight text-lg">Modelos de Justificativa Padrão</h3>
              <p className="text-xs text-zinc-500">Cadastre frases prontas recorrentes para agilizar o preenchimento dos coordenadores.</p>
            </div>
            <button
              type="button"
              onClick={() => setTemplateModalData({ isOpen: true, template: null })}
              className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-lg shadow-purple-600/20 flex items-center gap-2 transition-all"
            >
              <Plus className="h-4 w-4" />
              Novo Template Padrão
            </button>
          </div>

          {templates.length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-16 rounded-3xl text-center space-y-3">
              <FileText className="h-12 w-12 text-zinc-300 mx-auto" />
              <h4 className="font-bold text-zinc-700 dark:text-zinc-300">Nenhum modelo padrão cadastrado.</h4>
              <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                Clique no botão acima para cadastrar justificativas prontas (ex: "Substituição emergencial por atestado").
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {templates.map(tmpl => (
                <div key={tmpl.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm space-y-4 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="font-bold text-zinc-900 dark:text-white text-sm">{tmpl.titulo}</h4>
                      <span className={`px-2 py-0.5 text-[10px] font-black uppercase rounded-full border ${tmpl.ativo ? 'bg-green-100 text-green-700 border-green-200' : 'bg-zinc-100 text-zinc-500 border-zinc-200'}`}>
                        {tmpl.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                      <span>Categoria: {tmpl.categoria || 'Todas'}</span>
                      <span>•</span>
                      <span>Escopo: {tmpl.unidades?.nome || 'Global'}</span>
                    </div>

                    <p className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/60 p-3.5 rounded-2xl border border-zinc-200/80 dark:border-zinc-700/60 leading-relaxed italic">
                      "{tmpl.texto}"
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => handleToggleTemplate(tmpl.id, !tmpl.ativo)}
                      className="px-3 py-1.5 rounded-lg font-bold text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {tmpl.ativo ? 'Desativar' : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTemplateModalData({ isOpen: true, template: tmpl })}
                      className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 rounded-lg font-bold text-xs"
                    >
                      Editar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ABA 4: EMISSÃO DE RELATÓRIOS */}
      {activeTab === 'relatorios' && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 rounded-3xl shadow-sm space-y-6">
          <div>
            <h3 className="font-black text-zinc-900 dark:text-white uppercase tracking-tight text-lg">Central de Relatórios & Assinaturas</h3>
            <p className="text-xs text-zinc-500">Selecione o modo de emissão e os parâmetros para gerar o relatório impresso ou assinado digitalmente.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="p-6 bg-zinc-50 dark:bg-zinc-800/60 rounded-3xl border border-zinc-200 dark:border-zinc-700/80 space-y-4 hover:border-indigo-500 transition-all cursor-pointer group"
                 onClick={() => setPrintReport({ isOpen: true, modoAssinatura: 'manual', tipo: 'mensal' })}
            >
              <div className="p-3 bg-indigo-100 dark:bg-indigo-950/60 rounded-2xl w-fit text-indigo-600">
                <Printer className="h-6 w-6" />
              </div>
              <div>
                <h4 className="font-bold text-zinc-900 dark:text-white text-sm">1. Impressão Manual</h4>
                <p className="text-xs text-zinc-500 mt-1">Relatório em papel com linhas em branco para assinaturas físicas de Servidor, Coordenador e Diretor.</p>
              </div>
            </div>

            <div className="p-6 bg-zinc-50 dark:bg-zinc-800/60 rounded-3xl border border-zinc-200 dark:border-zinc-700/80 space-y-4 hover:border-blue-500 transition-all cursor-pointer group"
                 onClick={() => setPrintReport({ isOpen: true, modoAssinatura: 'govbr', tipo: 'mensal' })}
            >
              <div className="p-3 bg-blue-100 dark:bg-blue-950/60 rounded-2xl w-fit text-blue-600">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h4 className="font-bold text-zinc-900 dark:text-white text-sm">2. Plataforma Gov.br</h4>
                <p className="text-xs text-zinc-500 mt-1">PDF preparado para upload e assinatura avançada no portal oficial gov.br/assina.</p>
              </div>
            </div>

            <div className="p-6 bg-zinc-50 dark:bg-zinc-800/60 rounded-3xl border border-zinc-200 dark:border-zinc-700/80 space-y-4 hover:border-purple-500 transition-all cursor-pointer group"
                 onClick={() => setIsA1ModalOpen(true)}
            >
              <div className="p-3 bg-purple-100 dark:bg-purple-950/60 rounded-2xl w-fit text-purple-600">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h4 className="font-bold text-zinc-900 dark:text-white text-sm">3. Certificado Digital A1</h4>
                <p className="text-xs text-zinc-500 mt-1">Upload temporário do arquivo .pfx para inserção de assinatura PKCS#7 diretamente no PDF.</p>
              </div>
            </div>

            <div className="p-6 bg-zinc-50 dark:bg-zinc-800/60 rounded-3xl border border-zinc-200 dark:border-zinc-700/80 space-y-4 hover:border-green-500 transition-all cursor-pointer group"
                 onClick={() => setIsA1ModalOpen(true)}
            >
              <div className="p-3 bg-green-100 dark:bg-green-950/60 rounded-2xl w-fit text-green-600">
                <Layers className="h-6 w-6" />
              </div>
              <div>
                <h4 className="font-bold text-zinc-900 dark:text-white text-sm">4. Modo Misto (Flexível)</h4>
                <p className="text-xs text-zinc-500 mt-1">Combina assinatura digital com impressão física de suporte em caso de indisponibilidade.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAIS DO MÓDULO */}
      {singleModalEvento && (
        <JustificativaModal
          isOpen={!!singleModalEvento}
          onClose={() => setSingleModalEvento(null)}
          evento={singleModalEvento}
          templates={templates}
          podeReverter={PAPEIS_REVERTEM_DESFECHO.includes(userProfile?.role)}
          onSave={handleSaveSingle}
        />
      )}

      {isBulkModalOpen && (
        <JustificativaBulkModal
          isOpen={isBulkModalOpen}
          onClose={() => setIsBulkModalOpen(false)}
          selectedEventos={selectedEventosList}
          templates={templates}
          onSaveBulk={handleSaveBulk}
        />
      )}

      {templateModalData.isOpen && (
        <TemplatePadraoModal
          isOpen={templateModalData.isOpen}
          onClose={() => setTemplateModalData({ isOpen: false, template: null })}
          template={templateModalData.template}
          unidades={unidades}
          setores={setores}
          onSave={handleSaveTemplate}
        />
      )}

      {validarSugestaoData && (
        <ValidarSugestaoModal
          isOpen={!!validarSugestaoData}
          onClose={() => setValidarSugestaoData(null)}
          sugestao={validarSugestaoData}
          onValidar={handleValidarSugestao}
        />
      )}

      {isA1ModalOpen && (
        <AssinaturaDigitalModal
          isOpen={isA1ModalOpen}
          onClose={() => setIsA1ModalOpen(false)}
          metadados={{
            unidadeId: selectedUnidade,
            setorId: selectedSetor,
            mes,
            ano,
            relatorioTipo: 'mensal',
            modoAssinatura: 'a1',
            totalEventos: eventosData.total
          }}
          onSignatureSuccess={() => {
            setIsA1ModalOpen(false)
            setPrintReport({ isOpen: true, modoAssinatura: 'a1', tipo: 'mensal' })
          }}
        />
      )}

      {printReport && printReport.isOpen && (
        <RelatorioEventoPrintView
          unidadeId={selectedUnidade}
          setorId={selectedSetor}
          servidorId={selectedServidor}
          mes={mes}
          ano={ano}
          categoria={filterCategoria}
          status={filterStatus}
          eventos={eventosData.items}
          modoAssinatura={printReport.modoAssinatura}
          onClose={() => setPrintReport(null)}
        />
      )}
    </div>
  )
}
