'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import { 
  Plus, Calendar as CalendarIcon, Loader2, Trash2, 
  Search, AlertTriangle, Building2, Layers, Users, Tag, Info, Edit2
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { applyAccessFilters, hasSectorAccess } from '@/utils/permissions'

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

  // Search & List Filters
  const [searchTerm, setSearchTerm] = useState('')
  const [filterUnidade, setFilterUnidade] = useState('todas')

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
      setSetores(sectors)

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
      
      // 1. Validar conflito de presenças já confirmadas
      const { data: monthlyScales } = await supabase
        .from('escala_mensal')
        .select('id, mes, ano')
        .eq('servidor_id', selectedServidor)

      if (monthlyScales && monthlyScales.length > 0) {
        const ids = monthlyScales.map(m => m.id)
        const { data: dailies } = await supabase
          .from('escala_diaria')
          .select('id, dia, escala_mensal_id, presenca_entrada_em, presenca_saida_em')
          .in('escala_mensal_id', ids)
          .or('presenca_entrada_em.not.is.null,presenca_saida_em.not.is.null')

        if (dailies && dailies.length > 0) {
          const hasPresenceConflict = dailies.some(d => {
            const mScale = monthlyScales.find(m => m.id === d.escala_mensal_id)
            if (!mScale) return false
            const dayDate = new Date(mScale.ano, mScale.mes - 1, d.dia)
            return dayDate >= start && dayDate <= end
          })

          if (hasPresenceConflict) {
            setSaving(false)
            setConfirmModal({
              isOpen: true,
              title: 'Presença Confirmada Detectada',
              message: 'O servidor possui registros de presença confirmados neste período. Se prosseguir, estes registros de presença serão mantidos, mas novos turnos serão bloqueados e turnos planejados não confirmados serão removidos. Deseja continuar?',
              type: 'warning',
              onConfirm: () => executeInsertion(user?.id)
            })
            return
          }
        }
      }

      await executeInsertion(user?.id)

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
  const executeInsertion = async (userId?: string) => {
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
          criado_por: userId || null
        })

      if (error) throw error

      const serverName = servidores.find(s => s.id === selectedServidor)?.nome || 'Servidor'
      const typeName = tiposEventos.find(t => t.id === selectedTipo)?.nome || 'Afastamento'

      logAction('CADASTRAR_AFASTAMENTO', {
        servidor_id: selectedServidor,
        servidor_nome: serverName,
        tipo_afastamento: typeName,
        data_inicio: startDate,
        data_fim: endDate
      })

      setStartDate('')
      setEndDate('')
      setObservacao('')
      setSelectedServidor('')

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
  }

  const executeUpdate = async (id: string, userId?: string) => {
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
        data_fim: endDate
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
      
      // 1. Validar conflito de presenças já confirmadas
      const { data: monthlyScales } = await supabase
        .from('escala_mensal')
        .select('id, mes, ano')
        .eq('servidor_id', selectedServidor)

      if (monthlyScales && monthlyScales.length > 0) {
        const ids = monthlyScales.map(m => m.id)
        const { data: dailies } = await supabase
          .from('escala_diaria')
          .select('id, dia, escala_mensal_id, presenca_entrada_em, presenca_saida_em')
          .in('escala_mensal_id', ids)
          .or('presenca_entrada_em.not.is.null,presenca_saida_em.not.is.null')

        if (dailies && dailies.length > 0) {
          const hasPresenceConflict = dailies.some(d => {
            const mScale = monthlyScales.find(m => m.id === d.escala_mensal_id)
            if (!mScale) return false
            const dayDate = new Date(mScale.ano, mScale.mes - 1, d.dia)
            return dayDate >= start && dayDate <= end
          })

          if (hasPresenceConflict) {
            setSaving(false)
            setConfirmModal({
              isOpen: true,
              title: 'Presença Confirmada Detectada',
              message: 'O servidor possui registros de presença confirmados neste período. Se prosseguir, estes registros de presença serão mantidos, mas novos turnos serão bloqueados e turnos planejados não confirmados serão removidos. Deseja continuar?',
              type: 'warning',
              onConfirm: () => executeUpdate(editingId, user?.id)
            })
            return
          }
        }
      }

      await executeUpdate(editingId, user?.id)

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

  // Filter list of absences based on UI search/filters and permissions
  const filteredAfastamentos = afastamentos.filter(a => {
    // Verificar acesso do usuário logado (segurança adicional)
    if (profile && profile.role !== 'super_admin') {
      const hasAccess = hasSectorAccess(profile, a.servidores?.setor_id || '', a.servidores?.unidade_id)
      if (!hasAccess) return false
    }

    const term = searchTerm.toLowerCase()
    const nameMatches = (a.servidores?.nome || '').toLowerCase().includes(term)
    const matMatches = (a.servidores?.matricula || '').toLowerCase().includes(term)
    const unitMatches = filterUnidade === 'todas' || a.servidores?.unidades?.nome === filterUnidade

    return (nameMatches || matMatches) && unitMatches
  })

  // Get list of unique units in the database (for filter dropdown)
  const uniqueUnits = Array.from(new Set(
    afastamentos
      .filter(a => {
        if (profile && profile.role !== 'super_admin') {
          return hasSectorAccess(profile, a.servidores?.setor_id || '', a.servidores?.unidade_id)
        }
        return true
      })
      .map(a => a.servidores?.unidades?.nome)
      .filter(Boolean)
  ))

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
                onChange={(e) => setFilterUnidade(e.target.value)}
              >
                <option value="todas">Todas as Unidades</option>
                {uniqueUnits.map(unit => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
            </div>
          </div>

          {/* List Table */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                  <tr>
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
                      <td colSpan={5} className="px-6 py-20 text-center">
                        <Loader2 className="h-10 w-10 animate-spin mx-auto text-blue-500 opacity-50" />
                      </td>
                    </tr>
                  ) : filteredAfastamentos.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-20 text-center text-zinc-500">
                        <CalendarIcon className="mx-auto h-12 w-12 opacity-10 mb-4" />
                        <p className="text-sm font-bold uppercase tracking-tight">Nenhum afastamento encontrado</p>
                        <p className="text-xs mt-1">Tente ajustar seus filtros ou registre um afastamento ao lado.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredAfastamentos.map(a => (
                      <tr 
                        key={a.id} 
                        className={`transition-colors ${
                          editingId === a.id 
                            ? 'bg-amber-50/40 dark:bg-amber-950/10 border-l-4 border-l-amber-500' 
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
                        }`}
                      >
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
