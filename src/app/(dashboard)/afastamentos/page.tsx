'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { 
  Plus, Calendar as CalendarIcon, Loader2, Trash2, 
  Search, AlertTriangle, Building2, Layers, Users, Tag, Info, Edit2,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Printer
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { applyAccessFilters, hasSectorAccess } from '@/utils/permissions'
import { formatSectorsHierarchy } from '@/utils/sectors'

interface Servidor {
  id: string
  nome: string
  matricula: string | null
  unidade_id: string
  setor_id: string
}

interface TipoEvento {
  id: string
  nome: string
  cor: string
}

interface ServidorEvento {
  id: string
  servidor_id: string
  tipo_evento_id: string
  data_inicio: string
  data_fim: string
  observacao: string | null
  slots: string[] | null
  servidores: {
    id: string
    nome: string
    matricula: string | null
    unidade_id: string
    setor_id: string
    unidades: { nome: string } | null
    setores: { dicionario_setores: { nome: string } } | null
  } | null
  tipos_eventos: TipoEvento | null
}

export default function AfastamentosPage() {
  const [profile, setProfile] = useState<any>(null)
  const [unidades, setUnidades] = useState<any[]>([])
  const [setores, setSetores] = useState<any[]>([])
  const [servidores, setServidores] = useState<Servidor[]>([])
  const [tiposEventos, setTiposEventos] = useState<TipoEvento[]>([])
  const [afastamentos, setAfastamentos] = useState<ServidorEvento[]>([])
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Filters and Form selections
  const [selectedUnidade, setSelectedUnidade] = useState('')
  const [selectedSetor, setSelectedSetor] = useState('')
  const [selectedServidor, setSelectedServidor] = useState('')
  const [selectedTipo, setSelectedTipo] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [observacao, setObservacao] = useState('')
  const [selectedPeriodo, setSelectedPeriodo] = useState<'integral' | 'M' | 'T' | 'N' | 'custom'>('integral')
  const [customSlots, setCustomSlots] = useState<string[]>([])

  // Search & List Filters
  const [searchTerm, setSearchTerm] = useState('')
  const [filterUnidade, setFilterUnidade] = useState('todas')
  const [filterSetor, setFilterSetor] = useState('todos')
  const [filterTipo, setFilterTipo] = useState('todos')
  const [filterMes, setFilterMes] = useState<string>(String(new Date().getMonth() + 1))
  const [filterAno, setFilterAno] = useState<string>(String(new Date().getFullYear()))

  // Pagination & selection states
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false)

  const meses = [
    { value: 'todos', label: 'Todos os Meses' },
    { value: '1', label: 'Janeiro' },
    { value: '2', label: 'Fevereiro' },
    { value: '3', label: 'Março' },
    { value: '4', label: 'Abril' },
    { value: '5', label: 'Maio' },
    { value: '6', label: 'Junho' },
    { value: '7', label: 'Julho' },
    { value: '8', label: 'Agosto' },
    { value: '9', label: 'Setembro' },
    { value: '10', label: 'Outubro' },
    { value: '11', label: 'Novembro' },
    { value: '12', label: 'Dezembro' }
  ]

  const currentYear = new Date().getFullYear()
  const anos = [
    { value: 'todos', label: 'Todos os Anos' },
    { value: String(currentYear - 1), label: String(currentYear - 1) },
    { value: String(currentYear), label: String(currentYear) },
    { value: String(currentYear + 1), label: String(currentYear + 1) }
  ]

  // Modals
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean, title: string, message: string, type: 'default' | 'danger' | 'success' | 'warning' }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'default'
  })
  const [confirmModal, setConfirmModal] = useState<{ 
    isOpen: boolean, 
    title: string, 
    message: string, 
    onConfirm: () => void,
    type: 'default' | 'danger' | 'warning'
  } | null>(null)

  const supabase = createClient()

  // Initialize and load user profile
  useEffect(() => {
    async function init() {
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
          await loadInitialData(userProfile)
        }
      }
    }
    init()
  }, [])

  // Load static resources
  async function loadInitialData(userProfile: any) {
    setLoading(true)
    try {
      // 1. Fetch units
      let unitsQuery = supabase.from('unidades').select('*').eq('ativo', true).order('nome')
      if (userProfile.role !== 'super_admin' && !userProfile.acesso_todas_unidades) {
        unitsQuery = unitsQuery.in('id', userProfile.permitted_unidades)
      }
      const { data: units } = await unitsQuery
      setUnidades(units || [])

      // 2. Fetch sectors
      let sectorsQuery = supabase.from('setores').select('*, dicionario_setores(nome)').eq('ativo', true)
      if (userProfile.role !== 'super_admin' && !userProfile.acesso_todos_setores) {
        sectorsQuery = sectorsQuery.in('id', userProfile.permitted_setores)
      }
      const { data: sectorsRaw } = await sectorsQuery
      const sectors = sectorsRaw?.map((s: any) => ({
        ...s,
        nome: (Array.isArray(s.dicionario_setores) ? s.dicionario_setores[0]?.nome : s.dicionario_setores?.nome) || 'SETOR SEM NOME'
      })) || []
      setSetores(formatSectorsHierarchy(sectors))

      // 3. Fetch event types
      const { data: types } = await supabase
        .from('tipos_eventos')
        .select('*')
        .eq('ativo', true)
        .order('nome')
      setTiposEventos(types || [])

      // 4. Fetch list of absences
      await fetchAfastamentos()

    } catch (error: any) {
      console.error('Erro ao carregar dados iniciais:', error)
    } finally {
      setLoading(false)
    }
  }

  // Fetch absences
  async function fetchAfastamentos() {
    try {
      const { data, error } = await supabase
        .from('servidores_eventos')
        .select(`
          *,
          servidores (
            id,
            nome,
            matricula,
            unidade_id,
            setor_id,
            unidades (nome),
            setores (
              dicionario_setores (nome)
            )
          ),
          tipos_eventos (
            id,
            nome,
            cor
          )
        `)
        .order('data_inicio', { ascending: false })
      
      if (error) throw error

      const mapped = data?.map((e: any) => {
        const sectorData = Array.isArray(e.servidores?.setores) ? e.servidores.setores[0] : e.servidores?.setores
        const dictData = sectorData ? (Array.isArray(sectorData.dicionario_setores) 
          ? sectorData.dicionario_setores[0] 
          : sectorData.dicionario_setores) : null
          
        return {
          ...e,
          servidores: e.servidores ? {
            ...e.servidores,
            unidades: Array.isArray(e.servidores.unidades) ? e.servidores.unidades[0] : e.servidores.unidades,
            setores: sectorData ? {
              dicionario_setores: {
                nome: dictData?.nome || 'SETOR SEM NOME'
              }
            } : null
          } : null
        }
      })

      setAfastamentos(mapped || [])
    } catch (error: any) {
      console.error('Erro ao carregar afastamentos:', error)
    }
  }

  // Fetch servers when Unit or Sector changes in form
  useEffect(() => {
    async function fetchServidoresForm() {
      if (!selectedUnidade || !selectedSetor) {
        setServidores([])
        setSelectedServidor('')
        return
      }
      
      const { data, error } = await supabase
        .from('servidores')
        .select('id, nome, matricula, unidade_id, setor_id')
        .eq('unidade_id', selectedUnidade)
        .eq('setor_id', selectedSetor)
        .eq('status', 'Ativo')
        .order('nome')

      if (error) {
        console.error('Erro ao buscar servidores:', error)
      } else {
        setServidores(data || [])
      }
    }
    fetchServidoresForm()
  }, [selectedUnidade, selectedSetor])

  const logAction = useCallback(async (acao: string, detalhes: any = {}) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await supabase.from('logs_sistema').insert({
        user_id: user.id,
        acao,
        detalhes: {
          ...detalhes,
          operador_email: user.email
        }
      })
    } catch (error) {
      console.error('Erro ao registrar log:', error)
    }
  }, [supabase])

  // Register new absence
  const handleAddAfastamento = async () => {
    if (!selectedServidor || !selectedTipo || !startDate || !endDate) {
      setAlertModal({
        isOpen: true,
        title: 'Campos Obrigatórios',
        message: 'Por favor, preencha todos os campos do formulário.',
        type: 'warning'
      })
      return
    }

    const start = new Date(startDate + 'T00:00:00')
    const end = new Date(endDate + 'T00:00:00')

    if (end < start) {
      setAlertModal({
        isOpen: true,
        title: 'Período Inválido',
        message: 'A data de término não pode ser anterior à data de início.',
        type: 'warning'
      })
      return
    }

    setSaving(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      let slotsValue: string[] | null = null
      if (selectedPeriodo === 'M') slotsValue = ['M']
      else if (selectedPeriodo === 'T') slotsValue = ['T']
      else if (selectedPeriodo === 'N') slotsValue = ['N']
      else if (selectedPeriodo === 'custom') slotsValue = customSlots.length > 0 ? customSlots : null

      // 1. Validar se o servidor possui alguma escala prevista no período com conflito de slots
      const { data: monthlyScales } = await supabase
        .from('escala_mensal')
        .select('id, mes, ano')
        .eq('servidor_id', selectedServidor)

      if (monthlyScales && monthlyScales.length > 0) {
        const ids = monthlyScales.map(m => m.id)
        const { data: dailies } = await supabase
          .from('escala_diaria')
          .select('id, dia, escala_mensal_id, dicionario_turnos(slots), presenca_entrada_em, presenca_saida_em, presenca_confirmada, confirmado_por_id')
          .in('escala_mensal_id', ids)

        if (dailies && dailies.length > 0) {
          const conflictingDailies = dailies.filter(d => {
            const mScale = monthlyScales.find(m => m.id === d.escala_mensal_id)
            if (!mScale) return false
            const dayDate = new Date(mScale.ano, mScale.mes - 1, d.dia)
            const dateMatch = dayDate >= start && dayDate <= end
            if (!dateMatch) return false

            if (!slotsValue || slotsValue.length === 0) return true
            const shiftSlots = (d.dicionario_turnos as any)?.slots || []
            return shiftSlots.some((s: string) => slotsValue!.includes(s))
          })

          if (conflictingDailies.length > 0) {
            const hasConfirmedOrMarked = conflictingDailies.some(d => 
              d.presenca_entrada_em !== null || 
              d.presenca_saida_em !== null || 
              d.presenca_confirmada === true || 
              d.confirmado_por_id !== null
            )

            if (hasConfirmedOrMarked) {
              setSaving(false)
              setAlertModal({
                isOpen: true,
                title: '⚠️ Conflito de Escala Confirmada',
                message: 'Não é permitido cadastrar o afastamento neste período pois o servidor possui escala confirmada ou com marcações de presença reais na grade. O coordenador deve intervir pessoalmente.',
                type: 'warning'
              })
              return
            }

            // Caso sejam apenas previsões, solicita a confirmação do usuário
            setSaving(false)
            setConfirmModal({
              isOpen: true,
              title: 'Substituir Previsões de Escala?',
              message: 'Detectamos previsões de escala para este servidor no período selecionado. Elas serão substituídas automaticamente pelo lançamento do afastamento. Deseja prosseguir?',
              type: 'warning',
              onConfirm: () => {
                setConfirmModal(null)
                executeInsertion(user?.id, slotsValue)
              }
            })
            return
          }
        }
      }

      await executeInsertion(user?.id, slotsValue)

    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro de Validação',
        message: error.message,
        type: 'danger'
      })
      setSaving(false)
    }
  }

  // DB insertion execution
  const executeInsertion = async (userId?: string, slotsValue: string[] | null = null) => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('servidores_eventos')
        .insert({
          servidor_id: selectedServidor,
          tipo_evento_id: selectedTipo,
          data_inicio: startDate,
          data_fim: endDate,
          observacao: observacao || null,
          criado_por: userId || null,
          slots: slotsValue
        })

      if (error) throw error

      const serverName = servidores.find(s => s.id === selectedServidor)?.nome || 'Servidor'
      const typeName = tiposEventos.find(t => t.id === selectedTipo)?.nome || 'Afastamento'

      logAction('CADASTRAR_AFASTAMENTO', {
        servidor_id: selectedServidor,
        servidor_nome: serverName,
        tipo_afastamento: typeName,
        data_inicio: startDate,
        data_fim: endDate,
        slots: slotsValue
      })

      setStartDate('')
      setEndDate('')
      setObservacao('')
      setSelectedServidor('')
      setSelectedPeriodo('integral')
      setCustomSlots([])

      await fetchAfastamentos()

      setAlertModal({
        isOpen: true,
        title: 'Cadastrado com Sucesso',
        message: `O afastamento de ${serverName} foi registrado. As escalas vigentes e planejadas foram atualizadas automaticamente.`,
        type: 'success'
      })

    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro ao Cadastrar',
        message: error.message,
        type: 'danger'
      })
    } finally {
      setSaving(false)
      setConfirmModal(null)
    }
  }

  const startEditing = (a: ServidorEvento) => {
    setEditingId(a.id)
    setSelectedUnidade(a.servidores?.unidade_id || '')
    setSelectedSetor(a.servidores?.setor_id || '')
    setSelectedServidor(a.servidor_id)
    setSelectedTipo(a.tipo_evento_id)
    setStartDate(a.data_inicio)
    setEndDate(a.data_fim)
    setObservacao(a.observacao || '')
    
    if (!a.slots || a.slots.length === 0) {
      setSelectedPeriodo('integral')
      setCustomSlots([])
    } else if (a.slots.length === 1 && (a.slots[0] === 'M' || a.slots[0] === 'T' || a.slots[0] === 'N')) {
      setSelectedPeriodo(a.slots[0] as any)
      setCustomSlots([])
    } else {
      setSelectedPeriodo('custom')
      setCustomSlots(a.slots)
    }
  }

  const cancelEditing = () => {
    setEditingId(null)
    setSelectedUnidade('')
    setSelectedSetor('')
    setSelectedServidor('')
    setSelectedTipo('')
    setStartDate('')
    setEndDate('')
    setObservacao('')
    setSelectedPeriodo('integral')
    setCustomSlots([])
  }

  const executeUpdate = async (id: string, userId?: string, slotsValue: string[] | null = null) => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('servidores_eventos')
        .update({
          servidor_id: selectedServidor,
          tipo_evento_id: selectedTipo,
          data_inicio: startDate,
          data_fim: endDate,
          observacao: observacao || null,
          slots: slotsValue,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)

      if (error) throw error

      const serverName = servidores.find(s => s.id === selectedServidor)?.nome || 'Servidor'
      const typeName = tiposEventos.find(t => t.id === selectedTipo)?.nome || 'Afastamento'

      logAction('EDITAR_AFASTAMENTO', {
        afastamento_id: id,
        servidor_id: selectedServidor,
        servidor_nome: serverName,
        tipo_afastamento: typeName,
        data_inicio: startDate,
        data_fim: endDate,
        slots: slotsValue
      })

      cancelEditing()
      await fetchAfastamentos()

      setAlertModal({
        isOpen: true,
        title: 'Atualizado com Sucesso',
        message: `O afastamento de ${serverName} foi atualizado. As escalas vigentes e planejadas foram atualizadas automaticamente.`,
        type: 'success'
      })

    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro ao Atualizar',
        message: error.message,
        type: 'danger'
      })
    } finally {
      setSaving(false)
      setConfirmModal(null)
    }
  }

  const handleUpdateAfastamento = async () => {
    if (!editingId) return
    if (!selectedServidor || !selectedTipo || !startDate || !endDate) {
      setAlertModal({
        isOpen: true,
        title: 'Campos Obrigatórios',
        message: 'Por favor, preencha todos os campos do formulário.',
        type: 'warning'
      })
      return
    }

    const start = new Date(startDate + 'T00:00:00')
    const end = new Date(endDate + 'T00:00:00')

    if (end < start) {
      setAlertModal({
        isOpen: true,
        title: 'Período Inválido',
        message: 'A data de término não pode ser anterior à data de início.',
        type: 'warning'
      })
      return
    }

    setSaving(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()

      let slotsValue: string[] | null = null
      if (selectedPeriodo === 'M') slotsValue = ['M']
      else if (selectedPeriodo === 'T') slotsValue = ['T']
      else if (selectedPeriodo === 'N') slotsValue = ['N']
      else if (selectedPeriodo === 'custom') slotsValue = customSlots.length > 0 ? customSlots : null
      
      // 1. Validar se o servidor possui alguma escala prevista no período com conflito de slots
      const { data: monthlyScales } = await supabase
        .from('escala_mensal')
        .select('id, mes, ano')
        .eq('servidor_id', selectedServidor)

      if (monthlyScales && monthlyScales.length > 0) {
        const ids = monthlyScales.map(m => m.id)
        const { data: dailies } = await supabase
          .from('escala_diaria')
          .select('id, dia, escala_mensal_id, dicionario_turnos(slots), presenca_entrada_em, presenca_saida_em, presenca_confirmada, confirmado_por_id')
          .in('escala_mensal_id', ids)

        if (dailies && dailies.length > 0) {
          const conflictingDailies = dailies.filter(d => {
            const mScale = monthlyScales.find(m => m.id === d.escala_mensal_id)
            if (!mScale) return false
            const dayDate = new Date(mScale.ano, mScale.mes - 1, d.dia)
            const dateMatch = dayDate >= start && dayDate <= end
            if (!dateMatch) return false

            if (!slotsValue || slotsValue.length === 0) return true
            const shiftSlots = (d.dicionario_turnos as any)?.slots || []
            return shiftSlots.some((s: string) => slotsValue!.includes(s))
          })

          if (conflictingDailies.length > 0) {
            const hasConfirmedOrMarked = conflictingDailies.some(d => 
              d.presenca_entrada_em !== null || 
              d.presenca_saida_em !== null || 
              d.presenca_confirmada === true || 
              d.confirmado_por_id !== null
            )

            if (hasConfirmedOrMarked) {
              setSaving(false)
              setAlertModal({
                isOpen: true,
                title: '⚠️ Conflito de Escala Confirmada',
                message: 'Não é permitido alterar o afastamento para este período pois o servidor possui escala confirmada ou com marcações de presença reais na grade. O coordenador deve intervir pessoalmente.',
                type: 'warning'
              })
              return
            }

            // Caso sejam apenas previsões, solicita a confirmação do usuário
            setSaving(false)
            setConfirmModal({
              isOpen: true,
              title: 'Substituir Previsões de Escala?',
              message: 'Detectamos previsões de escala para este servidor no período selecionado. Elas serão substituídas automaticamente pelo lançamento do afastamento. Deseja prosseguir?',
              type: 'warning',
              onConfirm: () => {
                setConfirmModal(null)
                executeUpdate(editingId, user?.id, slotsValue)
              }
            })
            return
          }
        }
      }

      await executeUpdate(editingId, user?.id, slotsValue)

    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro de Validação',
        message: error.message,
        type: 'danger'
      })
      setSaving(false)
    }
  }

  // Effect to reset page when search/filters change
  useEffect(() => {
    setPage(1)
  }, [searchTerm, filterUnidade, filterSetor, filterTipo, filterMes, filterAno])

  // Filter list of absences based on UI search/filters and permissions
  const filteredAfastamentos = useMemo(() => {
    const filterMesVal = filterMes !== 'todos' ? parseInt(filterMes) : null
    const filterAnoVal = filterAno !== 'todos' ? parseInt(filterAno) : null
    
    const monthStart = filterMesVal && filterAnoVal ? new Date(filterAnoVal, filterMesVal - 1, 1) : null
    const monthEnd = filterMesVal && filterAnoVal ? new Date(filterAnoVal, filterMesVal, 0) : null

    return afastamentos.filter(a => {
      // Verificar acesso do usuário logado (segurança adicional)
      if (profile && profile.role !== 'super_admin') {
        const hasAccess = hasSectorAccess(profile, a.servidores?.setor_id || '', a.servidores?.unidade_id)
        if (!hasAccess) return false
      }

      const term = searchTerm.toLowerCase()
      const nameMatches = (a.servidores?.nome || '').toLowerCase().includes(term)
      const matMatches = (a.servidores?.matricula || '').toLowerCase().includes(term)
      
      const unitMatches = filterUnidade === 'todas' || a.servidores?.unidade_id === filterUnidade
      const sectorMatches = filterSetor === 'todos' || a.servidores?.setor_id === filterSetor
      const tipoMatches = filterTipo === 'todos' || a.tipo_evento_id === filterTipo

      let periodMatches = true
      if (monthStart && monthEnd) {
        const start = new Date(a.data_inicio + 'T00:00:00')
        const end = new Date(a.data_fim + 'T00:00:00')
        periodMatches = start <= monthEnd && end >= monthStart
      } else if (filterAnoVal) {
        // If only year is selected
        const startYear = new Date(a.data_inicio + 'T00:00:00').getFullYear()
        const endYear = new Date(a.data_fim + 'T00:00:00').getFullYear()
        periodMatches = filterAnoVal >= startYear && filterAnoVal <= endYear
      }

      return (nameMatches || matMatches) && unitMatches && sectorMatches && tipoMatches && periodMatches
    })
  }, [afastamentos, profile, searchTerm, filterUnidade, filterSetor, filterTipo, filterMes, filterAno])

  // Paginated absences calculation
  const totalCount = filteredAfastamentos.length
  const totalPages = Math.ceil(totalCount / pageSize)
  
  const paginatedAfastamentos = useMemo(() => {
    const from = (page - 1) * pageSize
    const to = from + pageSize
    return filteredAfastamentos.slice(from, to)
  }, [filteredAfastamentos, page, pageSize])

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

  const isAllSelected = paginatedAfastamentos.length > 0 && paginatedAfastamentos.every(a => selectedIds.has(a.id))

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      paginatedAfastamentos.forEach(a => {
        if (checked) {
          next.add(a.id)
        } else {
          next.delete(a.id)
        }
      })
      return next
    })
  }

  // PDF Generator in A4 portrait
  const handleGeneratePDF = () => {
    setIsGeneratingPDF(true)
    try {
      const absencesToPrint = selectedIds.size > 0 
        ? filteredAfastamentos.filter(a => selectedIds.has(a.id))
        : filteredAfastamentos

      if (absencesToPrint.length === 0) {
        alert("Nenhum afastamento selecionado ou na lista filtrada para gerar o PDF.")
        setIsGeneratingPDF(false)
        return
      }

      const reportTitle = "Relatório de Afastamentos"
      const generationDate = new Date().toLocaleString('pt-BR')
      
      const unidadeName = filterUnidade !== 'todas' 
        ? unidades.find(u => u.id === filterUnidade)?.nome 
        : 'Todas'
      const setorName = filterSetor !== 'todos'
        ? setores.find(s => s.id === filterSetor)?.nome 
        : 'Todos'
      const motivoName = filterTipo !== 'todos'
        ? tiposEventos.find(t => t.id === filterTipo)?.nome
        : 'Todos'
      const searchDescription = searchTerm ? `"${searchTerm}"` : 'Nenhum'

      const tableRows = absencesToPrint.map((a) => {
        const periodSlots = (!a.slots || a.slots.length === 0) ? 'Dia Inteiro' : `Períodos: ${a.slots.join(', ')}`
        const dateInicio = new Date(a.data_inicio + 'T00:00:00').toLocaleDateString('pt-BR')
        const dateFim = new Date(a.data_fim + 'T00:00:00').toLocaleDateString('pt-BR')
        
        return `
          <tr class="border-b border-zinc-200">
            <td class="py-3 px-3 text-[10px] font-bold text-zinc-950 uppercase">
              ${a.servidores?.nome || '---'}
              <div class="text-[8px] text-zinc-500 font-normal mt-0.5">Matrícula: ${a.servidores?.matricula || '---'}</div>
            </td>
            <td class="py-3 px-3 text-[10px] text-zinc-800">
              <div class="font-medium">${a.servidores?.unidades?.nome || 'Sem Unidade'}</div>
              <div class="text-[8px] text-blue-600 font-bold mt-0.5">${a.servidores?.setores?.dicionario_setores?.nome || '---'}</div>
            </td>
            <td class="py-3 px-3 text-[10px] text-zinc-800">
              <span class="inline-block px-2 py-0.5 rounded text-[8px] font-bold text-white uppercase" style="background-color: ${a.tipos_eventos?.cor || '#EF4444'}">
                ${a.tipos_eventos?.nome || '---'}
              </span>
              <div class="text-[8px] text-zinc-500 font-normal mt-0.5">${periodSlots}</div>
            </td>
            <td class="py-3 px-3 text-[10px] text-zinc-800 font-bold whitespace-nowrap">
              De: ${dateInicio}<br/>Até: ${dateFim}
            </td>
            <td class="py-3 px-3 text-[9px] text-zinc-500 italic max-w-[200px] break-words">
              ${a.observacao || 'Sem observações'}
            </td>
          </tr>
        `
      }).join('')

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
                <p class="text-zinc-400 text-xs uppercase font-bold tracking-widest">Relatório de Afastamentos</p>
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
                  <p class="text-zinc-500 text-xs font-medium">Controle de ausências e afastamentos cadastrados</p>
                </div>
                <div class="text-right">
                  <p class="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Emissão</p>
                  <p class="text-sm font-bold text-zinc-900">${generationDate}</p>
                </div>
              </div>

              <div class="grid grid-cols-4 gap-4 mb-6 bg-zinc-50 p-4 rounded-xl border border-zinc-100 text-xs">
                <div>
                  <p class="text-[9px] font-black text-zinc-400 uppercase">Unidade / Setor</p>
                  <p class="font-bold text-zinc-800">${unidadeName} / ${setorName}</p>
                </div>
                <div>
                  <p class="text-[9px] font-black text-zinc-400 uppercase">Motivo</p>
                  <p class="font-bold text-zinc-800">${motivoName}</p>
                </div>
                <div>
                  <p class="text-[9px] font-black text-zinc-400 uppercase">Busca</p>
                  <p class="font-bold text-zinc-800 truncate">${searchDescription}</p>
                </div>
                <div>
                  <p class="text-[9px] font-black text-zinc-400 uppercase">Total Registros</p>
                  <p class="font-bold text-zinc-800">${absencesToPrint.length}</p>
                </div>
              </div>

              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="bg-zinc-100 border-y-2 border-zinc-900">
                    <th class="py-2.5 px-3 text-[9px] font-black uppercase text-zinc-700">Servidor</th>
                    <th class="py-2.5 px-3 text-[9px] font-black uppercase text-zinc-700">Unidade / Setor</th>
                    <th class="py-2.5 px-3 text-[9px] font-black uppercase text-zinc-700">Afastamento</th>
                    <th class="py-2.5 px-3 text-[9px] font-black uppercase text-zinc-700">Período</th>
                    <th class="py-2.5 px-3 text-[9px] font-black uppercase text-zinc-700">Observações</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-zinc-200">
                  ${tableRows}
                </tbody>
              </table>

              <div class="mt-8 pt-4 border-t border-zinc-200 flex justify-between items-center text-[8px] text-zinc-400 uppercase font-bold tracking-widest">
                <span>SisEscala - Gestão Inteligente de Escalas</span>
                <span>Total de Afastamentos: ${absencesToPrint.length}</span>
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
    } catch (error) {
      console.error('Erro ao gerar relatório:', error)
      alert('Ocorreu um erro ao gerar o PDF/Impressão.')
    } finally {
      setIsGeneratingPDF(false)
    }
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-24">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Gestão de Afastamentos</h1>
          <p className="mt-1 text-zinc-500 text-sm italic">Registre e gerencie ausências autorizadas, bloqueando escalas conflitantes em tempo real.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form panel */}
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm h-fit">
          <h2 className={`text-sm font-black uppercase tracking-widest mb-6 flex items-center ${editingId ? 'text-amber-600' : 'text-red-600'}`}>
            {editingId ? (
              <>
                <Edit2 className="mr-2 h-5 w-5" /> Editar Afastamento
              </>
            ) : (
              <>
                <Plus className="mr-2 h-5 w-5" /> Registrar Afastamento
              </>
            )}
          </h2>
          
          <div className="space-y-5">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Unidade</label>
              <select
                value={selectedUnidade}
                onChange={e => {
                  setSelectedUnidade(e.target.value)
                  setSelectedSetor('')
                }}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm"
              >
                <option value="">Selecione a Unidade</option>
                {unidades.map(u => (
                  <option key={u.id} value={u.id}>{u.nome}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Setor</label>
              <select
                value={selectedSetor}
                disabled={!selectedUnidade}
                onChange={e => setSelectedSetor(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm disabled:opacity-50"
              >
                <option value="">Selecione o Setor</option>
                {setores
                  .filter(s => s.unidade_id === selectedUnidade)
                  .map(s => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Servidor</label>
              <select
                value={selectedServidor}
                disabled={!selectedSetor}
                onChange={e => setSelectedServidor(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm disabled:opacity-50"
              >
                <option value="">Selecione o Servidor</option>
                {servidores.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.nome} {s.matricula ? `(${s.matricula})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Tipo de Afastamento</label>
              <select
                value={selectedTipo}
                onChange={e => setSelectedTipo(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm"
              >
                <option value="">Selecione o Tipo</option>
                {tiposEventos.map(t => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Período do Afastamento</label>
              <select
                value={selectedPeriodo}
                onChange={e => {
                  const val = e.target.value as any
                  setSelectedPeriodo(val)
                  if (val === 'integral') setCustomSlots([])
                  else if (val === 'M') setCustomSlots(['M'])
                  else if (val === 'T') setCustomSlots(['T'])
                  else if (val === 'N') setCustomSlots(['N'])
                  else setCustomSlots(['M', 'T'])
                }}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm mb-1"
              >
                <option value="integral">Dia Inteiro (Integral)</option>
                <option value="M">Meio Período - Manhã (M)</option>
                <option value="T">Meio Período - Tarde (T)</option>
                <option value="N">Meio Período - Noite (N)</option>
                <option value="custom">Personalizado (Múltiplos Períodos)</option>
              </select>
            </div>

            {selectedPeriodo === 'custom' && (
              <div className="bg-zinc-50 dark:bg-zinc-800/40 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-3">
                <span className="block text-[10px] font-black uppercase tracking-widest text-zinc-500">Selecione os Turnos/Períodos</span>
                <div className="flex gap-4">
                  {['M', 'T', 'N'].map(slot => {
                    const label = slot === 'M' ? 'Manhã' : slot === 'T' ? 'Tarde' : 'Noite'
                    return (
                      <label key={slot} className="flex items-center gap-2 text-xs font-bold cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={customSlots.includes(slot)}
                          onChange={e => {
                            if (e.target.checked) {
                              setCustomSlots(prev => [...prev, slot])
                            } else {
                              setCustomSlots(prev => prev.filter(s => s !== slot))
                            }
                          }}
                          className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                        />
                        {label} ({slot})
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Data Início</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Data Fim</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Observações / Detalhes</label>
              <textarea
                placeholder="Ex: Atestado médico de 5 dias homologado pelo setor de RH."
                value={observacao}
                onChange={e => setObservacao(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm resize-none"
              />
            </div>

            {editingId ? (
              <div className="flex gap-2">
                <button
                  onClick={handleUpdateAfastamento}
                  disabled={saving || !selectedServidor || !selectedTipo || !startDate || !endDate}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-black uppercase tracking-widest py-3 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 shadow-lg shadow-amber-600/20 cursor-pointer"
                >
                  {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Salvar'}
                </button>
                <button
                  onClick={cancelEditing}
                  disabled={saving}
                  className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-black uppercase tracking-widest px-4 py-3 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={handleAddAfastamento}
                disabled={saving || !selectedServidor || !selectedTipo || !startDate || !endDate}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-black uppercase tracking-widest py-3 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 shadow-lg shadow-red-600/20 cursor-pointer"
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Confirmar Afastamento'}
              </button>
            )}
          </div>
        </div>

        {/* List panel */}
        <div className="lg:col-span-2 space-y-6">
          {/* List Filters */}
          <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input 
                type="text" 
                placeholder="Buscar por servidor ou matrícula..."
                className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-zinc-400" />
              <select 
                className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                value={filterUnidade}
                onChange={(e) => {
                  setFilterUnidade(e.target.value)
                  setFilterSetor('todos')
                }}
              >
                <option value="todas">Todas as Unidades</option>
                {unidades.map(u => (
                  <option key={u.id} value={u.id}>{u.nome}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-zinc-400" />
              <select 
                className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                value={filterSetor}
                onChange={(e) => setFilterSetor(e.target.value)}
              >
                <option value="todos">Todos os Setores</option>
                {setores
                  .filter(s => filterUnidade === 'todas' || s.unidade_id === filterUnidade)
                  .map(s => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-zinc-400" />
              <select 
                className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                value={filterTipo}
                onChange={(e) => setFilterTipo(e.target.value)}
              >
                <option value="todos">Todos os Motivos</option>
                {tiposEventos.map(t => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-zinc-400" />
              <select 
                className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                value={filterMes}
                onChange={(e) => setFilterMes(e.target.value)}
              >
                {meses.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <select 
                className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                value={filterAno}
                onChange={(e) => setFilterAno(e.target.value)}
              >
                {anos.map(a => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>

            <button
              onClick={handleGeneratePDF}
              disabled={isGeneratingPDF}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl px-4 py-2.5 text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-blue-500/20 cursor-pointer ml-auto"
            >
              {isGeneratingPDF ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              {selectedIds.size > 0 ? `Imprimir Selecionados (${selectedIds.size})` : 'Imprimir Todos'}
            </button>
          </div>

          {/* List Table */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                  <tr>
                    <th className="px-6 py-4 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={e => handleSelectAll(e.target.checked)}
                        className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Servidor</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Localização</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Afastamento</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Período</th>
                    <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 w-24">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-20 text-center">
                        <Loader2 className="h-10 w-10 animate-spin mx-auto text-blue-500 opacity-50" />
                      </td>
                    </tr>
                  ) : paginatedAfastamentos.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-20 text-center text-zinc-500">
                        <CalendarIcon className="mx-auto h-12 w-12 opacity-10 mb-4" />
                        <p className="text-sm font-bold uppercase tracking-tight">Nenhum afastamento encontrado</p>
                        <p className="text-xs mt-1">Tente ajustar seus filtros ou registre um afastamento ao lado.</p>
                      </td>
                    </tr>
                  ) : (
                    paginatedAfastamentos.map(a => (
                      <tr 
                        key={a.id} 
                        className={`transition-colors ${
                          editingId === a.id 
                            ? 'bg-amber-50/40 dark:bg-amber-950/10 border-l-4 border-l-amber-500' 
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
                        }`}
                      >
                        <td className="px-6 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(a.id)}
                            onChange={e => handleSelectRow(a.id, e.target.checked)}
                            className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 font-bold shrink-0">
                              <Users className="h-4 w-4" />
                            </div>
                            <div>
                              <div className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                                {a.servidores?.nome}
                              </div>
                              <div className="text-[10px] text-zinc-400 font-mono">
                                Matrícula: {a.servidores?.matricula || 'N/A'}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="text-xs font-bold text-zinc-900 dark:text-white">
                            {a.servidores?.unidades?.nome}
                          </div>
                          <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                            <Layers className="h-3 w-3" />
                            {a.servidores?.setores?.dicionario_setores?.nome}
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <span 
                            className="inline-flex px-2.5 py-1 text-[9px] font-black uppercase rounded-full text-white shadow-sm"
                            style={{ backgroundColor: a.tipos_eventos?.cor || '#EF4444' }}
                          >
                            {a.tipos_eventos?.nome}
                          </span>
                          <div className="mt-1 flex flex-wrap gap-1 items-center">
                            <span className="text-[9px] font-bold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/80 px-1.5 py-0.5 rounded">
                              {(!a.slots || a.slots.length === 0) ? 'Dia Inteiro' : `Período: ${a.slots.join(', ')}`}
                            </span>
                          </div>
                          {a.observacao && (
                            <span 
                              className="block text-[10px] text-zinc-400 italic max-w-[200px] truncate mt-1"
                              title={a.observacao}
                            >
                              {a.observacao}
                            </span>
                          )}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-xs font-black text-zinc-700 dark:text-zinc-300">
                            De: {new Date(a.data_inicio + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </div>
                          <div className="text-xs font-black text-zinc-700 dark:text-zinc-300">
                            Até: {new Date(a.data_fim + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </div>
                        </td>

                        <td className="px-6 py-4 text-center whitespace-nowrap">
                          <div className="flex justify-center items-center gap-2">
                            {editingId === a.id ? (
                              <span className="text-[10px] font-black uppercase text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-md">
                                Editando
                              </span>
                            ) : (
                              <button
                                onClick={() => startEditing(a)}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all cursor-pointer"
                                title="Editar afastamento"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
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
      </div>

      {/* Alert modal */}
      <Modal
        isOpen={alertModal.isOpen}
        onClose={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
        title={alertModal.title}
        type={alertModal.type as any}
        footer={
          <button
            onClick={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
            className="w-full px-4 py-2 rounded-xl bg-zinc-900 dark:bg-white dark:text-zinc-900 text-white font-bold"
          >
            Entendido
          </button>
        }
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{alertModal.message}</p>
      </Modal>

      {/* Confirm modal */}
      {confirmModal && (
        <Modal
          isOpen={confirmModal.isOpen}
          onClose={() => setConfirmModal(null)}
          title={confirmModal.title}
          type={confirmModal.type as any}
          footer={
            <>
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className={`flex-1 px-4 py-2 rounded-xl text-white font-bold ${
                  confirmModal.type === 'danger' ? 'bg-red-600 hover:bg-red-700' : 
                  confirmModal.type === 'warning' ? 'bg-amber-600 hover:bg-amber-700' : 
                  'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                Confirmar
              </button>
            </>
          }
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{confirmModal.message}</p>
        </Modal>
      )}
    </div>
  )
}
