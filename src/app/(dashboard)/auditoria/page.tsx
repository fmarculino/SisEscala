'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import { ShieldCheck, Zap, Clock, MapPin, UserCheck, AlertCircle, Building2, Filter, FileDown, RotateCcw, ChevronLeft, ChevronRight, Search, LayoutList } from 'lucide-react'
import { applyAccessFilters } from '@/utils/permissions'

export default function AuditoriaPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'sobreaviso' | 'sistema'>('sobreaviso')
  
  // Clear logs when tab changes to avoid showing stale data from the other tab
  useEffect(() => {
    setLogs([])
    setPage(1)
    if (activeTab === 'sistema') {
      setFiltros(prev => ({ ...prev, status: '' }))
    }
  }, [activeTab])

  const [configs, setConfigs] = useState<Record<string, string>>({})
  
  // Filter states
  const [unidades, setUnidades] = useState<any[]>([])
  const [setores, setSetores] = useState<any[]>([])
  const [filtros, setFiltros] = useState({
    unidadeId: '',
    setorId: '',
    status: '',
    dataInicio: '',
    dataFim: '',
    busca: ''
  })

  // Pagination states
  const [page, setPage] = useState(1)
  const [pageSize] = useState(10)
  const [totalCount, setTotalCount] = useState(0)

  const [userProfile, setUserProfile] = useState<any>(null)
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!userProfile && logs.length === 0) return // Wait for profile
    setLoading(true)
    
    // Fetch configs
    const { data: configData } = await supabase.from('configuracoes_globais').select('*')
    if (configData) {
      const obj: Record<string, string> = {}
      configData.forEach(c => { obj[c.chave] = String(c.valor) })
      setConfigs(obj)
    }

    // Base query
    let query

    if (activeTab === 'sobreaviso') {
      query = supabase
        .from('logs_sobreaviso')
        .select('*, servidores!inner(nome), unidades!inner(nome, latitude, longitude), validador:profiles!validado_por(full_name)', { count: 'exact' })
      
      if (filtros.unidadeId) query = query.eq('unidade_id', filtros.unidadeId)
      if (filtros.setorId) query = query.eq('servidores.setor_id', filtros.setorId)
      if (filtros.status) {
        if (filtros.status === 'Falhou') query = query.eq('status', 'Falhou')
        else if (filtros.status === 'Atendido') query = query.eq('status', 'Chegou')
        else query = query.eq('status', filtros.status)
      }
      if (filtros.dataInicio) query = query.gte('data_hora_acionamento', `${filtros.dataInicio}T00:00:00`)
      if (filtros.dataFim) query = query.lte('data_hora_acionamento', `${filtros.dataFim}T23:59:59`)
      if (filtros.busca) query = query.ilike('servidores.nome', `%${filtros.busca}%`)
    } else {
      query = supabase
        .from('logs_sistema')
        .select('*, profiles!inner(full_name), unidades(nome), setores(nome)', { count: 'exact' })
      
      if (filtros.unidadeId) query = query.eq('unidade_id', filtros.unidadeId)
      if (filtros.setorId) query = query.eq('setor_id', filtros.setorId)
      if (filtros.dataInicio) query = query.gte('created_at', `${filtros.dataInicio}T00:00:00`)
      if (filtros.dataFim) query = query.lte('created_at', `${filtros.dataFim}T23:59:59`)
      if (filtros.busca) {
        query = query.or(`acao.ilike.%${filtros.busca}%,detalhes->>nome.ilike.%${filtros.busca}%`)
      }
    }

    // Aplicar filtros de permissão
    query = applyAccessFilters(query, userProfile)

    // Pagination
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const orderBy = activeTab === 'sobreaviso' ? 'data_hora_acionamento' : 'created_at'

    const { data, count, error } = await query
      .order(orderBy, { ascending: false })
      .range(from, to)
    
    if (data) setLogs(data)
    if (count !== null) setTotalCount(count)
    setLoading(false)
  }, [page, pageSize, filtros, supabase, userProfile, activeTab])

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
          const profile = {
            ...prof,
            permitted_unidades: prof.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
            permitted_setores: prof.profile_setores?.map((ps: any) => ps.setor_id) || []
          }
          setUserProfile(profile)
          
          // Fetch initial filter data with scoped filters
          let uQuery = supabase.from('unidades').select('*').eq('ativo', true).order('nome')
          uQuery = applyAccessFilters(uQuery, profile)
          const { data: u } = await uQuery

          let sQuery = supabase.from('setores').select('*').eq('ativo', true).order('nome')
          sQuery = applyAccessFilters(sQuery, profile)
          const { data: s } = await sQuery

          if (u) setUnidades(u)
          if (s) setSetores(s)
        }
      }
    }
    
    init()
  }, [])

  useEffect(() => {
    if (userProfile) {
      fetchData()
    }

    // Realtime subscription
    const table = activeTab === 'sobreaviso' ? 'logs_sobreaviso' : 'logs_sistema'
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          fetchData()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchData, supabase, userProfile, activeTab])

  const [selectedLog, setSelectedLog] = useState<any>(null)

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Aceito': return 'text-green-600 bg-green-50 dark:bg-green-900/20'
      case 'Recusado': return 'text-red-600 bg-red-50 dark:bg-red-900/20'
      case 'Expirado': return 'text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800'
      case 'Falhou': return 'text-red-700 bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-800'
      case 'Chegou': return 'text-blue-600 bg-blue-50 dark:bg-blue-900/20'
      default: return 'text-orange-600 bg-orange-50 dark:bg-orange-900/20'
    }
  }

  const getDetailedStatus = (log: any) => {
    if (!log) return { status: null, reason: null }
    
    let status = log.status
    let reason = log.motivo_falha
    
    if (log.status === 'Aceito' && configs['sobreaviso_tempo_chegada_minutos']) {
      const limit = parseInt(configs['sobreaviso_tempo_chegada_minutos'])
      const safeDateStr = log.data_hora_aceite ? log.data_hora_aceite.replace(' ', 'T') : new Date().toISOString()
      const acceptedAt = new Date(safeDateStr).getTime()
      const now = new Date().getTime()
      if ((acceptedAt + limit * 60000) < now && !log.data_hora_chegada) {
        status = 'Falhou'
        reason = 'Tempo limite de deslocamento excedido'
      }
    }

    if (log.status === 'Aguardando' && configs['sobreaviso_tempo_aceite_minutos']) {
      const limit = parseInt(configs['sobreaviso_tempo_aceite_minutos'])
      const safeDateStr = log.created_at ? log.created_at.replace(' ', 'T') : new Date().toISOString()
      const created = new Date(safeDateStr).getTime()
      const now = new Date().getTime()
      if ((created + limit * 60000) < now) {
        status = 'Falhou'
        reason = 'Tempo limite para aceite excedido'
      }
    }
    
    return { status, reason }
  }

  const getEffectiveStatus = (log: any) => {
    return getDetailedStatus(log).status
  }

  const getActionColor = (acao: string) => {
    if (acao.includes('REMOVER') || acao.includes('LIMPAR')) return 'text-red-600 bg-red-50'
    if (acao.includes('ADICIONAR')) return 'text-green-600 bg-green-50'
    if (acao.includes('FECHAR')) return 'text-blue-600 bg-blue-50'
    if (acao === 'LOGIN') return 'text-emerald-600 bg-emerald-50'
    if (acao === 'LOGOUT') return 'text-orange-600 bg-orange-50'
    return 'text-zinc-600 bg-zinc-50'
  }

  const openInGoogleMaps = (lat: number, long: number) => {
    window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${long}`, '_blank')
  }

  const handlePrint = () => {
    window.print()
  }

  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <div className="space-y-8 print:space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Painel de Auditoria</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Monitoramento e trilha de auditoria administrativa do sistema.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-bold hover:bg-zinc-50 transition-colors shadow-sm"
          >
            <FileDown className="h-4 w-4" />
            Gerar PDF
          </button>
          <div className="flex items-center space-x-2 text-sm text-green-600 font-medium bg-green-50 dark:bg-green-900/10 px-3 py-1.5 rounded-full border border-green-100 dark:border-green-900/30">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span>Monitoramento Ativo</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 w-fit rounded-xl border border-zinc-200 dark:border-zinc-700 print:hidden">
        <button
          onClick={() => { setActiveTab('sobreaviso'); setPage(1); }}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
            activeTab === 'sobreaviso' 
              ? 'bg-white dark:bg-zinc-700 text-blue-600 shadow-sm' 
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          <Zap className="h-4 w-4" />
          Acionamentos Sobreaviso
        </button>
        <button
          onClick={() => { setActiveTab('sistema'); setPage(1); }}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
            activeTab === 'sistema' 
              ? 'bg-white dark:bg-zinc-700 text-blue-600 shadow-sm' 
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          <ShieldCheck className="h-4 w-4" />
          Ações do Sistema
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-4 print:hidden">
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-white mb-2">
          <Filter className="h-4 w-4" />
          FILTROS DE BUSCA
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-zinc-500">Unidade</label>
            <select 
              value={filtros.unidadeId}
              onChange={(e) => setFiltros(prev => ({ ...prev, unidadeId: e.target.value, setorId: '' }))}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">Todas as Unidades</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-zinc-500">Setor</label>
            <select 
              value={filtros.setorId}
              onChange={(e) => setFiltros(prev => ({ ...prev, setorId: e.target.value }))}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">Todos os Setores</option>
              {setores
                .filter(s => !filtros.unidadeId || s.unidade_id === filtros.unidadeId)
                .map(s => <option key={s.id} value={s.id}>{s.nome}</option>)
              }
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-zinc-500">Status</label>
            <select 
              value={filtros.status}
              onChange={(e) => setFiltros(prev => ({ ...prev, status: e.target.value }))}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              disabled={activeTab === 'sistema'}
            >
              <option value="">Todos os Status</option>
              <option value="Atendido">Atendido</option>
              <option value="Falhou">Falhou</option>
              <option value="Aceito">Aceito (A caminho)</option>
              <option value="Aguardando">Aguardando Aceite</option>
              <option value="Recusado">Recusado</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-zinc-500">Início</label>
            <input 
              type="date"
              value={filtros.dataInicio}
              onChange={(e) => setFiltros(prev => ({ ...prev, dataInicio: e.target.value }))}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-zinc-500">Fim</label>
            <input 
              type="date"
              value={filtros.dataFim}
              onChange={(e) => setFiltros(prev => ({ ...prev, dataFim: e.target.value }))}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="flex items-end gap-2">
            <button 
              onClick={() => {
                setFiltros({ unidadeId: '', setorId: '', status: '', dataInicio: '', dataFim: '', busca: '' })
                setPage(1)
              }}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg text-sm font-bold transition-colors"
              title="Limpar Filtros"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input 
            type="text"
            placeholder={activeTab === 'sobreaviso' ? "Buscar por nome do servidor..." : "Buscar por ação (ex: SALVAR, REMOVER)..."}
            value={filtros.busca}
            onChange={(e) => setFiltros(prev => ({ ...prev, busca: e.target.value }))}
            className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl pl-10 pr-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none shadow-inner"
          />
        </div>
      </div>

      {/* Lista com Impressão Otimizada */}
      <div className="grid grid-cols-1 gap-6">
        <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 print:border-none print:shadow-none">
          <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 flex items-center justify-between print:bg-white print:border-zinc-300">
            <h2 className="text-lg font-semibold flex items-center print:text-xl print:font-black">
              <Zap className="mr-2 h-5 w-5 text-orange-500 print:hidden" />
              Relatório de Acionamentos
            </h2>
            <div className="text-xs text-zinc-500 font-medium">
              Mostrando {logs.length} de {totalCount} registros
            </div>
          </div>
          
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {loading ? (
              <div className="p-20 text-center space-y-4">
                <Clock className="mx-auto h-12 w-12 text-zinc-300 animate-spin" />
                <p className="text-zinc-500 font-medium">Carregando registros...</p>
              </div>
            ) : logs.length > 0 ? (
              activeTab === 'sobreaviso' ? (
                logs.map((log) => (
                  <div 
                    key={log.id} 
                    onClick={() => setSelectedLog(log)}
                    className="p-6 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer border-b border-zinc-100 dark:border-zinc-800 last:border-none print:break-inside-avoid print:border-zinc-300"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="flex items-start space-x-4">
                        <div className="mt-1 rounded-full p-2 bg-zinc-100 dark:bg-zinc-800 print:hidden">
                          <UserCheck className="h-5 w-5 text-zinc-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-zinc-900 dark:text-white print:text-black">
                            {log.servidores?.nome}
                          </h3>
                          <p className="text-sm text-zinc-600 dark:text-zinc-400 flex items-center print:text-zinc-700">
                            <Building2 className="mr-1 h-3 w-3" />
                            {log.unidades?.nome}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-6">
                        <div className="text-xs">
                          <p className="text-zinc-600 dark:text-zinc-400 uppercase tracking-wider font-bold print:text-zinc-600">Acionado</p>
                          <p className="font-medium">{new Date(log.data_hora_acionamento).toLocaleString('pt-BR')}</p>
                        </div>

                        {log.data_hora_aceite && (
                          <div className="text-xs">
                            <p className="text-zinc-600 dark:text-zinc-400 uppercase tracking-wider font-bold print:text-zinc-600">Aceito</p>
                            <p className="font-medium text-green-600">{new Date(log.data_hora_aceite).toLocaleString('pt-BR')}</p>
                          </div>
                        )}

                        <div className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusColor(getEffectiveStatus(log))} print:border print:bg-white`}>
                          {getEffectiveStatus(log)}
                        </div>

                        {log.validacao_manual && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[10px] font-bold border border-blue-100 dark:border-blue-800 print:text-blue-800 print:bg-white">
                            <UserCheck className="h-3 w-3" />
                            VALIDADO MANUAL
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                logs.map((log) => (
                  <div 
                    key={log.id} 
                    onClick={() => setSelectedLog(log)}
                    className="p-6 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer border-b border-zinc-100 dark:border-zinc-800 last:border-none"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="flex items-start space-x-4">
                        <div className={`mt-1 rounded-full p-2 ${log.acao.includes('REMOVER') ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                          <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="font-bold text-zinc-900 dark:text-white uppercase text-sm">
                            {log.acao.replace(/_/g, ' ')}
                          </h3>
                          <div className="flex items-center gap-3 mt-1">
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center">
                              <UserCheck className="mr-1 h-3 w-3" />
                              {log.profiles?.full_name}
                            </p>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center">
                              <Building2 className="mr-1 h-3 w-3" />
                              {log.unidades?.nome} / {log.setores?.nome}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-[10px] text-zinc-500 uppercase font-black">Data/Hora</p>
                          <p className="text-sm font-medium">{new Date(log.created_at).toLocaleString('pt-BR')}</p>
                        </div>
                        <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${getActionColor(log.acao)}`}>
                          ADMIN
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )
            ) : (
              <div className="p-12 text-center text-zinc-500 dark:text-zinc-400">
                <Clock className="mx-auto h-12 w-12 opacity-20 mb-4" />
                <p>Nenhum registro encontrado com os filtros aplicados.</p>
              </div>
            )}
          </div>
        </div>

        {/* Paginação */}
        <div className="flex items-center justify-between px-2 print:hidden">
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            Página <span className="font-bold text-zinc-900 dark:text-white">{page}</span> de <span className="font-bold text-zinc-900 dark:text-white">{totalPages || 1}</span>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button 
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Detalhes */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 flex justify-between items-center">
              <h3 className="text-xl font-bold">
                {activeTab === 'sobreaviso' ? 'Detalhes do Acionamento' : 'Detalhes da Ação'}
              </h3>
              <button onClick={() => setSelectedLog(null)} className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-white">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            {activeTab === 'sistema' ? (
              <div className="p-6 space-y-6">
                <div className="flex items-center space-x-4">
                  <div className={`h-12 w-12 rounded-full flex items-center justify-center ${selectedLog.acao.includes('REMOVER') ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">Ação Realizada</p>
                    <p className="text-lg font-bold uppercase">{selectedLog.acao.replace(/_/g, ' ')}</p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">Por: {selectedLog.profiles?.full_name}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-zinc-100 dark:border-zinc-800">
                    <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-2">Contexto da Escala</p>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-500">Unidade/Setor:</span>
                        <span className="font-medium text-right">
                          {selectedLog.unidades?.nome ? `${selectedLog.unidades.nome} / ${selectedLog.setores?.nome || 'Geral'}` : 'Sistema / Global'}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-500">Período:</span>
                        <span className="font-medium">
                          {selectedLog.detalhes?.mes ? `${selectedLog.detalhes.mes}/${selectedLog.detalhes.ano}` : 'N/A (Ação Global)'}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-500">Data do Log:</span>
                        <span className="font-medium">{new Date(selectedLog.created_at).toLocaleString('pt-BR')}</span>
                      </div>
                      {selectedLog.detalhes?.ip && (
                        <div className="flex justify-between text-sm pt-2 border-t border-zinc-100 dark:border-zinc-800">
                          <span className="text-zinc-500">Endereço IP:</span>
                          <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{selectedLog.detalhes.ip}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-700 text-zinc-100">
                    <p className="text-xs font-bold text-zinc-400 uppercase mb-2">Dados do Registro (JSON)</p>
                    <pre className="text-[10px] font-mono whitespace-pre-wrap overflow-auto max-h-[150px]">
                      {JSON.stringify(selectedLog.detalhes, null, 2)}
                    </pre>
                  </div>
                </div>

                <button 
                  onClick={() => setSelectedLog(null)}
                  className="w-full py-3 bg-zinc-900 dark:bg-white dark:text-zinc-900 text-white font-bold rounded-xl hover:opacity-90 transition-opacity"
                >
                  Fechar
                </button>
              </div>
            ) : (
              (() => {
                const { status: effectiveStatus, reason: failureReason } = getDetailedStatus(selectedLog)
                return (
                  <div className="p-6 space-y-6">
                    <div className="flex items-center space-x-4">
                      <div className="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600">
                        <UserCheck className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">Servidor</p>
                        <p className="text-lg font-bold">{selectedLog.servidores?.nome}</p>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">{selectedLog.unidades?.nome}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      <div className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-zinc-100 dark:border-zinc-800">
                        <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-2">Linha do Tempo</p>
                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-zinc-600 dark:text-zinc-400">Acionamento:</span>
                            <span className="text-sm font-medium">{new Date(selectedLog.data_hora_acionamento).toLocaleString('pt-BR')}</span>
                          </div>
                          {selectedLog.data_hora_aceite && (
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                                  {selectedLog.status === 'Recusado' ? 'Recusa:' : 'Aceite:'}
                                </span>
                                {(selectedLog.lat_aceite || selectedLog.lat_recusa) && (
                                  <button 
                                    onClick={() => openInGoogleMaps(
                                      selectedLog.status === 'Recusado' ? selectedLog.lat_recusa : selectedLog.lat_aceite, 
                                      selectedLog.status === 'Recusado' ? selectedLog.long_recusa : selectedLog.long_aceite
                                    )}
                                    className="ml-2 text-[10px] text-blue-600 hover:underline flex items-center"
                                  >
                                    <MapPin className="h-3 w-3 mr-0.5" /> Ver no Mapa
                                  </button>
                                )}
                              </div>
                              <span className={`text-sm font-medium ${selectedLog.status === 'Recusado' ? 'text-red-600' : 'text-green-600'}`}>
                                {new Date(selectedLog.data_hora_aceite).toLocaleString('pt-BR')}
                              </span>
                            </div>
                          )}
                          {selectedLog.data_hora_chegada && (
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="text-sm text-zinc-600 dark:text-zinc-400">Chegada:</span>
                                <button 
                                  onClick={() => openInGoogleMaps(selectedLog.lat_chegada, selectedLog.long_chegada)}
                                  className="ml-2 text-[10px] text-blue-600 hover:underline flex items-center"
                                >
                                  <MapPin className="h-3 w-3 mr-0.5" /> Ver no Mapa
                                </button>
                              </div>
                              <span className="text-sm font-medium text-blue-600">{new Date(selectedLog.data_hora_chegada).toLocaleString('pt-BR')}</span>
                            </div>
                          )}
                          {effectiveStatus === 'Falhou' && (
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-red-600 dark:text-red-400 font-bold">Falha Detectada:</span>
                              <span className="text-sm font-bold text-red-600 dark:text-red-400">STATUS: FALHOU</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {effectiveStatus === 'Falhou' && (
                        <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-xl border border-red-100 dark:border-red-800 animate-pulse">
                          <div className="flex items-center gap-2 mb-1 text-red-700 dark:text-red-400">
                            <AlertCircle className="h-4 w-4" />
                            <p className="text-xs font-bold uppercase">Chamado com Falha</p>
                          </div>
                          <p className="text-sm text-red-900 dark:text-red-200 font-medium">
                            {failureReason || 'Tempo limite excedido ou regra de negócio violada'}
                          </p>
                        </div>
                      )}

                      {selectedLog.motivo_acionamento && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-100 dark:border-blue-800">
                          <p className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase mb-1">Motivo do Chamado</p>
                          <p className="text-sm text-blue-900 dark:text-blue-200 italic">"{selectedLog.motivo_acionamento}"</p>
                        </div>
                      )}

                      {selectedLog.validacao_manual && (
                        <div className="bg-zinc-900 dark:bg-zinc-800 p-4 rounded-xl border border-zinc-700 dark:border-zinc-600 text-white shadow-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <ShieldCheck className="h-5 w-5 text-green-400" />
                            <p className="text-xs font-bold uppercase tracking-wider text-green-400">Validação Administrativa</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm font-medium">Aprovado por: <span className="text-zinc-300">{selectedLog.validador?.full_name || selectedLog.validado_por || 'Sistema (Admin)'}</span></p>
                            <p className="text-[11px] text-zinc-400">Data/Hora: {selectedLog.data_hora_validacao ? new Date(selectedLog.data_hora_validacao).toLocaleString('pt-BR') : 'Agora (Processando...)'}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    <button 
                      onClick={() => setSelectedLog(null)}
                      className="w-full py-3 bg-zinc-900 dark:bg-white dark:text-zinc-900 text-white font-bold rounded-xl hover:opacity-90 transition-opacity"
                    >
                      Fechar
                    </button>
                  </div>
                )
              })()
            )}
          </div>
        </div>
      )}
    </div>
  )
}
