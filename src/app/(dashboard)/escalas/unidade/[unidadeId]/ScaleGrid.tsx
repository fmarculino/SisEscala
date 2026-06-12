'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import { 
  Save, Loader2, Info, Zap, Lock, Unlock, FileText, Plus, UserPlus, Users, 
  CheckCircle, Trash2, Globe, X, Copy, Check, Clock, Navigation2,
  ShieldCheck, ShieldAlert, AlertTriangle, LayoutTemplate,
  ChevronLeft, ChevronRight
} from 'lucide-react'
import { ScalePrintView } from '@/components/ScalePrintView'
import { Modal } from '@/components/ui/Modal'
import React from 'react'
import { canEditScale, UserRole } from '@/utils/governance'
import { runComplianceCheck, getViolationsForCell, type ComplianceViolation } from '@/utils/complianceEngine'
import { generateTemplate, TEMPLATE_OPTIONS, type TemplateType, countWorkDays } from '@/utils/scaleTemplates'
import { SwapRequestPanel } from '@/components/SwapRequestPanel'

interface ScaleGridProps {
  unidadeId: string
  setorId: string
  mes: number
  ano: number
  todosServidoresSetor: any[]
  turnos: any[]
  escalaMensalInicial: any[]
  escalaDiariaInicial: any[]
  feriados: any[]
  diasInativacao: number
  logsSobreavisoInicial: any[]
  configsGlobais: any[]
  userProfile: any
}

type RowCategory = 'Regular' | 'Extra' | 'Plantão' | 'Sobreaviso'

