'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Save, Loader2, Info, Zap, Lock, FileText, Plus, UserPlus, Users, CheckCircle, Trash2, Globe, X } from 'lucide-react'
import { ScalePrintView } from '@/components/ScalePrintView'
import React from 'react'

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
  feriados,
  diasInativacao,
  logsSobreavisoInicial,
  configsGlobais
}: ScaleGridProps) {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [escalaMensal, setEscalaMensal] = useState(escalaMensalInicial)
  const [logsSobreaviso, setLogsSobreaviso] = useState(logsSobreavisoInicial)
  
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

  useEffect(() => {
    const fetchData = async () => {
      // Fetch user role
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()
        if (profile) setUserRole(profile.role)
      }

      // Fetch all units and sectors for external server logic
      const { data: units } = await supabase.from('unidades').select('*').eq('ativo', true).order('nome')
      const { data: sectors } = await supabase.from('setores').select('*').eq('ativo', true).order('nome')
      const { data: journeys } = await supabase.from('jornadas').select('*').order('nome')
      if (units) setAllUnidades(units)
      if (sectors) setAllSetores(sectors)
      if (journeys) setJornadas(journeys)
    }
    fetchData()
  }, [supabase])

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
          .from('servidores')
          .select('*')
          .eq('setor_id', externalData.setorId)
          .eq('status', 'Ativo')
          .order('nome')
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

  const daysInMonth = useMemo(() => new Date(ano, mes, 0).getDate(), [mes, ano])
  const daysArray = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth])

  const getStatusForDay = useCallback((day: number, emId: string) => {
    const logs = logsSobreaviso.filter(l => l.escala_mensal_id === emId && l.dia === day)
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
          const { status: effectiveStatus } = getStatusForDay(day, em.id)
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

  const handleClearScale = () => {
    if (confirm('Deseja limpar todos os lançamentos desta escala? Esta ação não pode ser desfeita até que você salve novamente.')) {
      setGridData({})
      alert('Escala limpa! Não esqueça de salvar.')
    }
  }

  const handleAddExternalServer = async () => {
    if (!externalData.servidorId) return

    // Check if already in grid
    if (escalaMensal.some(em => em.servidor_id === externalData.servidorId)) {
      alert('Este servidor já está nesta escala.')
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
      setIsExternalModalOpen(false)
      alert('Servidor externo adicionado!')
    } catch (error: any) {
      alert('Erro ao adicionar servidor: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveServer = async (escalaMensalId: string, servidorId: string) => {
    if (isClosed) return
    if (!confirm('Deseja remover este servidor e todos os seus lançamentos desta escala?')) return

    setLoading(true)
    try {
      // Delete daily records first
      await supabase.from('escala_diaria').delete().eq('escala_mensal_id', escalaMensalId)
      
      // Delete monthly record
      const { error } = await supabase.from('escala_mensal').delete().eq('id', escalaMensalId)

      if (error) throw error

      // Update local state
      setEscalaMensal(prev => prev.filter(em => em.id !== escalaMensalId))
      setGridData(prev => {
        const newData = { ...prev }
        delete newData[servidorId]
        return newData
      })
      alert('Servidor removido com sucesso!')
    } catch (error: any) {
      alert('Erro ao remover servidor: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const getDayOfWeek = (day: number) => {
    return new Date(ano, mes - 1, day).getDay()
  }

  const handleCellChange = (servidorId: string, categoria: RowCategory, day: number, turnoId: string) => {
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
  }

  const calculateTotals = (servidorId: string) => {
    const serverData = gridData[servidorId] || { 'Regular': {}, 'Extra': {}, 'Plantão': {}, 'Sobreaviso': {} }
    
    let chTotal = 0
    let he100 = 0
    let he50 = 0
    let pl12 = 0
    let pl6 = 0
    let pl4 = 0
    let so12 = 0

    // Sum Regular CH
    Object.values(serverData['Regular']).forEach(turnoId => {
      const t = turnos.find(x => x.id === turnoId)
      if (t) chTotal += Number(t.horas_computadas)
    })

    // Sum Extras
    Object.entries(serverData['Extra']).forEach(([day, turnoId]) => {
      const t = turnos.find(x => x.id === turnoId)
      if (t) {
        const d = new Date(ano, mes - 1, parseInt(day))
        const isWE = d.getDay() === 0 || d.getDay() === 6
        const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.padStart(2, '0')}`
        const isHoliday = feriados.some(f => f.data === dateStr)

        if (isWE || isHoliday) he100 += Number(t.horas_computadas)
        else he50 += Number(t.horas_computadas)
      }
    })

    // Sum Plantões
    Object.values(serverData['Plantão']).forEach(turnoId => {
      const t = turnos.find(x => x.id === turnoId)
      if (t) {
        if (Number(t.horas_computadas) >= 12) pl12++
        else if (Number(t.horas_computadas) >= 6) pl6++
        else pl4++
      }
    })

    // Sum Sobreavisos
    Object.entries(serverData['Sobreaviso']).forEach(([day, turnoId]) => {
      const em = escalaMensal.find(x => x.servidor_id === servidorId)
      if (!em) return

      const { status: effectiveStatus } = getStatusForDay(parseInt(day), em.id)

      if (desconsiderarFalha && effectiveStatus === 'Falhou') return // Não soma horas se falhou
      
      const t = turnos.find(x => x.id === turnoId)
      if (t) {
        if (t.codigo === 'MTN') so12 += 2
        else if (t.codigo === 'MT' || t.codigo === 'N') so12++
      }
    })

    const totalGeral = chTotal + he100 + he50 + (pl12 * 12) + (pl6 * 8) + (pl4 * 4) + (so12 * 12)

    return { chTotal, he100, he50, pl12, pl6, pl4, so12, totalGeral }
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
      alert('Erro ao acionar sobreaviso: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCloseModal = () => {
    setTriggerModal(null)
    setGeneratedLink(null)
    setMotivo('')
  }

  const handleManualOverride = async (logId: string) => {
    if (!confirm('Deseja validar manualmente este sobreaviso que falhou? Ele voltará a ser contabilizado na carga horária do servidor.')) return
    
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
      alert('Validação manual realizada com sucesso!')
    } catch (err: any) {
      alert('Erro ao validar manualmente: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
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

      // Scale Daily
      const emIds = escalaMensal.map(em => em.id)
      await supabase.from('escala_diaria').delete().in('escala_mensal_id', emIds)
      
      if (allInserts.length > 0) {
        const { error } = await supabase.from('escala_diaria').insert(allInserts)
        if (error) throw error
      }
      
      alert('Escala salva com sucesso!')
    } catch (error: any) {
      alert('Erro ao salvar: ' + error.message)
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
      setGridData(prev => ({
        ...prev,
        [servidorId]: {
          'Regular': {},
          'Extra': {},
          'Plantão': {},
          'Sobreaviso': {}
        }
      }))
    } catch (error: any) {
      alert('Erro ao adicionar servidor: ' + error.message)
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
      
      const newGridData = { ...gridData }
      data.forEach(em => {
        newGridData[em.servidor_id] = {
          'Regular': {},
          'Extra': {},
          'Plantão': {},
          'Sobreaviso': {}
        }
      })
      setGridData(newGridData)
    } catch (error: any) {
      alert('Erro ao adicionar todos os servidores: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCloseScale = async () => {
    const confirmClose = confirm('Deseja FECHAR esta escala?')
    if (!confirmClose) return
    setLoading(true)
    try {
      const ids = escalaMensal.map(em => em.id)
      await supabase.from('escala_mensal').update({ status: 'Fechada' }).in('id', ids)
      setEscalaMensal(prev => prev.map(em => ({ ...em, status: 'Fechada' })))
      alert('Escala fechada!')
    } catch (error: any) {
      alert('Erro: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const endOfMonth = new Date(ano, mes, 0)
  const thresholdDate = new Date(endOfMonth)
  thresholdDate.setDate(thresholdDate.getDate() + (diasInativacao || 5))
  const isAutoInactivated = new Date() > thresholdDate

  const isInactive = escalaMensal[0]?.ativo === false || isAutoInactivated
  const isClosed = escalaMensal[0]?.status === 'Fechada' || isInactive

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
      {isInactive && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-2 text-amber-700 dark:text-amber-500 text-xs font-bold uppercase tracking-tight">
          <Lock className="h-4 w-4" />
          Escala Inativa {isAutoInactivated ? '(Inativação Automática por Prazo)' : '(Inativada Manualmente)'} - Modo de Visualização Ativado
        </div>
      )}
      {/* Toolbar */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
        <div className="flex items-center space-x-4">
          <select 
            onChange={(e) => handleAddServer(e.target.value)}
            value=""
            disabled={loading || isClosed}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">+ Adicionar Servidor...</option>
            {todosServidoresSetor
              .filter(s => !escalaMensal.some(em => em.servidor_id === s.id))
              .map(s => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))
            }
          </select>
          <button 
            onClick={handleAddAll}
            disabled={loading || isClosed || (todosServidoresSetor.length === escalaMensal.length)}
            className="inline-flex items-center rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-600 px-3 py-2 text-sm font-medium border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
            Adicionar Todos
          </button>
          
          <button
            onClick={handleClearScale}
            disabled={loading || isClosed}
            className="inline-flex items-center rounded-md border border-red-200 text-red-600 px-3 py-2 text-sm font-medium hover:bg-red-50 dark:border-red-900/30 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Limpar Escala
          </button>

          <button
            onClick={() => setIsExternalModalOpen(true)}
            disabled={loading || isClosed}
            className="inline-flex items-center rounded-md border border-blue-200 text-blue-700 px-3 py-2 text-sm font-medium hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 transition-colors disabled:opacity-50"
          >
            <Globe className="h-4 w-4 mr-2" />
            Servidor Externo
          </button>
        </div>
        
        <div className="flex items-center space-x-3">
          <button onClick={() => window.print()} className="inline-flex items-center rounded-md bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50">
            <FileText className="mr-2 h-4 w-4" /> Gerar PDF
          </button>
          <button onClick={handleSave} disabled={loading || isClosed} className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 transition-all disabled:opacity-50">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar Previsão
          </button>
          {!isClosed && (
            <button onClick={handleCloseScale} disabled={loading} className="inline-flex items-center rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-sm font-semibold text-white dark:text-zinc-900 shadow-sm hover:bg-black dark:hover:bg-white transition-all">
              <Lock className="mr-2 h-4 w-4" /> Fechar Escala
            </button>
          )}
        </div>
      </div>

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
              <th className="sticky right-[296px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-blue-50 dark:bg-blue-900 text-blue-900 dark:text-blue-100">CH</th>
              <th className="sticky right-[258px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">HE100</th>
              <th className="sticky right-[220px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">HE50</th>
              <th className="sticky right-[182px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">PL12</th>
              <th className="sticky right-[144px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">PL6</th>
              <th className="sticky right-[106px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">PL4</th>
              <th className="sticky right-[68px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-emerald-50 dark:bg-emerald-900 text-emerald-900 dark:text-blue-100">SO12</th>
              <th className="sticky right-0 z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[68px] bg-amber-400 text-black font-black uppercase leading-tight text-[8px] whitespace-nowrap">TOTAL<br/>H/MÊS</th>
            </tr>
          </thead>
          <tbody>
            {escalaMensal.map(em => {
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

                          {!isClosed && (
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
                            className="w-full bg-transparent border-none outline-none text-[10px] font-bold uppercase focus:ring-1 focus:ring-blue-500 rounded p-0"
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
                        const isHoliday = feriados.some(f => f.data === dateStr)
                        
                        let isTriggerAllowed = false
                        if (cat === 'Sobreaviso' && turno) {
                          const now = new Date()
                          let startHour = 7
                          let endHour = 19
                          let endDayOffset = 0
                      
                          if (turno.codigo === 'N') {
                            startHour = 19
                            endHour = 7
                            endDayOffset = 1
                          } else if (turno.codigo === 'MTN') {
                            startHour = 7
                            endHour = 7
                            endDayOffset = 1
                          }
                      
                          const start = new Date(ano, mes - 1, day, startHour, 0, 0)
                          const end = new Date(ano, mes - 1, day + endDayOffset, endHour, 0, 0)
                      
                          isTriggerAllowed = now >= start && now < end
                        }

                        const { status: effectiveStatus, reason: virtualReason, log: logForDay } = cat === 'Sobreaviso' 
                          ? getStatusForDay(day, em.id) 
                          : { status: null, reason: null, log: null }

                        const isFailed = effectiveStatus === 'Falhou'
                        // Hide trigger button if it failed or if currently pending (Accepted/Waiting)
                        // If it's 'Chegou', the professional is active and can be triggered again.
                        if (isFailed || effectiveStatus === 'Aceito' || effectiveStatus === 'Aguardando') {
                          isTriggerAllowed = false
                        }
                        const isDisregarded = isFailed && desconsiderarFalha

                        return (
                          <td 
                            key={day} 
                            className={`p-0 border border-zinc-200 dark:border-zinc-700 text-center relative ${isHoliday ? 'bg-red-50 dark:bg-red-900/10' : isWE ? 'bg-zinc-50 dark:bg-zinc-800/50' : ''} ${isFailed ? 'bg-red-100 dark:bg-red-900/30' : ''}`}
                            title={isFailed ? `FALHOU: ${logForDay?.motivo_falha || virtualReason || 'Tempo expirado'}${isDisregarded ? ' (Desconsiderado da carga horária)' : ''}` : ''}
                          >
                            <input
                              list={cat === 'Sobreaviso' ? "turnos-sobreaviso-list" : "turnos-list"}
                              value={turno?.codigo || ''}
                              disabled={isClosed}
                              onChange={(e) => {
                                const val = e.target.value.toUpperCase()
                                // Se for Sobreaviso, só permite MT, N ou MTN
                                if (cat === 'Sobreaviso' && val !== '' && val !== 'MT' && val !== 'N' && val !== 'MTN') {
                                  return
                                }
                                const t = turnos.find(x => x.codigo === val)
                                handleCellChange(em.servidor_id, cat, day, t?.id || '')
                              }}
                              className={`w-full h-full bg-transparent border-none text-center focus:outline-none focus:ring-1 focus:ring-blue-500 font-black p-0 text-[11px] uppercase ${isFailed ? 'text-red-600 dark:text-red-400 line-through' : 'text-zinc-900 dark:text-zinc-100'}`}
                              placeholder="-"
                            />
                            {isFailed && permitirValidacaoManual && !isClosed && (userRole === 'admin' || userRole === 'super_admin') && (
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
                                title="Acionar Sobreaviso"
                              >
                                <Zap className="h-2 w-2 fill-current" />
                              </button>
                            )}
                          </td>
                        )
                      })}
                      {catIdx === 0 && (
                        <>
                          <td rowSpan={4} className="sticky right-[296px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-blue-50 dark:bg-blue-900 text-blue-900 dark:text-blue-100">{totals.chTotal}</td>
                          <td rowSpan={4} className="sticky right-[258px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">{totals.he100}</td>
                          <td rowSpan={4} className="sticky right-[220px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">{totals.he50}</td>
                          <td rowSpan={4} className="sticky right-[182px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">{totals.pl12}</td>
                          <td rowSpan={4} className="sticky right-[144px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">{totals.pl6}</td>
                          <td rowSpan={4} className="sticky right-[106px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">{totals.pl4}</td>
                          <td rowSpan={4} className="sticky right-[68px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-emerald-50 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100">{totals.so12}</td>
                          <td rowSpan={4} className="sticky right-0 z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-amber-400 text-black text-xs">{totals.totalGeral}</td>
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
              {daysArray.map(day => (
                <td key={day} className="p-1 border border-zinc-300 dark:border-zinc-600 text-center bg-white dark:bg-zinc-900 text-[11px] font-bold text-zinc-900 dark:text-zinc-100">
                  {shiftTotals.M[day] || ''}
                </td>
              ))}
              <td colSpan={8} rowSpan={4} className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600"></td>
            </tr>
            <tr>
              <td className="sticky left-[180px] z-10 bg-white dark:bg-zinc-900 p-1 border border-zinc-300 dark:border-zinc-600 uppercase text-[10px] text-center font-bold text-zinc-800 dark:text-zinc-200">
                TARDE
              </td>
              {daysArray.map(day => (
                <td key={day} className="p-1 border border-zinc-300 dark:border-zinc-600 text-center bg-white dark:bg-zinc-900 text-[11px] font-bold text-zinc-900 dark:text-zinc-100">
                  {shiftTotals.T[day] || ''}
                </td>
              ))}
            </tr>
            <tr>
              <td className="sticky left-[180px] z-10 bg-white dark:bg-zinc-900 p-1 border border-zinc-300 dark:border-zinc-600 uppercase text-[10px] text-center font-bold text-zinc-800 dark:text-zinc-200">
                NOITE
              </td>
              {daysArray.map(day => (
                <td key={day} className="p-1 border border-zinc-300 dark:border-zinc-600 text-center bg-white dark:bg-zinc-900 text-[11px] font-bold text-zinc-900 dark:text-zinc-100">
                  {shiftTotals.N[day] || ''}
                </td>
              ))}
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

        <datalist id="turnos-list">
          {turnos.filter(t => t.ativo !== false).map(t => <option key={t.id} value={t.codigo}>{t.descricao}</option>)}
        </datalist>

        <datalist id="turnos-sobreaviso-list">
          {turnos.filter(t => t.ativo !== false && (t.codigo === 'MT' || t.codigo === 'N' || t.codigo === 'MTN')).map(t => (
            <option key={t.id} value={t.codigo}>{t.descricao}</option>
          ))}
        </datalist>
      </div>

      {/* Actual Print View Hidden component */}
      <ScalePrintView 
        unidade={escalaMensal[0]?.unidades}
        setor={escalaMensal[0]?.setores}
        mes={mes}
        ano={ano}
        escalaMensal={escalaMensal}
        gridData={gridData} 
        turnos={turnos}
        shiftTotals={shiftTotals}
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
                        alert('Mensagem completa copiada para a área de transferência!')
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
    </div>
  )
}