export function ScaleGrid({
  unidadeId,
  setorId,
  mes,
  ano,
  todosServidoresSetor,
  turnos,
  escalaMensalInicial,
  escalaDiariaInicial,
  feriados = [],
  diasInativacao,
  logsSobreavisoInicial,
  configsGlobais,
  userProfile
}: ScaleGridProps) {
  // Initialize Supabase client once
  const [supabase] = useState(() => createClient())
  const [loading, setLoading] = useState(false)
  const [isTotalsCollapsed, setIsTotalsCollapsed] = useState(false)
  const [servidoresEventos, setServidoresEventos] = useState<any[]>([])

  const fetchServidoresEventos = useCallback(async () => {
    if (escalaMensalInicial.length === 0) return
    const servantIds = escalaMensalInicial.map(em => em.servidor_id)
    const lastDay = new Date(ano, mes, 0).getDate()
    const startRange = `${ano}-${mes.toString().padStart(2, '0')}-01`
    const endRange = `${ano}-${mes.toString().padStart(2, '0')}-${lastDay}`

    const { data, error } = await supabase
      .from('servidores_eventos')
      .select('*, tipos_eventos(*)')
      .in('servidor_id', servantIds)
      .or(`data_inicio.lte.${endRange},data_fim.gte.${startRange}`)

    if (error) {
      console.error('Erro ao buscar eventos dos servidores:', error)
    } else {
      setServidoresEventos(data || [])
    }
  }, [supabase, escalaMensalInicial, mes, ano])

  useEffect(() => {
    fetchServidoresEventos()
  }, [escalaMensalInicial, fetchServidoresEventos])

  const getActiveEventForDay = useCallback((servidorId: string, day: number) => {
    const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    return servidoresEventos.find(se => 
      se.servidor_id === servidorId && 
      dateStr >= se.data_inicio && 
      dateStr <= se.data_fim
    )
  }, [servidoresEventos, mes, ano])

  useEffect(() => {
    const saved = localStorage.getItem('scale-totals-collapsed')
    if (saved !== null) {
      setIsTotalsCollapsed(saved === 'true')
    }
  }, [])

  const toggleTotals = useCallback(() => {
    setIsTotalsCollapsed(prev => {
      const newVal = !prev
      localStorage.setItem('scale-totals-collapsed', String(newVal))
      return newVal
    })
  }, [])

  const logAction = useCallback(async (acao: string, detalhes: any = {}) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await supabase.from('logs_sistema').insert({
        user_id: user.id,
        acao,
        detalhes: {
          ...detalhes,
          mes,
          ano,
          setor_id: setorId,
          unidade_id: unidadeId
        },
        unidade_id: unidadeId,
        setor_id: setorId
      })
    } catch (error) {
      console.error('Erro ao registrar log:', error)
    }
  }, [supabase, mes, ano, setorId, unidadeId])
  const [escalaMensal, setEscalaMensal] = useState(escalaMensalInicial)
  const [logsSobreaviso, setLogsSobreaviso] = useState(logsSobreavisoInicial)
  const [linkedServidorId, setLinkedServidorId] = useState<string | null>(null)

  useEffect(() => {
    async function findServidor() {
      if (userProfile?.role === 'comum' || userProfile?.role === 'servidor') {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: serv } = await supabase
            .from('servidores')
            .select('id')
            .eq('email', user.email)
            .single()
          if (serv) setLinkedServidorId(serv.id)
        }
      }
    }
    findServidor()
  }, [userProfile, supabase])
  
  const configs = useMemo(() => {
    const obj: Record<string, string> = {}
    configsGlobais.forEach(c => {
      obj[c.chave] = String(c.valor)
    })
    return obj
  }, [configsGlobais])

  const desconsiderarFalha = configs['sobreaviso_desconsiderar_falha'] === 'true'
  const permitirValidacaoManual = configs['sobreaviso_permitir_validacao_manual'] === 'true'
  const [triggerModal, setTriggerModal] = useState<{
    isOpen: boolean;
    servidorId: string;
    servidorNome: string;
    turnoId: string;
    escalaMensalId: string;
    dia: number;
  } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [allUnidades, setAllUnidades] = useState<any[]>([])
  const [allSetores, setAllSetores] = useState<any[]>([])
  const [isExternalModalOpen, setIsExternalModalOpen] = useState(false)
  const [jornadas, setJornadas] = useState<any[]>([])
  const [externalData, setExternalData] = useState({
    unidadeId: '',
    setorId: '',
    servidorId: ''
  })
  const [externalSectors, setExternalSectors] = useState<any[]>([])
  const [externalServers, setExternalServers] = useState<any[]>([])
  const [currentSector, setCurrentSector] = useState<any>(null)

  // Modal & Alert states
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
    type: 'default' | 'danger' | 'warning' | 'success'
  } | null>(null)
  
  const [manualPresenceModal, setManualPresenceModal] = useState<{
    isOpen: boolean;
    servidorId: string;
    servidorNome: string;
    dia: number;
    categoria: RowCategory;
    tipo: 'entrada' | 'saida';
    escalaMensalId: string;
    isReverting: boolean;
  } | null>(null)
  const [externalOccupancy, setExternalOccupancy] = useState<any[]>([])

  // Template Modal State
  const [templateModal, setTemplateModal] = useState<{
    isOpen: boolean
    servidorId: string
    templateType: TemplateType
    turnoId: string
    startDay: number
    startWorking: boolean
  } | null>(null)

  const fetchOccupancy = useCallback(async (servidorIds: string[]) => {
    if (servidorIds.length === 0) return
    const { data, error } = await supabase.rpc('fn_get_monthly_occupancy', {
      p_servidor_ids: servidorIds,
      p_mes: mes,
      p_ano: ano
    })
    if (data) setExternalOccupancy(data)
    if (error) console.error('Erro ao buscar ocupação externa:', error)
  }, [supabase, mes, ano])

  useEffect(() => {
    if (escalaMensal.length > 0) {
      const ids = escalaMensal.map(em => em.servidor_id)
      fetchOccupancy(ids)
    }
  }, [escalaMensal, fetchOccupancy])

  useEffect(() => {
    const fetchData = async () => {
      // Fetch all units and sectors for external server logic
      const { data: units } = await supabase.from('unidades').select('*').eq('ativo', true).order('nome')
      const { data: sectorsRaw } = await supabase.from('setores').select('*, dicionario_setores(nome)').eq('ativo', true)
      const sectors = sectorsRaw?.map(s => ({
        ...s,
        nome: (s as any).dicionario_setores?.nome || 'SETOR SEM NOME'
      })) || []
      const { data: journeys } = await supabase.from('jornadas').select('*').order('nome')
      if (units) setAllUnidades(units)
      setAllSetores(sectors)
      if (journeys) setJornadas(journeys)

      // Fetch specific sector info for dimensioning rules
      const { data: currentSec } = await supabase.from('setores').select('*').eq('id', setorId).single()
      if (currentSec) setCurrentSector(currentSec)
    }
    fetchData()
  }, [supabase, setorId])

  // Fetch sectors when unit changes in modal
  useEffect(() => {
    if (externalData.unidadeId) {
      const filtered = allSetores.filter(s => s.unidade_id === externalData.unidadeId)
      setExternalSectors(filtered)
      setExternalData(prev => ({ ...prev, setorId: '', servidorId: '' }))
    }
  }, [externalData.unidadeId, allSetores])

  // Fetch servers when sector changes in modal
  useEffect(() => {
    const fetchExtServers = async () => {
      if (externalData.setorId) {
        const { data } = await supabase
          .rpc('get_external_servers_for_scale', { p_setor_id: externalData.setorId })
        setExternalServers(data || [])
        setExternalData(prev => ({ ...prev, servidorId: '' }))
      }
    }
    fetchExtServers()
  }, [externalData.setorId, supabase])
  
  // Realtime subscription for logs_sobreaviso
  useEffect(() => {
    const channel = supabase
      .channel('logs_sobreaviso_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'logs_sobreaviso'
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setLogsSobreaviso((prev: any[]) => [...prev, payload.new])
        } else if (payload.eventType === 'UPDATE') {
          setLogsSobreaviso((prev: any[]) => prev.map(log => 
            log.id === payload.new.id ? payload.new : log
          ))
        } else if (payload.eventType === 'DELETE') {
          setLogsSobreaviso((prev: any[]) => prev.filter(log => log.id !== payload.old.id))
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  // Realtime subscription for escala_diaria (presence updates)
  useEffect(() => {
    const channel = supabase
      .channel('escala_diaria_presence')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'escala_diaria'
      }, (payload) => {
        // Find which server/category/day this belongs to
        const ed = payload.new as any
        const em = escalaMensal.find(x => x.id === ed.escala_mensal_id)
        if (em) {
          setPresenceData(prev => ({
            ...prev,
            [em.servidor_id]: {
              ...prev[em.servidor_id],
              [ed.categoria as RowCategory]: {
                ...(prev[em.servidor_id]?.[ed.categoria as RowCategory] || {}),
                [ed.dia]: {
                  entrada: !!ed.presenca_entrada_em,
                  saida: !!ed.presenca_saida_em
                }
              }
            }
          }))
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, escalaMensal])
  
  // State structured by Servidor -> Categoria -> Dia -> TurnoId
  const [gridData, setGridData] = useState<Record<string, Record<RowCategory, Record<number, string>>>>(() => {
    const initial: Record<string, Record<RowCategory, Record<number, string>>> = {}
    escalaMensalInicial.forEach(em => {
      initial[em.servidor_id] = {
        'Regular': {},
        'Extra': {},
        'Plantão': {},
        'Sobreaviso': {}
      }
      const dailies = escalaDiariaInicial.filter(ed => ed.escala_mensal_id === em.id)
      dailies.forEach(ed => {
        const cat = (ed.categoria || 'Regular') as RowCategory
        initial[em.servidor_id][cat][ed.dia] = ed.dicionario_turnos_id
      })
    })
    return initial
  })

  const [presenceData, setPresenceData] = useState<Record<string, Record<RowCategory, Record<number, { entrada: boolean, saida: boolean }>>>>(() => {
    const initial: Record<string, Record<RowCategory, Record<number, { entrada: boolean, saida: boolean }>>> = {}
    escalaMensalInicial.forEach(em => {
      initial[em.servidor_id] = {
        'Regular': {},
        'Extra': {},
        'Plantão': {},
        'Sobreaviso': {}
      }
      const dailies = escalaDiariaInicial.filter(ed => ed.escala_mensal_id === em.id)
      dailies.forEach(ed => {
        const cat = (ed.categoria || 'Regular') as RowCategory
        initial[em.servidor_id][cat][ed.dia] = {
          entrada: !!ed.presenca_entrada_em,
          saida: !!ed.presenca_saida_em
        }
      })
    })
    return initial
  })

  const daysInMonth = useMemo(() => new Date(ano, mes, 0).getDate(), [mes, ano])
  const daysArray = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth])

  // Motor de Compliance: validação de interjornada e DSR
  const complianceViolations = useMemo(() => {
    if (!gridData || escalaMensal.length === 0) return [] as ComplianceViolation[]
    return runComplianceCheck(
      gridData,
      turnos,
      escalaMensal.map(em => em.servidor_id),
      daysInMonth
    )
  }, [gridData, turnos, escalaMensal, daysInMonth])

  const complianceCount = complianceViolations.length

  const getStatusForDay = useCallback((day: number, emId: string, categoria?: string) => {
    const logs = logsSobreaviso.filter(l => 
      l.escala_mensal_id === emId && 
      l.dia === day && 
      (!categoria || l.categoria === categoria || (categoria === 'Sobreaviso' && !l.categoria))
    )
    if (logs.length === 0) return { status: null, reason: null, log: null }

    for (const log of logs) {
      let status = log.status
      let reason = log.motivo_falha

      if (status === 'Aceito' && configs['sobreaviso_tempo_chegada_minutos']) {
        const limit = parseInt(configs['sobreaviso_tempo_chegada_minutos'])
        const safeDateStr = log.data_hora_aceite ? log.data_hora_aceite.replace(' ', 'T') : new Date().toISOString()
        const acceptedAt = new Date(safeDateStr).getTime()
        const now = new Date().getTime()
        if ((acceptedAt + limit * 60000) < now && !log.data_hora_chegada) {
          status = 'Falhou'
          reason = 'Tempo limite de deslocamento excedido'
        }
      } else if (status === 'Aguardando' && configs['sobreaviso_tempo_aceite_minutos']) {
        const limit = parseInt(configs['sobreaviso_tempo_aceite_minutos'])
        const safeDateStr = log.created_at ? log.created_at.replace(' ', 'T') : new Date().toISOString()
        const created = new Date(safeDateStr).getTime()
        const now = new Date().getTime()
        if ((created + limit * 60000) < now) {
          status = 'Falhou'
          reason = 'Tempo limite para aceite excedido'
        }
      }

      if (status === 'Falhou') return { status: 'Falhou', reason: reason || 'Tempo expirado', log }
    }

    const pending = logs.find(l => l.status === 'Aceito' || l.status === 'Aguardando')
    if (pending) return { status: pending.status, reason: null, log: pending }

    const last = logs[logs.length - 1]
    return { status: last.status, reason: null, log: last }
  }, [logsSobreaviso, configs])

  const shiftTotals = useMemo(() => {
    const totals = {
      M: {} as Record<number, number>,
      T: {} as Record<number, number>,
      N: {} as Record<number, number>,
      S: {} as Record<number, number>
    }

    daysArray.forEach(day => {
      let countM = 0
      let countT = 0
      let countN = 0
      let countS = 0
      
      escalaMensal.forEach(em => {
        let hasM = false
        let hasT = false
        let hasN = false
        let hasS = false

        const categories: RowCategory[] = ['Regular', 'Extra', 'Plantão']
        
        categories.forEach(cat => {
           const turnoId = gridData[em.servidor_id]?.[cat]?.[day]
           const turno = turnos.find(t => t.id === turnoId)
           if (turno && turno.codigo) {
             const code = turno.codigo.toUpperCase()
             if (code.includes('M')) hasM = true
             if (code.includes('T')) hasT = true
             if (code.includes('N')) hasN = true
           }
        })

        const turnoIdS = gridData[em.servidor_id]?.['Sobreaviso']?.[day]
        if (turnoIdS) {
          const { status: effectiveStatus } = getStatusForDay(day, em.id, 'Sobreaviso')
          if (!(desconsiderarFalha && effectiveStatus === 'Falhou')) {
            hasS = true
          }
        }

        if (hasM) countM++
        if (hasT) countT++
        if (hasN) countN++
        if (hasS) countS++
      })
      
      totals.M[day] = countM
      totals.T[day] = countT
      totals.N[day] = countN
      totals.S[day] = countS
    })
    
    return totals
  }, [daysArray, escalaMensal, gridData, turnos, getStatusForDay, desconsiderarFalha])

  const getShiftTotalStyleAndTooltip = useCallback((count: number, shift: 'M' | 'T' | 'N', day: number) => {
    if (!currentSector) return { className: '', title: '' }

    const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    const d = new Date(ano, mes - 1, day)
    const isWE = d.getDay() === 0 || d.getDay() === 6
    const isHoliday = feriados.some(f => f.data === dateStr)
    const isWeekendOrHoliday = isWE || isHoliday

    const applyOnFdsFeriados = currentSector.dimensionamento_fds_feriados !== false

    if (isWeekendOrHoliday && !applyOnFdsFeriados) {
      return { className: '', title: 'Dimensionamento ignorado em finais de semana/feriados neste setor' }
    }

    let min = null
    let ideal = null
    let max = null

    if (shift === 'M') {
      min = currentSector.servidores_manha_min
      ideal = currentSector.servidores_manha_ideal
      max = currentSector.servidores_manha_max
    } else if (shift === 'T') {
      min = currentSector.servidores_tarde_min
      ideal = currentSector.servidores_tarde_ideal
      max = currentSector.servidores_tarde_max
    } else if (shift === 'N') {
      min = currentSector.servidores_noite_min
      ideal = currentSector.servidores_noite_ideal
      max = currentSector.servidores_noite_max
    }

    if (ideal === null || ideal === 0) return { className: '', title: '' }

    const safeMin = min ?? 0
    const safeMax = max ?? 0

    if (count < safeMin) {
      return { 
        className: 'bg-red-100 text-red-700 dark:bg-red-950/45 dark:text-red-300 border-red-350 dark:border-red-900', 
        title: `Desfalque crítico: ${count} de ${ideal} ideal (Mínimo: ${safeMin})` 
      }
    } else if (count >= safeMin && count < ideal) {
      return { 
        className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-350 dark:border-amber-900', 
        title: `Abaixo do ideal: ${count} de ${ideal} ideal (Mínimo: ${safeMin})` 
      }
    } else if (safeMax > 0 && count > safeMax) {
      return { 
        className: 'bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400 border-purple-350 dark:border-purple-900', 
        title: `Excesso de servidores: ${count} de ${ideal} ideal (Máximo: ${safeMax})` 
      }
    } else {
      return { 
        className: 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400 border-green-350 dark:border-green-900', 
        title: `Dimensionamento ideal: ${count} servidores` 
      }
    }
  }, [currentSector, ano, mes, feriados])

  const hasConfirmedPresence = useCallback((servidorId: string, escalaMensalId: string) => {
    const presenceForServer = presenceData[servidorId]
    if (presenceForServer) {
      const categories: RowCategory[] = ['Regular', 'Extra', 'Plantão']
      for (const cat of categories) {
        const days = presenceForServer[cat]
        if (days) {
          const hasPresence = Object.values(days).some(p => p.entrada || p.saida)
          if (hasPresence) return true
        }
      }
    }

    const hasOnCallArrival = logsSobreaviso.some(l => 
      l.escala_mensal_id === escalaMensalId && 
      l.status === 'Chegou'
    )
    return hasOnCallArrival
  }, [presenceData, logsSobreaviso])

  const hasPresenceForDay = useCallback((servidorId: string, escalaMensalId: string, categoria: RowCategory, day: number) => {
    // Check regular presence
    const presence = presenceData[servidorId]?.[categoria]?.[day]
    if (presence?.entrada || presence?.saida) return true

    // Check on-call status for that specific day
    if (categoria === 'Sobreaviso') {
      const { status } = getStatusForDay(day, escalaMensalId, 'Sobreaviso')
      if (status === 'Chegou') return true
    }

    return false
  }, [presenceData, getStatusForDay])

  const handleClearScale = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Limpar Escala',
      message: 'Deseja limpar os lançamentos desta escala? Servidores com presença confirmada serão preservados para proteger seus registros.',
      type: 'danger',
      onConfirm: () => {
        setGridData(prev => {
          const newData = { ...prev }
          // Só limpar servidores que NÃO possuem presença
          for (const sId in newData) {
            const em = escalaMensal.find(x => x.servidor_id === sId)
            if (em && !hasConfirmedPresence(sId, em.id)) {
              delete newData[sId]
            }
          }
          return newData
        })
        logAction('LIMPAR_ESCALA', { info: 'Lançamentos removidos (preservando presenças)' })
        setAlertModal({
          isOpen: true,
          title: 'Escala Ajustada',
          message: 'Lançamentos removidos. Servidores com registros de presença foram mantidos por segurança.',
          type: 'success'
        })
        setConfirmModal(null)
      }
    })
  }

  const handleAddExternalServer = async () => {
    if (!externalData.servidorId) return

    // Check if already in grid
    if (escalaMensal.some(em => em.servidor_id === externalData.servidorId)) {
      setAlertModal({
        isOpen: true,
        title: 'Servidor já Adicionado',
        message: 'Este servidor já está inserido nesta escala.',
        type: 'warning'
      })
      return
    }

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('escala_mensal')
        .insert({
          unidade_id: unidadeId,
          setor_id: setorId,
          servidor_id: externalData.servidorId,
          mes,
          ano,
          status: 'Rascunho',
          jornada_id: jornadas.find(j => j.nome === '07H ÀS 19H')?.id
        })
        .select('*, servidores(*)')
        .single()

      if (error) throw error

      setEscalaMensal(prev => [...prev, data])
      logAction('ADICIONAR_SERVIDOR_EXTERNO', { 
        servidor_id: externalData.servidorId,
        nome: data.servidores?.nome 
      })
      setIsExternalModalOpen(false)
      setAlertModal({
        isOpen: true,
        title: 'Sucesso',
        message: 'Servidor externo adicionado à grade!',
        type: 'success'
      })
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro ao Adicionar',
        message: error.message,
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveServer = async (escalaMensalId: string, servidorId: string) => {
    const em = escalaMensal.find(x => x.servidor_id === servidorId)
    if (em && hasConfirmedPresence(servidorId, em.id)) {
      setAlertModal({
        isOpen: true,
        title: 'Direito Adquirido',
        message: 'Este servidor já possui registros de presença validados ou sobreavisos concluídos. Por questões de integridade e direitos adquiridos, ele não pode ser removido da escala.',
        type: 'warning'
      })
      return
    }

    if (isCompetenciaEncerrada || escalaMensal[0]?.status === 'Fechada' || (isClosed && userProfile?.role !== 'admin' && userProfile?.role !== 'super_admin')) return
    
    setConfirmModal({
      isOpen: true,
      title: 'Remover Servidor',
      message: 'Deseja remover este servidor e todos os seus lançamentos desta escala?',
      type: 'danger',
      onConfirm: async () => {
        setLoading(true)
        try {
          // Delete daily records first
          await supabase.from('escala_diaria').delete().eq('escala_mensal_id', escalaMensalId)
          
          // Delete monthly record
          const { error } = await supabase.from('escala_mensal').delete().eq('id', escalaMensalId)

          if (error) throw error

          // Update local state
          const servidorRemovido = escalaMensal.find(em => em.id === escalaMensalId)
          logAction('REMOVER_SERVIDOR_DA_ESCALA', { 
            escala_mensal_id: escalaMensalId, 
            servidor_id: servidorId,
            nome: servidorRemovido?.servidores?.nome
          })
          setEscalaMensal(prev => prev.filter(em => em.id !== escalaMensalId))
          setGridData(prev => {
            const newData = { ...prev }
            delete newData[servidorId]
            return newData
          })
          setAlertModal({
            isOpen: true,
            title: 'Removido',
            message: 'Servidor removido com sucesso.',
            type: 'success'
          })
        } catch (error: any) {
          setAlertModal({
            isOpen: true,
            title: 'Erro ao Remover',
            message: error.message,
            type: 'danger'
          })
        } finally {
          setLoading(false)
          setConfirmModal(null)
        }
      }
    })
  }

  const getDayOfWeek = (day: number) => {
    return new Date(ano, mes - 1, day).getDay()
  }

  const handleCellChange = async (servidorId: string, categoria: RowCategory, day: number, turnoId: string) => {
    // REGRA DE DIREITO ADQUIRIDO: Se existe presença confirmada para o dia/categoria, não permite apagar o turno
    const emRecord = escalaMensal.find(x => x.servidor_id === servidorId)
    if (!turnoId && emRecord) {
      const hasPresence = hasPresenceForDay(servidorId, emRecord.id, categoria, day)
      if (hasPresence) {
        setAlertModal({
          isOpen: true,
          title: 'Direito Adquirido',
          message: 'Não é possível remover o turno de um dia que já possui registro de presença ou sobreaviso concluído.',
          type: 'warning'
        })
        return
      }
    }

    // Se estiver limpando a célula, atualiza direto
    if (!turnoId) {
      setGridData(prev => ({
        ...prev,
        [servidorId]: {
          ...prev[servidorId],
          [categoria]: {
            ...prev[servidorId][categoria],
            [day]: turnoId
          }
        }
      }))
      return
    }

    // Validação de Afastamento / Evento
    const activeEvent = getActiveEventForDay(servidorId, day)
    if (activeEvent && turnoId) {
      const permitirPlantaoExtra = configs['permitir_plantao_extra_durante_eventos'] === 'true'
      const isRegular = categoria === 'Regular'
      const isBlocked = isRegular || !permitirPlantaoExtra
      
      if (isBlocked) {
        setAlertModal({
          isOpen: true,
          title: '⚠️ Servidor Afastado',
          message: `Este servidor está afastado (${activeEvent.tipos_eventos?.nome || 'Afastamento'}) no dia ${day} e não pode ser escalado nesta linha.`,
          type: 'warning'
        })
        return
      }
    }

    // Validação de Conflito Interno (Checa mudanças não salvas na grade atual)
    try {
      const currentTurno = turnos.find(t => t.id === turnoId)
      
      // Valitações de Governança para Horas Extras e Sobreavisos
      if (categoria === 'Extra' && currentTurno) {
        if (currentTurno.tipo !== 'Extra') {
          setAlertModal({
            isOpen: true,
            title: '⚠️ Turno Inválido',
            message: 'Apenas turnos do tipo Extra podem ser inseridos na linha de Extras.',
            type: 'warning'
          })
          return
        }
        if (Number(currentTurno.horas_computadas) > 2) {
          setAlertModal({
            isOpen: true,
            title: '⚠️ Limite Legal Excedido',
            message: 'O limite legal permitido para horas extras é de no máximo 2 horas diárias por servidor.',
            type: 'warning'
          })
          return
        }
      }

      if (categoria === 'Sobreaviso' && currentTurno) {
        if (currentTurno.tipo !== 'Sobreaviso') {
          setAlertModal({
            isOpen: true,
            title: '⚠️ Turno Inválido',
            message: 'Apenas turnos do tipo Sobreaviso podem ser inseridos na linha de Sobreaviso.',
            type: 'warning'
          })
          return
        }
      }

      const currentSlots = currentTurno?.slots || []
      const serverRows = gridData[servidorId] || {}
      
      let internalConflictMsg = null
      Object.entries(serverRows).forEach(([cat, days]: [string, any]) => {
        if (cat === categoria) return
        const otherTurnoId = days[day]
        if (!otherTurnoId) return
        
        const otherTurno = turnos.find(t => t.id === otherTurnoId)
        const otherSlots = otherTurno?.slots || []
        
        if (otherSlots.some((s: string) => currentSlots.includes(s))) {
          internalConflictMsg = `Este servidor já possui um turno (${otherTurno.codigo}) na linha de ${cat} para este dia nesta escala.`
        }
      })

      if (internalConflictMsg) {
        setAlertModal({
          isOpen: true,
          title: '⚠️ Conflito Interno Detectado',
          message: internalConflictMsg,
          type: 'warning'
        })
        return
      }
    } catch (err) {
      console.error('Erro na validação interna:', err)
    }

    // Validação de Conflito Externo (Cross-Unit/Cross-Sector via Banco)
    try {
      const { data, error } = await supabase.rpc('fn_check_shift_conflicts', {
        p_servidor_id: servidorId,
        p_dia: day,
        p_mes: mes,
        p_ano: ano,
        p_turno_id: turnoId,
        p_categoria: categoria
      })

      if (error) throw error

      if (data && data.length > 0 && data[0].conflito) {
        setAlertModal({
          isOpen: true,
          title: '⚠️ Conflito de Escala Detectado',
          message: data[0].mensagem,
          type: 'warning'
        })
        return // Bloqueia a alteração
      }
    } catch (err) {
      console.error('Erro na validação de conflito:', err)
    }

    // Validação de Dimensionamento Máximo (Regra Rígida)
    const regraDimensionamento = configs['escala_regra_dimensionamento'] || 'flexivel'
    if (regraDimensionamento === 'rigida' && currentSector) {
      const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
      const d = new Date(ano, mes - 1, day)
      const isWE = d.getDay() === 0 || d.getDay() === 6
      const isHoliday = feriados.some(f => f.data === dateStr)
      const isWeekendOrHoliday = isWE || isHoliday
      const applyOnFdsFeriados = currentSector.dimensionamento_fds_feriados !== false

      if (!isWeekendOrHoliday || applyOnFdsFeriados) {
        const targetTurno = turnos.find(t => t.id === turnoId)
        if (targetTurno && targetTurno.codigo) {
          const code = targetTurno.codigo.toUpperCase()
          const isM = code.includes('M')
          const isT = code.includes('T')
          const isN = code.includes('N')

          let simulatedCountM = 0
          let simulatedCountT = 0
          let simulatedCountN = 0

          escalaMensal.forEach(em => {
            let hasM = false
            let hasT = false
            let hasN = false

            const categories: RowCategory[] = ['Regular', 'Extra', 'Plantão']
            categories.forEach(cat => {
              let cellTurnoId = gridData[em.servidor_id]?.[cat]?.[day]
              if (em.servidor_id === servidorId && cat === categoria) {
                cellTurnoId = turnoId
              }

              const cellTurno = turnos.find(t => t.id === cellTurnoId)
              if (cellTurno && cellTurno.codigo) {
                const cCode = cellTurno.codigo.toUpperCase()
                if (cCode.includes('M')) hasM = true
                if (cCode.includes('T')) hasT = true
                if (cCode.includes('N')) hasN = true
              }
            })

            if (hasM) simulatedCountM++
            if (hasT) simulatedCountT++
            if (hasN) simulatedCountN++
          })

          if (isM && currentSector.servidores_manha_max > 0 && simulatedCountM > currentSector.servidores_manha_max) {
            setAlertModal({
              isOpen: true,
              title: '⚠️ Limite Máximo Excedido (Regra Rígida)',
              message: `O limite máximo para o turno da MANHÃ é de ${currentSector.servidores_manha_max} servidores. Esta ação elevaria o total para ${simulatedCountM} servidores no dia ${day}.`,
              type: 'warning'
            })
            return
          }

          if (isT && currentSector.servidores_tarde_max > 0 && simulatedCountT > currentSector.servidores_tarde_max) {
            setAlertModal({
              isOpen: true,
              title: '⚠️ Limite Máximo Excedido (Regra Rígida)',
              message: `O limite máximo para o turno da TARDE é de ${currentSector.servidores_tarde_max} servidores. Esta ação elevaria o total para ${simulatedCountT} servidores no dia ${day}.`,
              type: 'warning'
            })
            return
          }

          if (isN && currentSector.servidores_noite_max > 0 && simulatedCountN > currentSector.servidores_noite_max) {
            setAlertModal({
              isOpen: true,
              title: '⚠️ Limite Máximo Excedido (Regra Rígida)',
              message: `O limite máximo para o turno da NOITE é de ${currentSector.servidores_noite_max} servidores. Esta ação elevaria o total para ${simulatedCountN} servidores no dia ${day}.`,
              type: 'warning'
            })
            return
          }
        }
      }
    }

    setGridData(prev => {
      const serverData = prev[servidorId] || { 
        'Regular': {}, 
        'Extra': {}, 
        'Plantão': {}, 
        'Sobreaviso': {} 
      }
      const catData = serverData[categoria] || {}

      return {
        ...prev,
        [servidorId]: {
          ...serverData,
          [categoria]: {
            ...catData,
            [day]: turnoId
          }
        }
      }
    })
  }

  const calculateTotals = (servidorId: string) => {
    const serverData = gridData[servidorId] || { 'Regular': {}, 'Extra': {}, 'Plantão': {}, 'Sobreaviso': {} }
    
    // Contadores para o Total Validado (Respeita as regras de presença)
    let v_ch = 0, v_he100 = 0, v_he50 = 0, v_pl12 = 0, v_pl6 = 0, v_pl4 = 0, v_so12 = 0
    // Contadores para o Total Planejado (Cálculo bruto da grade)
    let p_ch = 0, p_he100 = 0, p_he50 = 0, p_pl12 = 0, p_pl6 = 0, p_pl4 = 0, p_so12 = 0

    const exigirPresenca = configs['exigir_confirmacao_presenca'] === 'true'
    const today = new Date()
    const currentDay = today.getDate()
    const currentMonth = today.getMonth() + 1
    const currentYear = today.getFullYear()

    // Ensure numeric comparison
    const nMes = Number(mes)
    const nAno = Number(ano)

    const emRecord = escalaMensal.find(x => x.servidor_id === servidorId)
    const jornada = jornadas.find(j => j.id === emRecord?.jornada_id)
    const intervaloHoras = (jornada?.intervalo_minutos || 0) / 60

    // Sum Regular CH
    Object.entries(serverData['Regular']).forEach(([day, turnoId]) => {
      const t = turnos.find(x => x.id === turnoId)
      if (t) {
        const d = parseInt(day)
        const isPast = nAno < currentYear || (nAno === currentYear && nMes < currentMonth) || (nAno === currentYear && nMes === currentMonth && d < currentDay)
        const presence = presenceData[servidorId]?.['Regular']?.[d]
        
        const shiftHours = Number(t.horas_computadas)
        let liquidHours = shiftHours

        if (jornada && Number(jornada.horas_totais) > 0) {
          const journeyMaxLiquid = Math.max(0, Number(jornada.horas_totais) - intervaloHoras)
          // Se o turno for reduzido (ex: M4=4h), usa as 4h.
          // Se o turno for normal/longo (ex: MT=12h), limita ao teto da jornada (ex: 8h).
          liquidHours = Math.min(shiftHours, journeyMaxLiquid)
        }
        
        p_ch += liquidHours
        const isValidated = (isPast && !exigirPresenca) || presence?.entrada
        if (isValidated) {
          v_ch += liquidHours
        }
      }
    })

    // Sum Extras
    Object.entries(serverData['Extra']).forEach(([day, turnoId]) => {
      const t = turnos.find(x => x.id === turnoId)
      if (t) {
        const d = parseInt(day)
        const isPast = nAno < currentYear || (nAno === currentYear && nMes < currentMonth) || (nAno === currentYear && nMes === currentMonth && d < currentDay)
        const presence = presenceData[servidorId]?.['Extra']?.[d]
        
        const dateObj = new Date(nAno, nMes - 1, d)
        const isNightShift = t.codigo.toUpperCase().includes('N')
        const isWE = dateObj.getDay() === 0 || dateObj.getDay() === 6
        const dateStr = `${nAno}-${nMes.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`
        const isHoliday = feriados.some(f => f.data === dateStr)
        const horas = Number(t.horas_computadas)

        // REGRA: Toda hora extra noturna (qualquer turno com 'N') é 100%
        const isValidated = (isPast && !exigirPresenca) || presence?.entrada
        if (isNightShift || isWE || isHoliday) {
          p_he100 += horas
          if (isValidated) v_he100 += horas
        } else {
          p_he50 += horas
          if (isValidated) v_he50 += horas
        }
      }
    })

    // Sum Plantões
    Object.entries(serverData['Plantão']).forEach(([day, turnoId]) => {
      const t = turnos.find(x => x.id === turnoId)
      if (t) {
        const d = parseInt(day)
        const isPast = nAno < currentYear || (nAno === currentYear && nMes < currentMonth) || (nAno === currentYear && nMes === currentMonth && d < currentDay)
        const presence = presenceData[servidorId]?.['Plantão']?.[d]
        const horas = Number(t.horas_computadas)

        const incrementP = () => {
          if (horas >= 12) p_pl12++
          else if (horas >= 6) p_pl6++
          else p_pl4++
        }
        const incrementV = () => {
          if (horas >= 12) v_pl12++
          else if (horas >= 6) v_pl6++
          else v_pl4++
        }

        incrementP()
        const isValidated = (isPast && !exigirPresenca) || presence?.entrada
        if (isValidated) {
          incrementV()
        }
      }
    })

    // Sum Sobreavisos
    const overData = (serverData as any)['Sobreaviso'] || (serverData as any)['sobreaviso'] || {}
    Object.entries(overData).forEach(([day, turnoId]) => {
      const d = parseInt(day)
      const t = turnos.find(x => x.id === turnoId)
      if (!t) return

      const isPast = nAno < currentYear || (nAno === currentYear && nMes < currentMonth) || (nAno === currentYear && nMes === currentMonth && d < currentDay)
      const pServ = presenceData[servidorId] as any
      const presence = (pServ?.['Sobreaviso'] || pServ?.['sobreaviso'])?.[d]

      const code = t.codigo?.toUpperCase().trim() || ''
      let horas = Number(t.horas_computadas) || 0
      if (horas === 0) {
        horas = (code === 'MTN') ? 24 : (code === 'MT' || code === 'N' ? 12 : 0)
      }
      const periods = horas / 12
      
      p_so12 += periods
      // Para Sobreaviso, se for passado, validamos automaticamente a menos que haja glosa expressa
      // ou se houver presença confirmada
      if (isPast || presence?.entrada) {
        v_so12 += periods
      }
    })

    const totalValidado = v_ch + v_he100 + v_he50 + (v_pl12 * 12) + (v_pl6 * 6) + (v_pl4 * 4) + (v_so12 * 12)
    const totalPlanejado = p_ch + p_he100 + p_he50 + (p_pl12 * 12) + (p_pl6 * 6) + (p_pl4 * 4) + (p_so12 * 12)

    return { 
      chTotal: v_ch, he100: v_he100, he50: v_he50, pl12: v_pl12, pl6: v_pl6, pl4: v_pl4, so12: v_so12, 
      p_ch, p_he100, p_he50, p_pl12, p_pl6, p_pl4, p_so12,
      totalGeral: totalValidado,
      totalPlanejado
    }
  }



  const confirmTriggerSobreaviso = async () => {
    if (!triggerModal || !motivo) return

    setLoading(true)
    try {
      const { data, error } = await supabase.from('logs_sobreaviso').insert({
        servidor_id: triggerModal.servidorId,
        unidade_id: unidadeId,
        escala_mensal_id: triggerModal.escalaMensalId,
        dia: triggerModal.dia,
        motivo_acionamento: motivo,
        status: 'Aguardando'
      }).select('token_magic_link').single()

      if (error) throw error
      
      const link = `${window.location.origin}/sobreaviso/${data.token_magic_link}`
      setGeneratedLink(link)
    } catch (error: any) {
      console.error('Erro ao acionar sobreaviso:', error)
      setAlertModal({
        isOpen: true,
        title: 'Falha no Acionamento',
        message: error.message,
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  const isRedIndicator = (day: number, categoria: string, tipo: 'entrada' | 'saida') => {
    // REGRA: Somente mostra indicadores vermelhos se a confirmação de presença estiver exigida nas configurações
    if (configs['exigir_confirmacao_presenca'] !== 'true') return false

    const today = new Date()
    const currentMonth = today.getMonth() + 1
    const currentYear = today.getFullYear()
    
    // Only show red indicators for current or past months
    if (ano > currentYear) return false
    if (ano === currentYear && mes > currentMonth) return false

    // If past month, all missed shifts are red
    if (ano < currentYear || (ano === currentYear && mes < currentMonth)) return true

    // Current month logic
    if (day > today.getDate()) return false
    if (day < today.getDate()) return true
    
    const shiftHour = categoria === 'Plantão' || categoria === 'Regular' ? 7 : 0
    const endHour = shiftHour + 12
    const currentHour = today.getHours()
    
    if (tipo === 'entrada') return currentHour >= shiftHour + 1
    return currentHour >= endHour
  }

  const handleCloseModal = () => {
    setTriggerModal(null)
    setGeneratedLink(null)
    setMotivo('')
  }

  const handleManualOverride = async (logId: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Validar Sobreaviso',
      message: 'Deseja validar manualmente este sobreaviso que falhou? Ele voltará a ser contabilizado na carga horária do servidor.',
      type: 'warning',
      onConfirm: async () => {
        setLoading(true)
        try {
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) throw new Error('Usuário não autenticado')

          const now = new Date().toISOString()
          
          const { error } = await supabase
            .from('logs_sobreaviso')
            .update({ 
              status: 'Chegou', 
              validacao_manual: true,
              tipo_validacao_chegada: 'Manual',
              motivo_falha: null,
              validado_por: user.id,
              data_hora_validacao: now
            })
            .eq('id', logId)

          if (error) throw error
          
          // Update local state
          setLogsSobreaviso(prev => prev.map(l => l.id === logId ? { 
            ...l, 
            status: 'Chegou', 
            validacao_manual: true, 
            motivo_falha: null,
            validado_por: user.id,
            data_hora_validacao: now
          } : l))
          
          logAction('VALIDACAO_MANUAL_SOBREAVISO', { 
            log_id: logId,
            info: 'Validação manual de sobreaviso que falhou'
          })

          setAlertModal({
            isOpen: true,
            title: 'Validado',
            message: 'O sobreaviso foi validado manualmente com sucesso.',
            type: 'success'
          })
        } catch (err: any) {
          setAlertModal({
            isOpen: true,
            title: 'Erro na Validação',
            message: err.message,
            type: 'danger'
          })
        } finally {
          setLoading(false)
          setConfirmModal(null)
        }
      }
    })
  }

  const fetchData = useCallback(async () => {
    try {
      const { data: dailies, error } = await supabase
        .from('escala_diaria')
        .select('*')
        .in('escala_mensal_id', escalaMensal.map(em => em.id))
        .limit(5000)

      if (error) throw error

      if (dailies) {
        const newPresence: Record<string, Record<RowCategory, Record<number, { entrada: boolean, saida: boolean }>>> = {}
        escalaMensal.forEach(em => {
          newPresence[em.servidor_id] = {
            'Regular': {}, 'Extra': {}, 'Plantão': {}, 'Sobreaviso': {}
          }
          const serverDailies = dailies.filter(ed => ed.escala_mensal_id === em.id)
          serverDailies.forEach(ed => {
            const cat = (ed.categoria || 'Regular') as RowCategory
            newPresence[em.servidor_id][cat][ed.dia] = {
              entrada: !!ed.presenca_entrada_em,
              saida: !!ed.presenca_saida_em
            }
          })
        })
        setPresenceData(newPresence)
      }
    } catch (err) {
      console.error('Erro ao recarregar dados:', err)
    }
  }, [supabase, escalaMensal])

  const handleConfirmManualPresence = async () => {
    if (!manualPresenceModal) return
    
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Usuário não autenticado')

      const isReverting = manualPresenceModal.isReverting
      const tipo = manualPresenceModal.tipo
      const rpcName = isReverting ? 'fn_reverter_presenca_manual' : 'fn_confirmar_presenca_manual'

      const { data, error } = await supabase.rpc(rpcName, {
        p_escala_mensal_id: manualPresenceModal.escalaMensalId,
        p_dia: manualPresenceModal.dia,
        p_categoria: manualPresenceModal.categoria,
        p_tipo: manualPresenceModal.tipo,
        p_validador_id: user.id
      })

      // Fechar modal de confirmação IMEDIATAMENTE antes de qualquer outra coisa
      setManualPresenceModal(null)

      if (error) throw error
      if (data && !data.success) throw new Error(data.message)

      // Refresh data
      await fetchData()

      setAlertModal({
        isOpen: true,
        title: isReverting ? 'Presença Revertida' : 'Presença Validada',
        message: data.message || (isReverting ? `A ${tipo} foi revertida.` : `A ${tipo} foi validada.`),
        type: isReverting ? 'warning' : 'success'
      })
      
    } catch (err: any) {
      setManualPresenceModal(null) // Fechar também em caso de erro para não travar a UI
      setAlertModal({
        isOpen: true,
        title: 'Erro na Operação',
        message: err.message,
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (isCompetenciaEncerrada) return

    // Validação de Dimensionamento Máximo (Regra Rígida)
    const regraDimensionamento = configs['escala_regra_dimensionamento'] || 'flexivel'
    if (regraDimensionamento === 'rigida' && currentSector) {
      const maxM = currentSector.servidores_manha_max || 0
      const maxT = currentSector.servidores_tarde_max || 0
      const maxN = currentSector.servidores_noite_max || 0
      const applyOnFdsFeriados = currentSector.dimensionamento_fds_feriados !== false

      const overstaffedDays: string[] = []

      daysArray.forEach(day => {
        const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
        const d = new Date(ano, mes - 1, day)
        const isWE = d.getDay() === 0 || d.getDay() === 6
        const isHoliday = feriados.some(f => f.data === dateStr)
        const isWeekendOrHoliday = isWE || isHoliday

        if (!isWeekendOrHoliday || applyOnFdsFeriados) {
          const countM = shiftTotals.M[day] || 0
          const countT = shiftTotals.T[day] || 0
          const countN = shiftTotals.N[day] || 0

          const violations = []
          if (maxM > 0 && countM > maxM) violations.push(`Manhã: ${countM}/${maxM}`)
          if (maxT > 0 && countT > maxT) violations.push(`Tarde: ${countT}/${maxT}`)
          if (maxN > 0 && countN > maxN) violations.push(`Noite: ${countN}/${maxN}`)

          if (violations.length > 0) {
            overstaffedDays.push(`Dia ${day} (${violations.join(', ')})`)
          }
        }
      })

      if (overstaffedDays.length > 0) {
        setAlertModal({
          isOpen: true,
          title: '⚠️ Limite Máximo Excedido (Regra Rígida)',
          message: `A escala possui dias com mais servidores do que o limite máximo permitido:\n\n${overstaffedDays.slice(0, 5).join('\n')}${overstaffedDays.length > 5 ? `\n...e mais ${overstaffedDays.length - 5} dias.` : ''}`,
          type: 'warning'
        })
        return
      }
    }
    // Validação: Todas as Jornadas devem estar selecionadas
    const servidorSemJornada = escalaMensal.find(em => !em.jornada_id)
    if (servidorSemJornada) {
      setAlertModal({
        isOpen: true,
        title: 'Jornada Obrigatória',
        message: `O servidor ${servidorSemJornada.servidores?.nome || 'da lista'} não possui uma jornada de trabalho selecionada. Por favor, selecione a jornada para todos os servidores antes de salvar.`,
        type: 'warning'
      })
      return
    }

    setLoading(true)
    try {
      const allInserts: any[] = []
      
      escalaMensal.forEach(em => {
        const serverData = gridData[em.servidor_id]
        if (!serverData) return

        Object.entries(serverData).forEach(([categoria, days]) => {
          Object.entries(days).forEach(([day, turnoId]) => {
            if (turnoId) {
              allInserts.push({
                escala_mensal_id: em.id,
                dia: parseInt(day),
                dicionario_turnos_id: turnoId,
                categoria: categoria
              })
            }
          })
        })
      })

      // Update escala_mensal (jornadas)
      const updates = escalaMensal.map(em => ({
        id: em.id,
        mes: em.mes || mes,
        ano: em.ano || ano,
        unidade_id: em.unidade_id || unidadeId,
        setor_id: em.setor_id || setorId,
        servidor_id: em.servidor_id,
        jornada_id: em.jornada_id,
        status: em.status || 'Rascunho',
        updated_at: new Date().toISOString()
      }))

      const { error: emError } = await supabase
        .from('escala_mensal')
        .upsert(updates)

      if (emError) throw emError

      // 1. Buscar registros diários existentes para preservar presenças
      const emIds = escalaMensal.map(em => em.id)
      const { data: existingDailies } = await supabase
        .from('escala_diaria')
        .select('*')
        .in('escala_mensal_id', emIds)

      const existingMap = new Map()
      existingDailies?.forEach(ed => {
        existingMap.set(`${ed.escala_mensal_id}-${ed.categoria}-${ed.dia}`, ed)
      })

      const toUpdate: any[] = []
      const toInsert: any[] = []
      const processedKeys = new Set()

      // 2. Mapear o que deve ser inserido/atualizado
      escalaMensal.forEach(em => {
        const serverData = gridData[em.servidor_id]
        if (!serverData) return

        Object.entries(serverData).forEach(([categoria, days]) => {
          Object.entries(days).forEach(([dayStr, turnoId]) => {
            const day = parseInt(dayStr)
            if (!turnoId) return

            const key = `${em.id}-${categoria}-${day}`
            const existing = existingMap.get(key)
            
            const item: any = {
              escala_mensal_id: em.id,
              dia: day,
              categoria: categoria,
              dicionario_turnos_id: turnoId,
              presenca_entrada_em: existing?.presenca_entrada_em || null,
              presenca_saida_em: existing?.presenca_saida_em || null,
              presenca_confirmada: existing?.presenca_confirmada || false,
              confirmado_por_id: existing?.confirmado_por_id || null
            }

            if (existing?.id) {
              item.id = existing.id
              toUpdate.push(item)
            } else {
              toInsert.push(item)
            }
            
            processedKeys.add(key)
          })
        })
      })

      // 3. Identificar o que deve ser deletado (apenas se não houver presença)
      const idsToDelete = existingDailies
        ?.filter(ed => {
          const key = `${ed.escala_mensal_id}-${ed.categoria}-${ed.dia}`
          return !processedKeys.has(key) && !ed.presenca_entrada_em && !ed.presenca_saida_em
        })
        .map(ed => ed.id) || []

      // 4. Executar operações no banco separadamente para evitar erro de colunas nulas
      if (idsToDelete.length > 0) {
        const { error: delError } = await supabase.from('escala_diaria').delete().in('id', idsToDelete)
        if (delError) throw delError
      }

      if (toUpdate.length > 0) {
        const { error: updError } = await supabase.from('escala_diaria').upsert(toUpdate)
        if (updError) throw updError
      }

      if (toInsert.length > 0) {
        const { error: insError } = await supabase.from('escala_diaria').insert(toInsert)
        if (insError) throw insError
      }
      
      
      setAlertModal({
        isOpen: true,
        title: 'Escala Salva',
        message: 'A previsão da escala foi salva com sucesso no banco de dados.',
        type: 'success'
      })
      logAction('SALVAR_PREVISAO_ESCALA', { 
        total_lancamentos: allInserts.length,
        total_servidores: escalaMensal.length
      })
      // Refresh local states
      const ids = escalaMensal.map(em => em.servidor_id)
      fetchOccupancy(ids)
      await fetchData()
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro ao Salvar',
        message: error.message,
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleAddServer = async (servidorId: string) => {
    if (!servidorId) return
    setLoading(true)
    try {
      const servidor = todosServidoresSetor.find(s => s.id === servidorId)
      if (!servidor) return

      const { data, error } = await supabase
        .from('escala_mensal')
        .insert({
          servidor_id: servidorId,
          unidade_id: unidadeId,
          setor_id: setorId,
          mes,
          ano,
          status: 'Rascunho'
        })
        .select('*, servidores(*)')
        .single()

      if (error) throw error

      setEscalaMensal(prev => [...prev, data])
      logAction('ADICIONAR_SERVIDOR', { 
        servidor_id: servidorId,
        nome: data.servidores?.nome
      })
      setGridData(prev => ({
        ...prev,
        [servidorId]: {
          'Regular': {},
          'Extra': {},
          'Plantão': {},
          'Sobreaviso': {}
        }
      }))
      // Refresh occupancy for the new server
      fetchOccupancy([...escalaMensal.map(em => em.servidor_id), servidorId])
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro',
        message: 'Não foi possível adicionar o servidor: ' + error.message,
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleAddAll = async () => {
    const serversToAdd = todosServidoresSetor.filter(s => !escalaMensal.some(em => em.servidor_id === s.id))
    if (serversToAdd.length === 0) return
    
    setLoading(true)
    try {
      const newRecords = serversToAdd.map(s => ({
        servidor_id: s.id,
        unidade_id: unidadeId,
        setor_id: setorId,
        mes,
        ano,
        status: 'Rascunho'
      }))

      const { data, error } = await supabase
        .from('escala_mensal')
        .insert(newRecords)
        .select('*, servidores(*)')

      if (error) throw error

      setEscalaMensal(prev => [...prev, ...data])
      logAction('ADICIONAR_TODOS_SERVIDORES', { 
        quantidade: data.length,
        servidores: data.map((em: any) => em.servidores?.nome)
      })
      
      const newGridData = { ...gridData }
      const newIds = data.map(em => em.servidor_id)
      data.forEach(em => {
        newGridData[em.servidor_id] = {
          'Regular': {},
          'Extra': {},
          'Plantão': {},
          'Sobreaviso': {}
        }
      })
      setGridData(newGridData)
      // Refresh occupancy for all
      fetchOccupancy([...escalaMensal.map(em => em.servidor_id), ...newIds])
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro',
        message: error.message,
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleCloseScale = async () => {
    if (isCompetenciaEncerrada) return

    // Validação de Dimensionamento (Regra Rígida - Mínimos e Máximos)
    const regraDimensionamento = configs['escala_regra_dimensionamento'] || 'flexivel'
    if (regraDimensionamento === 'rigida' && currentSector) {
      const minM = currentSector.servidores_manha_min || 0
      const minT = currentSector.servidores_tarde_min || 0
      const minN = currentSector.servidores_noite_min || 0

      const maxM = currentSector.servidores_manha_max || 0
      const maxT = currentSector.servidores_tarde_max || 0
      const maxN = currentSector.servidores_noite_max || 0

      const applyOnFdsFeriados = currentSector.dimensionamento_fds_feriados !== false

      const dimensioningViolations: string[] = []

      daysArray.forEach(day => {
        const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
        const d = new Date(ano, mes - 1, day)
        const isWE = d.getDay() === 0 || d.getDay() === 6
        const isHoliday = feriados.some(f => f.data === dateStr)
        const isWeekendOrHoliday = isWE || isHoliday

        if (!isWeekendOrHoliday || applyOnFdsFeriados) {
          const countM = shiftTotals.M[day] || 0
          const countT = shiftTotals.T[day] || 0
          const countN = shiftTotals.N[day] || 0

          const violations = []
          // Check Min
          if (currentSector.servidores_manha_ideal > 0 && countM < minM) {
            violations.push(`Manhã: ${countM} (Mín: ${minM})`)
          }
          if (currentSector.servidores_tarde_ideal > 0 && countT < minT) {
            violations.push(`Tarde: ${countT} (Mín: ${minT})`)
          }
          if (currentSector.servidores_noite_ideal > 0 && countN < minN) {
            violations.push(`Noite: ${countN} (Mín: ${minN})`)
          }

          // Check Max
          if (currentSector.servidores_manha_ideal > 0 && maxM > 0 && countM > maxM) {
            violations.push(`Manhã: ${countM} (Máx: ${maxM})`)
          }
          if (currentSector.servidores_tarde_ideal > 0 && maxT > 0 && countT > maxT) {
            violations.push(`Tarde: ${countT} (Máx: ${maxT})`)
          }
          if (currentSector.servidores_noite_ideal > 0 && maxN > 0 && countN > maxN) {
            violations.push(`Noite: ${countN} (Máx: ${maxN})`)
          }

          if (violations.length > 0) {
            dimensioningViolations.push(`Dia ${day} (${violations.join(', ')})`)
          }
        }
      })

      if (dimensioningViolations.length > 0) {
        setAlertModal({
          isOpen: true,
          title: '⚠️ Erro de Dimensionamento (Regra Rígida)',
          message: `Não é possível fechar a escala. Há dias que não cumprem os limites mínimos ou máximos de servidores definidos para o setor:\n\n${dimensioningViolations.slice(0, 5).join('\n')}${dimensioningViolations.length > 5 ? `\n...e mais ${dimensioningViolations.length - 5} dias.` : ''}`,
          type: 'warning'
        })
        return
      }
    }
    // Validação: Todas as Jornadas devem estar selecionadas
    const servidorSemJornada = escalaMensal.find(em => !em.jornada_id)
    if (servidorSemJornada) {
      setAlertModal({
        isOpen: true,
        title: 'Jornada Obrigatória',
        message: `Não é possível fechar a escala pois o servidor ${servidorSemJornada.servidores?.nome || 'da lista'} não possui uma jornada de trabalho selecionada.`,
        type: 'warning'
      })
      return
    }

    setConfirmModal({
      isOpen: true,
      title: 'Fechar Escala',
      message: 'Deseja FECHAR esta escala? Uma escala fechada não permite mais edições manuais, apenas acionamentos de sobreaviso.',
      type: 'warning',
      onConfirm: async () => {
        setLoading(true)
        try {
          const ids = escalaMensal.map(em => em.id)
          await supabase.from('escala_mensal').update({ status: 'Fechada' }).in('id', ids)
          setEscalaMensal(prev => prev.map(em => ({ ...em, status: 'Fechada' })))
          logAction('FECHAR_ESCALA', { 
            ids_escala: ids,
            total_servidores: ids.length
          })
          setAlertModal({
            isOpen: true,
            title: 'Escala Fechada',
            message: 'A escala foi finalizada com sucesso.',
            type: 'success'
          })
        } catch (error: any) {
          setAlertModal({
            isOpen: true,
            title: 'Erro',
            message: error.message,
            type: 'danger'
          })
        } finally {
          setLoading(false)
          setConfirmModal(null)
        }
      }
    })
  }

  const handleReopenScale = async () => {
    if (isCompetenciaEncerrada) return
    setConfirmModal({
      isOpen: true,
      title: 'Reabrir Escala',
      message: 'Deseja REABRIR esta escala? Isso permitirá edições manuais novamente.',
      type: 'warning',
      onConfirm: async () => {
        setLoading(true)
        try {
          const ids = escalaMensal.map(em => em.id)
          await supabase.from('escala_mensal').update({ status: 'Rascunho' }).in('id', ids)
          setEscalaMensal(prev => prev.map(em => ({ ...em, status: 'Rascunho' })))
          logAction('REABRIR_ESCALA', { 
            ids_escala: ids,
            total_servidores: ids.length
          })
          setAlertModal({
            isOpen: true,
            title: 'Escala Reaberta',
            message: 'A escala foi reaberta para edições.',
            type: 'success'
          })
        } catch (error: any) {
          setAlertModal({
            isOpen: true,
            title: 'Erro',
            message: error.message,
            type: 'danger'
          })
        } finally {
          setLoading(false)
          setConfirmModal(null)
        }
      }
    })
  }

  const endOfMonth = new Date(ano, mes, 0)
  const thresholdDate = new Date(endOfMonth)
  thresholdDate.setDate(thresholdDate.getDate() + (diasInativacao || 5))
  const isAutoInactivated = new Date() > thresholdDate

  const isInactive = escalaMensal[0]?.ativo === false || isAutoInactivated
  const isComum = userProfile?.role === 'comum' || userProfile?.role === 'servidor'
  
  const closedPeriodsRaw = configsGlobais?.find(c => c.chave === 'competencias_encerradas')?.valor
  const closedPeriods = Array.isArray(closedPeriodsRaw) ? closedPeriodsRaw : []
  const isCompetenciaEncerrada = closedPeriods.some((p: any) => p.mes === mes && p.ano === ano)

  const deadlineDay = parseInt(configs['dia_limite_planejamento'] || '10')
  const governanceLock = canEditScale({
    role: userProfile?.role as UserRole,
    scaleMonth: mes,
    scaleYear: ano,
    deadlineDay
  })

  const isClosed = escalaMensal[0]?.status === 'Fechada' || isInactive || isComum || !governanceLock.canEdit || isCompetenciaEncerrada

  // Filter scales for common users
  const visibleEscalaMensal = useMemo(() => {
    if (isComum && linkedServidorId) {
      return escalaMensal.filter(em => em.servidor_id === linkedServidorId)
    }
    return escalaMensal
  }, [isComum, linkedServidorId, escalaMensal])

  return (
    <>
      <div className="flex flex-col h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden print:hidden">
      {isInactive && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-2 text-amber-700 dark:text-amber-500 text-xs font-bold uppercase tracking-tight">
          <Lock className="h-4 w-4" />
          Escala Inativa {isAutoInactivated ? '(Inativação Automática por Prazo)' : '(Inativada Manualmente)'} - Modo de Visualização Ativado
        </div>
      )}

      {!governanceLock.canEdit && !isInactive && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-200 dark:border-indigo-800 px-4 py-2 flex items-center gap-2 text-indigo-700 dark:text-indigo-400 text-xs font-bold uppercase tracking-tight">
          <Lock className="h-4 w-4" />
          {governanceLock.reason} - Modo de Somente Leitura Ativado
        </div>
      )}

      {/* Toolbar */}
      {!isComum && (
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
          <div className="flex items-center space-x-4">
            <select 
              onChange={(e) => {
                const val = e.target.value
                if (val === 'all') {
                  handleAddAll()
                } else if (val === 'external') {
                  setIsExternalModalOpen(true)
                } else if (val) {
                  handleAddServer(val)
                }
              }}
              value=""
              disabled={loading || isClosed}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
            >
              <option value="">+ Adicionar Servidor...</option>
              
              <optgroup label="Ações Rápidas">
                <option value="all" disabled={todosServidoresSetor.length === escalaMensal.length}>
                  👥 Adicionar Todos do Setor
                </option>
                <option value="external">
                  🌍 Servidor Externo...
                </option>
              </optgroup>

              <optgroup label="Servidores do Setor">
                {todosServidoresSetor
                  .filter(s => !escalaMensal.some(em => em.servidor_id === s.id))
                  .map(s => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))
                }
              </optgroup>
            </select>
            
            <button
              onClick={handleClearScale}
              disabled={loading || isClosed}
              className="inline-flex items-center rounded-md border border-red-200 text-red-600 px-3 py-2 text-sm font-medium hover:bg-red-50 dark:border-red-900/30 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Limpar Escala
            </button>

            <button
              onClick={() => {
                if (escalaMensal.length === 0) {
                  setAlertModal({ isOpen: true, title: 'Sem Servidores', message: 'Adicione pelo menos um servidor à grade antes de aplicar um template.', type: 'warning' })
                  return
                }
                setTemplateModal({
                  isOpen: true,
                  servidorId: escalaMensal[0]?.servidor_id || '',
                  templateType: '12x36',
                  turnoId: turnos.find(t => t.codigo === 'MT')?.id || turnos[0]?.id || '',
                  startDay: 1,
                  startWorking: true
                })
              }}
              disabled={loading || isClosed}
              className="inline-flex items-center rounded-md border border-purple-200 text-purple-700 px-3 py-2 text-sm font-medium hover:bg-purple-50 dark:border-purple-800 dark:text-purple-400 transition-colors disabled:opacity-50"
            >
              <LayoutTemplate className="h-4 w-4 mr-2" />
              Aplicar Template
            </button>
          </div>
          
          <div className="flex items-center space-x-3">
            {complianceCount > 0 && (
              <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs font-bold animate-in fade-in">
                <AlertTriangle className="h-3.5 w-3.5" />
                {complianceCount} {complianceCount === 1 ? 'alerta' : 'alertas'} de compliance
              </div>
            )}
            <button onClick={() => window.print()} className="inline-flex items-center rounded-md bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50">
              <FileText className="mr-2 h-4 w-4" /> Gerar PDF
            </button>
            
            <button onClick={handleSave} disabled={loading || isCompetenciaEncerrada || escalaMensal[0]?.status === 'Fechada' || (isClosed && userProfile?.role !== 'admin' && userProfile?.role !== 'super_admin')} className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 transition-all disabled:opacity-50">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar Previsão
            </button>
            {!isClosed && (
              <button onClick={handleCloseScale} disabled={loading} className="inline-flex items-center rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-sm font-semibold text-white dark:text-zinc-900 shadow-sm hover:bg-black dark:hover:bg-white transition-all">
                <Lock className="mr-2 h-4 w-4" /> Fechar Escala
              </button>
            )}
            {isClosed && !isCompetenciaEncerrada && (userProfile?.role === 'admin' || userProfile?.role === 'super_admin') && (
              <button onClick={handleReopenScale} disabled={loading} className="inline-flex items-center rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 transition-all">
                <Unlock className="mr-2 h-4 w-4" /> Reabrir Escala
              </button>
            )}
          </div>
        </div>
      )}

      {/* Painel de Solicitações de Troca */}
      {!isComum && (
        <SwapRequestPanel
          unidadeId={unidadeId}
          setorId={setorId}
          mes={mes}
          ano={ano}
          isClosed={isClosed}
        />
      )}

      <div className="flex-1 overflow-auto no-print">
        <table className="w-full border-collapse text-[10px] table-fixed">
          <thead className="sticky top-0 z-20 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
            <tr>
              <th className="sticky left-0 z-30 bg-zinc-100 dark:bg-zinc-800 p-2 border border-zinc-200 dark:border-zinc-700 text-left w-[180px]">Servidor</th>
              <th className="sticky left-[180px] z-30 bg-zinc-100 dark:bg-zinc-800 p-2 border border-zinc-200 dark:border-zinc-700 w-[100px]">Tipo</th>
              {daysArray.map(day => {
                const d = new Date(ano, mes - 1, day)
                const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
                const isWE = d.getDay() === 0 || d.getDay() === 6
                const feriado = feriados.find(f => f.data === dateStr)
                const isHoliday = !!feriado

                return (
                  <th
                    key={day}
                    className={`p-1 border border-zinc-200 dark:border-zinc-700 min-w-[44px] w-[44px] text-center ${isHoliday ? 'bg-red-100 dark:bg-red-900/30 text-red-600' : isWE ? 'bg-zinc-200 dark:bg-zinc-700' : ''}`}
                    title={feriado?.descricao}
                  >
                    {day}
                    <div className="text-[8px] opacity-75">{['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][d.getDay()]}</div>
                  </th>
                )
              })}
              {!isTotalsCollapsed && (
                <>
                  <th className="sticky right-[296px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-blue-50 dark:bg-blue-900 text-blue-900 dark:text-blue-100">CH</th>
                  <th className="sticky right-[258px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">HE100</th>
                  <th className="sticky right-[220px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">HE50</th>
                  <th className="sticky right-[182px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">PL12</th>
                  <th className="sticky right-[144px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">PL6</th>
                  <th className="sticky right-[106px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">PL4</th>
                  <th className="sticky right-[68px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-emerald-50 dark:bg-emerald-900 text-emerald-900 dark:text-blue-100">SO12</th>
                </>
              )}
              <th className="sticky right-0 z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[68px] bg-amber-400 text-black font-black uppercase leading-tight text-[8px] whitespace-nowrap relative select-none">
                <button
                  type="button"
                  onClick={toggleTotals}
                  className="absolute -left-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 rounded-full bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-650 shadow-md hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-all hover:scale-105 active:scale-95 cursor-pointer z-50"
                  title={isTotalsCollapsed ? "Expandir resumo de horas" : "Recolher resumo de horas"}
                >
                  {isTotalsCollapsed ? (
                    <ChevronLeft className="h-3 w-3 stroke-[2.5]" />
                  ) : (
                    <ChevronRight className="h-3 w-3 stroke-[2.5]" />
                  )}
                </button>
                <div className="pl-1">
                  TOTAL<br/>H/MÊS
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleEscalaMensal.map(em => {
              const totals = calculateTotals(em.servidor_id)
              const categories: RowCategory[] = ['Regular', 'Extra', 'Plantão', 'Sobreaviso']
              const isExternal = em.servidores?.unidade_id !== unidadeId || em.servidores?.setor_id !== setorId
              
              return (
                <React.Fragment key={em.id}>
                  {categories.map((cat, catIdx) => (
                    <tr key={`${em.id}-${cat}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 group">
                      {catIdx === 0 && (
                        <td rowSpan={4} className="sticky left-0 z-10 bg-white dark:bg-zinc-900 p-2 border border-zinc-200 dark:border-zinc-700 font-bold whitespace-nowrap align-top text-zinc-900 dark:text-zinc-100">
                          <div className="flex items-center gap-2">
                            {em.servidores?.nome}
                            {hasConfirmedPresence(em.servidor_id, em.id) && (
                              <span title="Escala Protegida: Contém registros de presença">
                                <ShieldCheck className="h-3 w-3 text-emerald-500" />
                              </span>
                            )}
                            {isExternal && (
                              <span title="Servidor Externo">
                                <Globe className="h-3 w-3 text-blue-500" />
                              </span>
                            )}
                          </div>
                          <div className="text-[8px] font-normal text-zinc-600 dark:text-zinc-400 uppercase">{em.servidores?.cargo}</div>
                          {isExternal && (
                            <div className="text-[8px] text-blue-600 dark:text-blue-400 font-medium italic mt-1 leading-tight">
                              Origem: {allUnidades.find(u => u.id === em.servidores?.unidade_id)?.nome || '...'}
                              <br />
                              {allSetores.find(s => s.id === em.servidores?.setor_id)?.nome || '...'}
                            </div>
                          )}

                          {!isClosed && !hasConfirmedPresence(em.servidor_id, em.id) && (
                            <button
                              onClick={() => handleRemoveServer(em.id, em.servidor_id)}
                              className="mt-2 text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                              title="Remover Servidor da Escala"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </td>
                      )}
                      <td className={`sticky left-[180px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 font-bold uppercase text-zinc-800 dark:text-zinc-200 ${cat === 'Extra' ? 'bg-zinc-50 dark:bg-zinc-800/50' : 'bg-white dark:bg-zinc-900'}`}>
                        {cat === 'Regular' ? (
                          <select
                            value={em.jornada_id || ''}
                            onChange={(e) => {
                              const newJornadaId = e.target.value
                              setEscalaMensal(prev => prev.map(item => 
                                item.id === em.id ? { ...item, jornada_id: newJornadaId } : item
                              ))
                            }}
                            className={`w-full ${!em.jornada_id ? 'bg-red-50 dark:bg-red-900/10 text-red-500 animate-pulse' : 'bg-transparent'} border-none outline-none text-[10px] font-bold uppercase focus:ring-1 focus:ring-blue-500 rounded p-0 transition-colors`}
                          >
                            <option value="">Selecione...</option>
                            {jornadas.filter(j => j.ativo || j.id === em.jornada_id).map(j => (
                              <option key={j.id} value={j.id}>{j.nome} {!j.ativo ? '(Inativo)' : ''}</option>
                            ))}
                          </select>
                        ) : cat === 'Extra' ? 'EXTRAS' : cat === 'Plantão' ? 'PLANTÕES' : 'SOBREAVISO'}
                      </td>
                      {daysArray.map(day => {
                        const turnoId = gridData[em.servidor_id]?.[cat]?.[day] || ''
                        const turno = turnos.find(t => t.id === turnoId)
                        const d = new Date(ano, mes - 1, day)
                        const isWE = d.getDay() === 0 || d.getDay() === 6
                        const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
                        const feriado = feriados.find(f => f.data === dateStr)
                        const isHoliday = !!feriado
                        
                        let isTriggerAllowed = false
                        if (cat === 'Sobreaviso' && turno) {
                          const now = new Date()
                          let startHour = 7
                          let endHour = 16 // Padrão para MT: 07h às 16h
                          let endDayOffset = 0
                      
                          const code = turno.codigo || ''
                          if (code.startsWith('MTN')) {
                            startHour = 7
                            endHour = 7
                            endDayOffset = 1
                          } else if (code.startsWith('N')) {
                            startHour = 19
                            endHour = 7
                            endDayOffset = 1
                          } else if (code.startsWith('T')) {
                            startHour = 13
                            endHour = 19
                            endDayOffset = 0
                          } else if (code.startsWith('M') && !code.startsWith('MT')) {
                            startHour = 7
                            endHour = 13
                            endDayOffset = 0
                          } else if (code.startsWith('D') || code.startsWith('MT')) {
                            startHour = 7
                            endHour = (code === 'MT') ? 16 : 19
                            endDayOffset = 0
                          }
                      
                          const start = new Date(ano, mes - 1, day, startHour, 0, 0)
                          const end = new Date(ano, mes - 1, day + endDayOffset, endHour, 0, 0)
                      
                          isTriggerAllowed = now >= start && now < end
                        }

                        const { status: effectiveStatus, reason: virtualReason, log: logForDay } = cat === 'Sobreaviso' 
                          ? getStatusForDay(day, em.id, 'Sobreaviso') 
                          : { status: null, reason: null, log: null }

                        // Check for REAL external conflicts (different unit/sector)
                        const realExternalShifts = (externalOccupancy || []).filter((o: any) => 
                          o && o.servidor_id === em.servidor_id && 
                          o.dia === day && 
                          o.escala_mensal_id !== em.id
                        )
                        
                        // Current turno in THIS grid
                        const currentTurno = turnos.find(t => t.id === turnoId)
                        const currentSlots = currentTurno?.slots || []
                        
                        // Does it overlap with external? (Time-based conflict)
                        const hasExternalConflict = realExternalShifts.some((os: any) => 
                          Array.isArray(os.slots) && os.slots.some((s: string) => currentSlots.includes(s))
                        )
                        
                        // Is the server busy elsewhere IN THIS SPECIFIC CATEGORY?
                        const isBusyElsewhere = realExternalShifts.some((os: any) => 
                          os.categoria && cat && os.categoria.toLowerCase().trim() === cat.toLowerCase().trim()
                        )
                        
                        // Tooltip details
                        const externalBusyDetails = realExternalShifts
                          .filter((os: any) => os.categoria === cat)
                          .map((os: any) => os.descricao_conflito)
                          .join(' | ')

                        const realConflictDetails = realExternalShifts
                          .filter(os => os.slots.some((s: string) => currentSlots.includes(s)))
                          .map(os => os.descricao_conflito)
                          .join(' | ')

                        const isFailed = effectiveStatus === 'Falhou'
                        // Hide trigger button if currently pending (Accepted/Waiting)
                        // It SHOULD return if failed or arrived (as requested by user)
                        if (effectiveStatus === 'Aceito' || effectiveStatus === 'Aguardando') {
                          isTriggerAllowed = false
                        }
                        const isDisregarded = isFailed && desconsiderarFalha

                        const activeEvent = getActiveEventForDay(em.servidor_id, day)
                        const permitirPlantaoExtra = configs['permitir_plantao_extra_durante_eventos'] === 'true'
                        const isRegular = cat === 'Regular'
                        const isCellBlockedByEvent = activeEvent && (isRegular || !permitirPlantaoExtra)
                        const eventAbbr = activeEvent ? activeEvent.tipos_eventos?.nome.substring(0, 3).toUpperCase() : ''

                        return (
                          <td 
                            key={day} 
                            className={`p-0 border border-zinc-200 dark:border-zinc-700 text-center relative 
                              ${isCellBlockedByEvent ? '' : (isHoliday ? 'bg-red-50 dark:bg-red-900/10' : isWE ? 'bg-zinc-50 dark:bg-zinc-800/50' : '')} 
                              ${isFailed ? 'bg-red-100 dark:bg-red-900/30' : ''} 
                              ${hasExternalConflict ? 'ring-1 ring-inset ring-red-500' : ''}
                              ${(presenceData[em.servidor_id]?.[cat]?.[day]?.entrada || presenceData[em.servidor_id]?.[cat]?.[day]?.saida || effectiveStatus === 'Chegou') ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : ''}`}
                            title={
                              isCellBlockedByEvent 
                                ? `⚠️ BLOQUEADO: Servidor em afastamento (${activeEvent.tipos_eventos?.nome})${activeEvent.observacao ? ` - ${activeEvent.observacao}` : ''}`
                                : hasExternalConflict 
                                  ? `⚠️ CONFLITO REAL: ${realConflictDetails}` 
                                  : isBusyElsewhere
                                    ? `ℹ️ Servidor já escalado em: ${externalBusyDetails}`
                                    : isFailed 
                                      ? `FALHOU: ${logForDay?.motivo_falha || virtualReason || 'Tempo expirado'}${isDisregarded ? ' (Desconsiderado da carga horária)' : ''}` 
                                      : isHoliday
                                        ? `🎉 Feriado: ${feriado?.descricao}`
                                        : activeEvent
                                          ? `ℹ️ Servidor em afastamento (${activeEvent.tipos_eventos?.nome}) - Alocação permitida por governança`
                                          : ''
                            }
                          >
                            {isCellBlockedByEvent ? (
                              <div 
                                className="w-full h-full flex items-center justify-center text-[9px] font-black text-white cursor-not-allowed select-none px-0.5 py-2"
                                style={{ backgroundColor: activeEvent.tipos_eventos?.cor || '#EF4444' }}
                              >
                                {eventAbbr}
                              </div>
                            ) : (
                              <div className="relative w-full h-full">
                                {activeEvent && (
                                  <div 
                                    className="absolute inset-0 pointer-events-none opacity-20"
                                    style={{ backgroundColor: activeEvent.tipos_eventos?.cor || '#EF4444' }}
                                  />
                                )}
                                <input
                                  list={
                                    cat === 'Sobreaviso' ? 'turnos-sobreaviso-list' :
                                    cat === 'Extra' ? 'turnos-extra-list' :
                                    cat === 'Plantão' ? 'turnos-plantao-list' :
                                    'turnos-normal-list'
                                  }
                                  value={turno?.codigo || ''}
                                  disabled={isCompetenciaEncerrada || escalaMensal[0]?.status === 'Fechada' || (isClosed && userProfile?.role !== 'admin' && userProfile?.role !== 'super_admin')}
                                  onChange={(e) => {
                                    const val = e.target.value.toUpperCase()
                                    const targetTipo = cat === 'Sobreaviso' ? 'Sobreaviso' : cat === 'Extra' ? 'Extra' : cat === 'Plantão' ? 'Plantão' : 'Normal'
                                    
                                    if (val !== '') {
                                      const hasMatch = turnos.some(x => x.ativo !== false && x.tipo && x.tipo.split(',').map((s: string) => s.trim()).includes(targetTipo) && x.codigo.startsWith(val))
                                      if (!hasMatch) return
                                    }
                                    const t = turnos.find(x => x.ativo !== false && x.tipo && x.tipo.split(',').map((s: string) => s.trim()).includes(targetTipo) && x.codigo === val)
                                    handleCellChange(em.servidor_id, cat, day, t?.id || '')
                                  }}
                                  className={`w-full h-full bg-transparent border-none text-center focus:outline-none focus:ring-1 focus:ring-blue-500 font-black p-0 text-[11px] uppercase ${isFailed ? 'text-red-600 dark:text-red-400 line-through' : 'text-zinc-900 dark:text-zinc-100'}`}
                                  placeholder="-"
                                />
                                {activeEvent && (
                                  <div 
                                    className="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full"
                                    style={{ backgroundColor: activeEvent.tipos_eventos?.cor || '#EF4444' }}
                                    title={`Afastamento: ${activeEvent.tipos_eventos?.nome}`}
                                  />
                                )}
                              </div>
                            )}

                            {/* Indicador de Compliance (Interjornada/DSR) */}
                            {(() => {
                              const cellViolations = getViolationsForCell(complianceViolations, em.servidor_id, day)
                              if (cellViolations.length === 0 || cat !== 'Regular') return null
                              return (
                                <div 
                                  className="absolute top-0 left-0 w-0 h-0 z-20" 
                                  style={{ borderLeft: '8px solid #f59e0b', borderBottom: '8px solid transparent' }}
                                  title={`⚠️ ${cellViolations.map(v => v.message).join(' | ')}`}
                                />
                              )
                            })()}
                            {/* Indicador de Ocupação Externa (Bônus) */}
                            {isBusyElsewhere && !hasExternalConflict && (
                              <div 
                                className="absolute top-1 right-1 w-2 h-2 bg-blue-500 rounded-full z-30 shadow-sm border border-white dark:border-zinc-800" 
                                title={`Trabalha em outro setor: ${realExternalShifts.find(os => os.categoria?.toLowerCase().trim() === cat.toLowerCase().trim())?.descricao_conflito || ''}`}
                              />
                            )}
                            {isFailed && permitirValidacaoManual && !isClosed && (userProfile?.role === 'admin' || userProfile?.role === 'super_admin') && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (logForDay) handleManualOverride(logForDay.id)
                                }}
                                disabled={loading}
                                className="absolute bottom-[2px] right-[2px] hidden group-hover:flex h-3 w-3 items-center justify-center rounded bg-red-600 text-white z-30 hover:bg-green-600 transition-colors shadow-sm"
                                title="Validar Manualmente (Remover Falha)"
                              >
                                <CheckCircle className="h-2 w-2" />
                              </button>
                            )}

                            {/* Indicadores de Status em Tempo Real (Sobreaviso) - Somente se houver turno escalado */}
                            {cat === 'Sobreaviso' && turnoId && (
                              <>
                                {effectiveStatus === 'Aguardando' && (
                                  <div className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-white z-20 shadow-sm border border-white dark:border-zinc-800" title="Aguardando Aceite">
                                    <Clock className="h-2 w-2" />
                                  </div>
                                )}
                                {effectiveStatus === 'Aceito' && (
                                  <div className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-white z-20 shadow-sm border border-white dark:border-zinc-800 animate-pulse" title="Em Deslocamento">
                                    <Navigation2 className="h-2 w-2 fill-current" />
                                  </div>
                                )}
                                {effectiveStatus === 'Chegou' && (
                                  <div className="absolute -top-1 -left-1 flex h-3 w-3 items-center justify-center rounded-full bg-blue-500 text-white z-20 shadow-sm border border-white dark:border-zinc-800" title="Servidor chegou">
                                    <Check className="h-2 w-2" />
                                  </div>
                                )}
                              </>
                            )}
                            {isTriggerAllowed && (
                              <button 
                                onClick={() => setTriggerModal({
                                  isOpen: true,
                                  servidorId: em.servidor_id,
                                  servidorNome: em.servidores?.nome || 'Servidor',
                                  turnoId: turno.id,
                                  escalaMensalId: em.id,
                                  dia: day
                                })}
                                disabled={loading}
                                className="absolute -top-1 -right-1 hidden group-hover:flex h-3 w-3 items-center justify-center rounded-full bg-orange-500 text-white z-30 hover:bg-orange-600 transition-colors shadow-sm"
                              >
                                <span title="Acionar Sobreaviso">
                                  <Zap className="h-2 w-2 fill-current" />
                                </span>
                              </button>
                            )}

                            {/* Indicador de Presença (Entrada/Saída) */}
                            {turnoId && cat !== 'Sobreaviso' && (
                              <div className="absolute bottom-0 left-0 right-0 h-[3px] flex gap-[1px] z-20">
                                {(() => {
                                  const today = new Date()
                                  const currentDay = today.getDate()
                                  const currentMonth = today.getMonth() + 1
                                  const currentYear = today.getFullYear()
                                  const currentHour = today.getHours()
                                  
                                  const d = new Date(ano, mes - 1, day)
                                  const isPast = d < new Date(currentYear, currentMonth - 1, currentDay)
                                  const isToday = day === currentDay && mes === currentMonth && ano === currentYear
                                  
                                  const presence = presenceData[em.servidor_id]?.[cat]?.[day] || { entrada: false, saida: false }

                                  // Lógica para determinar se o turno já deveria ter começado ou terminado
                                  const redEntrada = isRedIndicator(day, cat, 'entrada')
                                  const redSaida = isRedIndicator(day, cat, 'saida')

                                  const canEditPresence = !isCompetenciaEncerrada && escalaMensal[0]?.status !== 'Fechada' && (!isClosed || userProfile?.role === 'admin' || userProfile?.role === 'super_admin') && (userProfile?.role === 'admin' || userProfile?.role === 'super_admin' || userProfile?.role === 'coordenador')

                                  return (
                                    <>
                                      {/* Metade Entrada */}
                                      <div 
                                        onClick={(e) => {
                                          if (!canEditPresence) return
                                          e.stopPropagation()
                                          setManualPresenceModal({
                                            isOpen: true,
                                            servidorId: em.servidor_id,
                                            servidorNome: em.servidores?.nome,
                                            dia: day,
                                            categoria: cat,
                                            tipo: 'entrada',
                                            escalaMensalId: em.id,
                                            isReverting: !!presence.entrada
                                          })
                                        }}
                                        className={`flex-1 h-full cursor-pointer transition-colors ${presence.entrada ? 'bg-emerald-500 hover:bg-emerald-600' : (redEntrada ? 'bg-red-500 hover:bg-red-600' : 'bg-transparent hover:bg-zinc-300 dark:hover:bg-zinc-600')}`} 
                                        title={presence.entrada ? "Entrada Confirmada (Clique para reverter)" : (redEntrada ? "Entrada Faltante/Pendente" : "Entrada Programada")} 
                                      />
                                      {/* Metade Saída */}
                                      <div 
                                        onClick={(e) => {
                                          if (!canEditPresence) return
                                          e.stopPropagation()
                                          setManualPresenceModal({
                                            isOpen: true,
                                            servidorId: em.servidor_id,
                                            servidorNome: em.servidores?.nome,
                                            dia: day,
                                            categoria: cat,
                                            tipo: 'saida',
                                            escalaMensalId: em.id,
                                            isReverting: !!presence.saida
                                          })
                                        }}
                                        className={`flex-1 h-full cursor-pointer transition-colors ${presence.saida ? 'bg-emerald-500 hover:bg-emerald-600' : (presence.entrada && isToday ? 'bg-amber-400 animate-pulse hover:bg-amber-500' : (redSaida ? 'bg-red-500 hover:bg-red-600' : 'bg-transparent hover:bg-zinc-300 dark:hover:bg-zinc-600'))}`} 
                                        title={presence.saida ? "Saída Confirmada (Clique para reverter)" : (presence.entrada && isToday ? "Em Plantão" : (redSaida ? "Saída Faltante/Pendente" : "Saída Programada"))} 
                                      />
                                    </>
                                  )
                                })()}
                              </div>
                            )}
                          </td>
                        )
                      })}
                      {catIdx === 0 && (
                        <>
                          {!isTotalsCollapsed && (
                            <>
                              {/* CH */}
                              <td rowSpan={4} className="sticky right-[296px] z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-blue-50 dark:bg-blue-900 text-blue-900 dark:text-blue-100">
                                <div className="flex flex-col h-full divide-y divide-blue-200 dark:divide-blue-800">
                                  <div className="flex-1 flex flex-col justify-center p-1 opacity-60">
                                    <span className="text-[6px] uppercase leading-none">Plan</span>
                                    <span className="text-[10px] leading-tight">{totals.p_ch}</span>
                                  </div>
                                  <div className="flex-1 flex flex-col justify-center p-1 bg-blue-100/50 dark:bg-blue-800/30">
                                    <span className="text-[6px] uppercase leading-none">Val</span>
                                    <span className="text-[10px] leading-tight">{totals.chTotal}</span>
                                  </div>
                                </div>
                              </td>
                              {/* HE100 */}
                              <td rowSpan={4} className="sticky right-[258px] z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">
                                <div className="flex flex-col h-full divide-y divide-indigo-200 dark:divide-indigo-800">
                                  <div className="flex-1 flex flex-col justify-center p-1 opacity-60">
                                    <span className="text-[6px] uppercase leading-none">Plan</span>
                                    <span className="text-[10px] leading-tight">{totals.p_he100}</span>
                                  </div>
                                  <div className="flex-1 flex flex-col justify-center p-1 bg-indigo-100/50 dark:bg-indigo-800/30">
                                    <span className="text-[6px] uppercase leading-none">Val</span>
                                    <span className="text-[10px] leading-tight">{totals.he100}</span>
                                  </div>
                                </div>
                              </td>
                              {/* HE50 */}
                              <td rowSpan={4} className="sticky right-[220px] z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">
                                <div className="flex flex-col h-full divide-y divide-indigo-200 dark:divide-indigo-800">
                                  <div className="flex-1 flex flex-col justify-center p-1 opacity-60">
                                    <span className="text-[6px] uppercase leading-none">Plan</span>
                                    <span className="text-[10px] leading-tight">{totals.p_he50}</span>
                                  </div>
                                  <div className="flex-1 flex flex-col justify-center p-1 bg-indigo-100/50 dark:bg-indigo-800/30">
                                    <span className="text-[6px] uppercase leading-none">Val</span>
                                    <span className="text-[10px] leading-tight">{totals.he50}</span>
                                  </div>
                                </div>
                              </td>
                              {/* PL12 */}
                              <td rowSpan={4} className="sticky right-[182px] z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">
                                <div className="flex flex-col h-full divide-y divide-orange-200 dark:divide-orange-800">
                                  <div className="flex-1 flex flex-col justify-center p-1 opacity-60">
                                    <span className="text-[6px] uppercase leading-none">Plan</span>
                                    <span className="text-[10px] leading-tight">{totals.p_pl12}</span>
                                  </div>
                                  <div className="flex-1 flex flex-col justify-center p-1 bg-orange-100/50 dark:bg-orange-800/30">
                                    <span className="text-[6px] uppercase leading-none">Val</span>
                                    <span className="text-[10px] leading-tight">{totals.pl12}</span>
                                  </div>
                                </div>
                              </td>
                              {/* PL6 */}
                              <td rowSpan={4} className="sticky right-[144px] z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">
                                <div className="flex flex-col h-full divide-y divide-orange-200 dark:divide-orange-800">
                                  <div className="flex-1 flex flex-col justify-center p-1 opacity-60">
                                    <span className="text-[6px] uppercase leading-none">Plan</span>
                                    <span className="text-[10px] leading-tight">{totals.p_pl6}</span>
                                  </div>
                                  <div className="flex-1 flex flex-col justify-center p-1 bg-orange-100/50 dark:bg-orange-800/30">
                                    <span className="text-[6px] uppercase leading-none">Val</span>
                                    <span className="text-[10px] leading-tight">{totals.pl6}</span>
                                  </div>
                                </div>
                              </td>
                              {/* PL4 */}
                              <td rowSpan={4} className="sticky right-[106px] z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">
                                <div className="flex flex-col h-full divide-y divide-orange-200 dark:divide-orange-800">
                                  <div className="flex-1 flex flex-col justify-center p-1 opacity-60">
                                    <span className="text-[6px] uppercase leading-none">Plan</span>
                                    <span className="text-[10px] leading-tight">{totals.p_pl4}</span>
                                  </div>
                                  <div className="flex-1 flex flex-col justify-center p-1 bg-orange-100/50 dark:bg-orange-800/30">
                                    <span className="text-[6px] uppercase leading-none">Val</span>
                                    <span className="text-[10px] leading-tight">{totals.pl4}</span>
                                  </div>
                                </div>
                              </td>
                              {/* SO12 */}
                              <td rowSpan={4} className="sticky right-[68px] z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-emerald-50 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100">
                                <div className="flex flex-col h-full divide-y divide-emerald-200 dark:divide-emerald-800">
                                  <div className="flex-1 flex flex-col justify-center p-1 opacity-60">
                                    <span className="text-[6px] uppercase leading-none">Plan</span>
                                    <span className="text-[10px] leading-tight">{totals.p_so12}</span>
                                  </div>
                                  <div className="flex-1 flex flex-col justify-center p-1 bg-emerald-100/50 dark:bg-emerald-800/30">
                                    <span className="text-[6px] uppercase leading-none">Val</span>
                                    <span className="text-[10px] leading-tight">{totals.so12}</span>
                                  </div>
                                </div>
                              </td>
                            </>
                          )}

                          <td rowSpan={4} className="sticky right-0 z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-amber-400 text-black">
                            <div className="flex flex-col h-full divide-y divide-black/10">
                              <div className="flex-1 flex flex-col justify-center p-1">
                                <span className="text-[7px] uppercase leading-none opacity-60">Planejado</span>
                                <span className="text-[11px] leading-tight">{totals.totalPlanejado}</span>
                              </div>
                              <div className="flex-1 flex flex-col justify-center p-1 bg-black/5">
                                <span className="text-[7px] uppercase leading-none opacity-60">Validado</span>
                                <span className="text-[11px] leading-tight">{totals.totalGeral}</span>
                              </div>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </React.Fragment>
              )
            })}
          </tbody>
          <tfoot className="bg-zinc-100 dark:bg-zinc-800">
            <tr>
              <td rowSpan={4} className="sticky left-0 z-10 bg-zinc-200 dark:bg-zinc-700 p-2 border border-zinc-300 dark:border-zinc-600 text-center align-middle uppercase text-sm font-black text-zinc-900 dark:text-zinc-100">
                SERVIDORES POR TURNO
              </td>
              <td className="sticky left-[180px] z-10 bg-white dark:bg-zinc-900 p-1 border border-zinc-300 dark:border-zinc-600 uppercase text-[10px] text-center font-bold text-zinc-800 dark:text-zinc-200">
                MANHÃ
              </td>
              {daysArray.map(day => {
                const count = shiftTotals.M[day] || 0
                const { className, title } = getShiftTotalStyleAndTooltip(count, 'M', day)
                return (
                  <td key={day} className={`p-1 border border-zinc-300 dark:border-zinc-600 text-center text-[11px] font-bold ${className || 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'}`} title={title}>
                    {count || ''}
                  </td>
                )
              })}
              <td colSpan={isTotalsCollapsed ? 1 : 8} rowSpan={4} className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600"></td>
            </tr>
            <tr>
              <td className="sticky left-[180px] z-10 bg-white dark:bg-zinc-900 p-1 border border-zinc-300 dark:border-zinc-600 uppercase text-[10px] text-center font-bold text-zinc-800 dark:text-zinc-200">
                TARDE
              </td>
              {daysArray.map(day => {
                const count = shiftTotals.T[day] || 0
                const { className, title } = getShiftTotalStyleAndTooltip(count, 'T', day)
                return (
                  <td key={day} className={`p-1 border border-zinc-300 dark:border-zinc-600 text-center text-[11px] font-bold ${className || 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'}`} title={title}>
                    {count || ''}
                  </td>
                )
              })}
            </tr>
            <tr>
              <td className="sticky left-[180px] z-10 bg-white dark:bg-zinc-900 p-1 border border-zinc-300 dark:border-zinc-600 uppercase text-[10px] text-center font-bold text-zinc-800 dark:text-zinc-200">
                NOITE
              </td>
              {daysArray.map(day => {
                const count = shiftTotals.N[day] || 0
                const { className, title } = getShiftTotalStyleAndTooltip(count, 'N', day)
                return (
                  <td key={day} className={`p-1 border border-zinc-300 dark:border-zinc-600 text-center text-[11px] font-bold ${className || 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'}`} title={title}>
                    {count || ''}
                  </td>
                )
              })}
            </tr>
            <tr>
              <td className="sticky left-[180px] z-10 bg-white dark:bg-zinc-900 p-1 border border-zinc-300 dark:border-zinc-600 uppercase text-[10px] text-center font-bold text-zinc-800 dark:text-zinc-200">
                SOBREAVISO
              </td>
              {daysArray.map(day => (
                <td key={day} className="p-1 border border-zinc-300 dark:border-zinc-600 text-center bg-white dark:bg-zinc-900 text-[11px] font-bold text-zinc-900 dark:text-zinc-100">
                  {shiftTotals.S[day] || ''}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>

        <datalist id="turnos-normal-list">
          {turnos.filter(t => t.ativo !== false && t.tipo && t.tipo.split(',').map((s: string) => s.trim()).includes('Normal')).map(t => (
            <option key={t.id} value={t.codigo}>{t.descricao}</option>
          ))}
        </datalist>

        <datalist id="turnos-plantao-list">
          {turnos.filter(t => t.ativo !== false && t.tipo && t.tipo.split(',').map((s: string) => s.trim()).includes('Plantão')).map(t => (
            <option key={t.id} value={t.codigo}>{t.descricao}</option>
          ))}
        </datalist>

        <datalist id="turnos-sobreaviso-list">
          {turnos.filter(t => t.ativo !== false && t.tipo && t.tipo.split(',').map((s: string) => s.trim()).includes('Sobreaviso')).map(t => (
            <option key={t.id} value={t.codigo}>{t.descricao}</option>
          ))}
        </datalist>

        <datalist id="turnos-extra-list">
          {turnos.filter(t => t.ativo !== false && t.tipo && t.tipo.split(',').map((s: string) => s.trim()).includes('Extra')).map(t => (
            <option key={t.id} value={t.codigo}>{t.descricao}</option>
          ))}
        </datalist>
      </div>

      </div> {/* Closes the main print:hidden container */}

      {/* Actual Print View Hidden component */}
      <ScalePrintView 
        unidade={allUnidades.find(u => u.id === unidadeId)}
        setor={allSetores.find(s => s.id === setorId)}
        mes={mes}
        ano={ano}
        escalaMensal={escalaMensal}
        gridData={gridData} 
        turnos={turnos}
        jornadas={jornadas}
        shiftTotals={shiftTotals}
        servidoresEventos={servidoresEventos}
        permitirPlantaoExtra={configs['permitir_plantao_extra_durante_eventos'] === 'true'}
      />
      {/* Modal de Acionamento de Sobreaviso */}
      {triggerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-md p-6 border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3 mb-4 text-orange-600">
              <Zap className="h-6 w-6 fill-current" />
              <h2 className="text-xl font-bold">Acionar Sobreaviso</h2>
            </div>
            
            <div className="space-y-4">
              {!generatedLink ? (
                <>
                  <div>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">Informações do Acionamento:</p>
                    <div className="bg-zinc-100 dark:bg-zinc-800 p-3 rounded-lg space-y-1">
                      <p className="font-bold text-zinc-900 dark:text-white">{triggerModal.servidorNome}</p>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 uppercase">{unidadeId} - {setorId}</p>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-zinc-600 dark:text-zinc-400 block mb-1">Motivo do Acionamento:</label>
                    <textarea 
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      className="w-full h-24 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-orange-500 outline-none resize-none"
                      placeholder="Descreva o motivo do acionamento..."
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button 
                      onClick={handleCloseModal}
                      className="flex-1 px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button 
                      onClick={confirmTriggerSobreaviso}
                      disabled={loading || !motivo}
                      className="flex-1 px-4 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-4 rounded-lg text-center">
                    <p className="text-emerald-700 dark:text-emerald-400 text-sm font-medium mb-1">
                      Acionamento Registrado!
                    </p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-500">
                      Envie o link abaixo para o servidor confirmar o chamado.
                    </p>
                  </div>

                  <div className="bg-zinc-100 dark:bg-zinc-800 p-3 rounded-lg break-all text-[10px] font-mono text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                    {generatedLink}
                  </div>

                  <div className="flex flex-col gap-2">
                    <button 
                      onClick={() => {
                        const tempoAceite = configsGlobais.find(c => c.chave === 'sobreaviso_tempo_aceite_minutos')?.valor || '30'
                        const text = `Olá *${triggerModal.servidorNome}*, você foi acionado(a) para um chamado de Sobreaviso.\n\n*Motivo:*\n${motivo}\n\n*Você tem ${tempoAceite} minutos para aceitar esse chamado.*\n\n*Para confirmar seu aceite, acesse o link abaixo:*\n${generatedLink}`
                        navigator.clipboard.writeText(text)
                        setAlertModal({
                          isOpen: true,
                          title: 'Link Copiado',
                          message: 'Mensagem completa copiada para a área de transferência!',
                          type: 'success'
                        })
                      }}
                      className="w-full px-4 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                    >
                      Copiar Link
                    </button>
                    
                    <button 
                      onClick={() => {
                        const tempoAceite = configsGlobais.find(c => c.chave === 'sobreaviso_tempo_aceite_minutos')?.valor || '30'
                        // Formatação usando Markdown do WhatsApp (* para negrito)
                        const text = encodeURIComponent(`Olá *${triggerModal.servidorNome}*, você foi acionado(a) para um chamado de Sobreaviso.\n\n*Motivo:*\n${motivo}\n\n*Você tem ${tempoAceite} minutos para aceitar esse chamado.*\n\n*Para confirmar seu aceite, acesse o link abaixo:*\n${generatedLink}`)
                        window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank')
                      }}
                      className="w-full px-4 py-2 rounded-lg bg-green-600 text-white font-bold hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                    >
                      Enviar via WhatsApp
                    </button>
                    <button 
                      onClick={handleCloseModal}
                      className="w-full px-4 py-2 rounded-lg text-zinc-600 dark:text-zinc-400 text-xs hover:underline"
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Modal Servidor Externo */}
      {isExternalModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-md overflow-hidden" style={{ maxWidth: '450px' }}>
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50">
              <h2 className="text-xl font-bold flex items-center gap-2 text-zinc-900 dark:text-white">
                <Globe className="h-5 w-5 text-blue-600" />
                Adicionar Servidor Externo
              </h2>
              <button onClick={() => setIsExternalModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Unidade de Origem</label>
                <select 
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all text-zinc-900 dark:text-white"
                  value={externalData.unidadeId}
                  onChange={(e) => setExternalData(prev => ({ ...prev, unidadeId: e.target.value }))}
                >
                  <option value="">Selecione a Unidade</option>
                  {allUnidades.map(u => (
                    <option key={u.id} value={u.id}>{u.nome}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Setor de Origem</label>
                <select 
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50 text-zinc-900 dark:text-white"
                  value={externalData.setorId}
                  disabled={!externalData.unidadeId}
                  onChange={(e) => setExternalData(prev => ({ ...prev, setorId: e.target.value }))}
                >
                  <option value="">Selecione o Setor</option>
                  {externalSectors.map(s => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Servidor</label>
                <select 
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50 text-zinc-900 dark:text-white"
                  value={externalData.servidorId}
                  disabled={!externalData.setorId}
                  onChange={(e) => setExternalData(prev => ({ ...prev, servidorId: e.target.value }))}
                >
                  <option value="">Selecione o Servidor</option>
                  {externalServers.map(s => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-6 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-3">
              <button 
                onClick={() => setIsExternalModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleAddExternalServer}
                disabled={!externalData.servidorId || loading}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-all disabled:opacity-50 shadow-lg shadow-blue-500/20 min-w-[120px]"
              >
                {loading ? 'Adicionando...' : 'Adicionar na Grade'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Template de Escala */}
      {templateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50">
              <h2 className="text-xl font-bold flex items-center gap-2 text-zinc-900 dark:text-white">
                <LayoutTemplate className="h-5 w-5 text-purple-600" />
                Aplicar Template de Escala
              </h2>
              <button onClick={() => setTemplateModal(null)} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Servidor</label>
                <select
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500 text-zinc-900 dark:text-white"
                  value={templateModal.servidorId}
                  onChange={(e) => setTemplateModal(prev => prev ? { ...prev, servidorId: e.target.value } : null)}
                >
                  {escalaMensal.map(em => (
                    <option key={em.servidor_id} value={em.servidor_id}>{em.servidores?.nome}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Modelo de Escala</label>
                <select
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500 text-zinc-900 dark:text-white"
                  value={templateModal.templateType}
                  onChange={(e) => setTemplateModal(prev => prev ? { ...prev, templateType: e.target.value as TemplateType } : null)}
                >
                  {TEMPLATE_OPTIONS.map(opt => (
                    <option key={opt.type} value={opt.type}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-[10px] text-zinc-500">
                  {TEMPLATE_OPTIONS.find(o => o.type === templateModal.templateType)?.description}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Turno a Aplicar</label>
                <select
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500 text-zinc-900 dark:text-white"
                  value={templateModal.turnoId}
                  onChange={(e) => setTemplateModal(prev => prev ? { ...prev, turnoId: e.target.value } : null)}
                >
                  {turnos.filter(t => t.ativo !== false).map(t => (
                    <option key={t.id} value={t.id}>{t.codigo} — {t.descricao}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Dia de Início</label>
                  <input
                    type="number"
                    min={1}
                    max={daysInMonth}
                    value={templateModal.startDay}
                    onChange={(e) => setTemplateModal(prev => prev ? { ...prev, startDay: Math.max(1, Math.min(daysInMonth, parseInt(e.target.value) || 1)) } : null)}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500 text-zinc-900 dark:text-white"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Início</label>
                  <select
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500 text-zinc-900 dark:text-white"
                    value={templateModal.startWorking ? 'true' : 'false'}
                    onChange={(e) => setTemplateModal(prev => prev ? { ...prev, startWorking: e.target.value === 'true' } : null)}
                  >
                    <option value="true">Trabalhando</option>
                    <option value="false">Folgando</option>
                  </select>
                </div>
              </div>

              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 p-3 rounded-lg">
                <p className="text-[10px] text-purple-700 dark:text-purple-400">
                  ⚠️ Dias com presença já confirmada <strong>não serão sobrescritos</strong>. O template preenche apenas a linha <strong>Regular</strong>.
                </p>
              </div>
            </div>

            <div className="p-6 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-3">
              <button
                onClick={() => setTemplateModal(null)}
                className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (!templateModal) return
                  const sId = templateModal.servidorId
                  const em = escalaMensal.find(x => x.servidor_id === sId)
                  if (!em) return

                  // Coletar dias protegidos (presença confirmada)
                  const protectedDays = new Set<number>()
                  for (let d = 1; d <= daysInMonth; d++) {
                    if (hasPresenceForDay(sId, em.id, 'Regular', d)) {
                      protectedDays.add(d)
                    }
                  }

                  const templateResult = generateTemplate(
                    {
                      type: templateModal.templateType,
                      turnoId: templateModal.turnoId,
                      startDay: templateModal.startDay,
                      startWorking: templateModal.startWorking
                    },
                    daysInMonth,
                    mes,
                    ano,
                    protectedDays
                  )

                  // Injetar no gridData apenas na linha Regular
                  setGridData(prev => ({
                    ...prev,
                    [sId]: {
                      ...prev[sId],
                      'Regular': { ...templateResult }
                    }
                  }))

                  const workDays = countWorkDays(templateResult)
                  logAction('APLICAR_TEMPLATE', {
                    servidor_id: sId,
                    template: templateModal.templateType,
                    dias_preenchidos: workDays,
                    dias_protegidos: protectedDays.size
                  })

                  setTemplateModal(null)
                  setAlertModal({
                    isOpen: true,
                    title: 'Template Aplicado',
                    message: `Template ${templateModal.templateType} aplicado com sucesso! ${workDays} dias preenchidos${protectedDays.size > 0 ? `, ${protectedDays.size} dias protegidos por presença` : ''}. Lembre-se de salvar a escala.`,
                    type: 'success'
                  })
                }}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold rounded-lg transition-all shadow-lg shadow-purple-500/20 min-w-[140px]"
              >
                Aplicar Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals Extras */}
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

      {manualPresenceModal && (
        <Modal
          isOpen={manualPresenceModal.isOpen}
          onClose={() => setManualPresenceModal(null)}
          title={manualPresenceModal.isReverting ? `Reverter ${manualPresenceModal.tipo === 'entrada' ? 'Entrada' : 'Saída'} Manual` : `Validar ${manualPresenceModal.tipo === 'entrada' ? 'Entrada' : 'Saída'} Manual`}
          type={manualPresenceModal.isReverting ? "danger" : "warning"}
          footer={
            <>
              <button
                onClick={() => setManualPresenceModal(null)}
                className="flex-1 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmManualPresence}
                disabled={loading}
                className={`flex-1 px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 ${
                  manualPresenceModal.isReverting 
                    ? "bg-red-600 hover:bg-red-700 text-white" 
                    : "bg-amber-600 hover:bg-amber-700 text-white"
                }`}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (manualPresenceModal.isReverting ? 'Confirmar Reversão' : 'Confirmar Validação')}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {manualPresenceModal.isReverting ? (
                <>Você deseja <strong>reverter</strong> a <strong>{manualPresenceModal.tipo}</strong> do servidor <strong>{manualPresenceModal.servidorNome}</strong> para o dia <strong>{manualPresenceModal.dia}</strong>?</>
              ) : (
                <>Você está validando manualmente a <strong>{manualPresenceModal.tipo}</strong> do servidor <strong>{manualPresenceModal.servidorNome}</strong> para o dia <strong>{manualPresenceModal.dia}</strong>.</>
              )}
            </p>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 rounded-lg">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Esta ação será registrada com seu usuário para fins de auditoria.
              </p>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
