'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import { ShieldCheck, Zap, Clock, MapPin, UserCheck, AlertCircle, Building2, Filter, FileDown, RotateCcw, ChevronLeft, ChevronRight, Search, LayoutList, CheckCircle2 } from 'lucide-react'
import { applyAccessFilters, type UserProfile } from '@/utils/permissions'

interface LogSobreaviso {
  id: string;
  data_hora_acionamento: string;
  data_hora_aceite?: string;
  data_hora_chegada?: string;
  data_hora_recusa?: string;
  status: string;
  motivo_falha?: string;
  motivo_acionamento?: string;
  lat_aceite?: number;
  long_aceite?: number;
  lat_chegada?: number;
  long_chegada?: number;
  lat_recusa?: number;
  long_recusa?: number;
  validacao_manual?: boolean;
  validado_por?: string;
  data_hora_validacao?: string;
  categoria?: string;
  dia?: number;
  servidores?: { nome: string; matricula?: string; setor_id?: string };
  unidades?: { nome: string; latitude?: number; longitude?: number };
  setores?: { nome: string };
  validador?: { full_name: string };
  localizacao_chegada?: number; // Added to match usage in code
}

interface LogSistema {
  id: string;
  acao: string;
  created_at: string;
  unidade_id?: string;
  setor_id?: string;
  detalhes: Record<string, any>;
  profiles?: { full_name: string };
  unidades?: { nome: string };
  setores?: { nome: string };
}

export default function AuditoriaPage() {
  const [logs, setLogs] = useState<(LogSobreaviso | LogSistema)[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'sobreaviso' | 'presenca' | 'sistema'>('sobreaviso')
  
  // Clear logs when tab changes to avoid showing stale data from the other tab
  useEffect(() => {
    setLogs([])
    setPage(1)
    if (activeTab === 'sistema') {
      setFiltros(prev => ({ ...prev, status: '' }))
    }
  }, [activeTab])

  interface Unidade { id: string; nome: string; }
  interface Setor { id: string; nome: string; unidade_id: string; }

  const [configs, setConfigs] = useState<Record<string, string>>({})
  
  // Filter states
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [setores, setSetores] = useState<Setor[]>([])
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

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const supabase = createClient()

  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false)

  const handleGeneratePDF = async () => {
    setIsGeneratingPDF(true)
    
    // Fetch ALL data matching filters
    let query
    if (activeTab === 'sobreaviso' || activeTab === 'presenca') {
      query = supabase
        .from('logs_sobreaviso')
        .select('*, servidores!inner(nome, matricula), unidades!inner(nome), validador:profiles!validado_por(full_name)')
      
      if (activeTab === 'sobreaviso') {
        query = query.or('categoria.eq.Sobreaviso,categoria.is.null')
      } else {
        query = query.in('categoria', ['Regular', 'Extra', 'Plantão'])
      }

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
        .select('*, profiles!inner(full_name), unidades(nome), setores(nome)')
      
      if (filtros.unidadeId) query = query.eq('unidade_id', filtros.unidadeId)
      if (filtros.setorId) query = query.eq('setor_id', filtros.setorId)
      if (filtros.dataInicio) query = query.gte('created_at', `${filtros.dataInicio}T00:00:00`)
      if (filtros.dataFim) query = query.lte('created_at', `${filtros.dataFim}T23:59:59`)
      if (filtros.busca) {
        query = query.or(`acao.ilike.%${filtros.busca}%,detalhes->>nome.ilike.%${filtros.busca}%`)
      }
    }

    query = applyAccessFilters(query, userProfile)
    const orderBy = activeTab === 'sobreaviso' ? 'data_hora_acionamento' : 'created_at'
    
    const { data } = await query.order(orderBy, { ascending: false })
    
    if (data) {
      const reportTitle = `Relatório de Auditoria - ${activeTab === 'sobreaviso' ? 'Sobreaviso' : 'Sistema'}`
      const generationDate = new Date().toLocaleString('pt-BR')
      
      const unidadeFiltro = filtros.unidadeId ? unidades.find(u => u.id === filtros.unidadeId)?.nome : 'Todas'
      const setorFiltro = filtros.setorId ? setores.find(s => s.id === filtros.setorId)?.nome : 'Todos'
      const periodoFiltro = filtros.dataInicio ? `${new Date(filtros.dataInicio).toLocaleDateString('pt-BR')} até ${filtros.dataFim ? new Date(filtros.dataFim).toLocaleDateString('pt-BR') : 'Hoje'}` : 'Todo o período'
      
      let tableRows = ''
      if (activeTab === 'sobreaviso' || activeTab === 'presenca') {
        tableRows = (data as LogSobreaviso[]).map((log) => {
          const isRegular = log.categoria && log.categoria !== 'Sobreaviso';
          if (isRegular) {
            return `
              <tr class="border-b border-zinc-200 bg-blue-50/20">
                <td class="py-3 px-2 font-bold text-[11px]">${log.servidores?.nome}</td>
                <td class="py-3 px-2 text-[10px]">${log.unidades?.nome}</td>
                <td class="py-3 px-2 text-[10px] font-bold text-blue-700">${log.categoria} (Dia ${log.dia})</td>
                <td class="py-3 px-2 text-[10px]" colspan="2">
                  Validador: ${log.validador?.full_name || 'Sistema'} 
                  <br/><span class="text-zinc-500">${log.motivo_acionamento || ''}</span>
                </td>
                <td class="py-3 px-2 text-[10px] font-bold uppercase">${log.status === 'Cancelado' ? 'REVERTIDO' : 'VALIDADO'}</td>
              </tr>
            `;
          }
          return `
            <tr class="border-b border-zinc-200">
              <td class="py-3 px-2 font-bold text-[11px]">${log.servidores?.nome}</td>
              <td class="py-3 px-2 text-[10px]">${log.unidades?.nome}</td>
              <td class="py-3 px-2 text-[10px]">${new Date(log.data_hora_acionamento).toLocaleString('pt-BR')}</td>
              <td class="py-3 px-2 text-[10px]">${log.data_hora_aceite ? new Date(log.data_hora_aceite).toLocaleString('pt-BR') : '-'}</td>
              <td class="py-3 px-2 text-[10px]">${log.data_hora_chegada ? new Date(log.data_hora_chegada).toLocaleString('pt-BR') : '-'}</td>
              <td class="py-3 px-2 text-[10px] font-bold uppercase">${getEffectiveStatus(log)}</td>
            </tr>
          `;
        }).join('')
      } else {
        tableRows = (data as LogSistema[]).map((log) => `
          <tr class="border-b border-zinc-200">
            <td class="py-3 px-2 font-bold uppercase text-[10px]">${(log.acao || '').replace(/_/g, ' ')}</td>
            <td class="py-3 px-2 text-xs">${log.profiles?.full_name}</td>
            <td class="py-3 px-2 text-xs">${log.unidades?.nome || '-'} / ${log.setores?.nome || 'Geral'}</td>
            <td class="py-3 px-2 text-xs">${new Date(log.created_at).toLocaleString('pt-BR')}</td>
            <td class="py-3 px-2 text-[10px] text-zinc-600 max-w-[300px]">${log.detalhes?.nome || log.detalhes?.servidor || '-'}</td>
          </tr>
        `).join('')
      }

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
            }
            body { font-family: 'Inter', sans-serif; background-color: #f4f4f5; }
            table { page-break-inside: auto; }
            tr { page-break-inside: avoid; page-break-after: auto; }
            thead { display: table-header-group; }
          </style>
        </head>
        <body class="p-8">
          <div class="max-w-6xl mx-auto bg-white shadow-2xl rounded-2xl overflow-hidden border border-zinc-200 container">
            <div class="bg-zinc-900 p-8 text-white flex justify-between items-center no-print">
              <div>
                <h1 class="text-2xl font-black tracking-tight">SIS ESCALA</h1>
                <p class="text-zinc-400 text-sm uppercase font-bold tracking-widest">Relatório Consolidado</p>
              </div>
              <button onclick="window.print()" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                Imprimir Relatório
              </button>
            </div>

            <div class="p-8">
              <div class="flex justify-between items-start border-b-2 border-zinc-900 pb-6 mb-8">
                <div>
                  <h2 class="text-3xl font-black text-zinc-900 uppercase tracking-tighter">${reportTitle}</h2>
                  <p class="text-zinc-500 font-medium">Módulo de Auditoria e Gestão de Escalas</p>
                </div>
                <div class="text-right">
                  <p class="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Data de Emissão</p>
                  <p class="text-lg font-bold text-zinc-900">${generationDate}</p>
                </div>
              </div>

              <div class="grid grid-cols-4 gap-6 mb-8 bg-zinc-50 p-6 rounded-2xl border border-zinc-100">
                <div>
                  <p class="text-[10px] font-black text-zinc-400 uppercase">Unidade</p>
                  <p class="font-bold text-zinc-800">${unidadeFiltro}</p>
                </div>
                <div>
                  <p class="text-[10px] font-black text-zinc-400 uppercase">Setor</p>
                  <p class="font-bold text-zinc-800">${setorFiltro}</p>
                </div>
                <div>
                  <p class="text-[10px] font-black text-zinc-400 uppercase">Período Selecionado</p>
                  <p class="font-bold text-zinc-800 text-xs">${periodoFiltro}</p>
                </div>
                <div>
                  <p class="text-[10px] font-black text-zinc-400 uppercase">Status</p>
                  <p class="font-bold text-zinc-800">${filtros.status || 'Todos'}</p>
                </div>
              </div>

              <table class="w-full text-left">
                <thead>
                  <tr class="bg-zinc-100 border-y-2 border-zinc-900">
                    ${(activeTab === 'sobreaviso' || activeTab === 'presenca') ? `
                      <th class="py-3 px-2 text-[10px] font-black uppercase">Servidor</th>
                      <th class="py-3 px-2 text-[10px] font-black uppercase">Unidade</th>
                      <th class="py-3 px-2 text-[10px] font-black uppercase">${activeTab === 'presenca' ? 'Categoria / Dia' : 'Acionamento'}</th>
                      <th class="py-3 px-2 text-[10px] font-black uppercase">${activeTab === 'presenca' ? 'Validador / Detalhes' : 'Aceite'}</th>
                      <th class="py-3 px-2 text-[10px] font-black uppercase">${activeTab === 'presenca' ? '-' : 'Chegada'}</th>
                      <th class="py-3 px-2 text-[10px] font-black uppercase">Status</th>
                    ` : `
                      <th class="py-3 px-2 text-[10px] font-black uppercase">Ação</th>
                      <th class="py-3 px-2 text-[10px] font-black uppercase">Usuário</th>
                      <th class="py-3 px-2 text-[10px] font-black uppercase">Unidade/Setor</th>
                      <th class="py-3 px-2 text-[10px] font-black uppercase">Data/Hora</th>
                      <th class="py-3 px-2 text-[10px] font-black uppercase">Detalhes</th>
                    `}
                  </tr>
                </thead>
                <tbody>
                  ${tableRows}
                </tbody>
              </table>

              <div class="mt-12 pt-6 border-t border-zinc-200 flex justify-between items-center text-[10px] text-zinc-400 uppercase font-bold tracking-widest">
                <span>SisEscala - Gestão Inteligente de Escalas</span>
                <span>Total de Registros: ${data.length}</span>
              </div>
            </div>
          </div>
          <div class="text-center mt-8 text-zinc-400 text-xs no-print">
            Este relatório foi gerado automaticamente e contém informações sensíveis de auditoria.
          </div>
        </body>
        </html>
      `

      const win = window.open('', '_blank')
      if (win) {
        win.document.write(reportHtml)
        win.document.close()
      }
      setIsGeneratingPDF(false)
    } else {
      setIsGeneratingPDF(false)
    }
  }

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

    if (activeTab === 'sobreaviso' || activeTab === 'presenca') {
      query = supabase
        .from('logs_sobreaviso')
        .select('*, servidores!inner(nome, matricula), unidades!inner(nome, latitude, longitude), validador:profiles!validado_por(full_name)', { count: 'exact' })
      
      if (activeTab === 'sobreaviso') {
        query = query.or('categoria.eq.Sobreaviso,categoria.is.null')
      } else {
        query = query.in('categoria', ['Regular', 'Extra', 'Plantão'])
      }

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

    const { data, count } = await query
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
          const profile: UserProfile = {
            ...prof,
            permitted_unidades: prof.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
            permitted_setores: prof.profile_setores?.map((ps: any) => ps.setor_id) || []
          } as UserProfile
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

  const [selectedLog, setSelectedLog] = useState<LogSobreaviso | LogSistema | null>(null)

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

  const getDetailedStatus = (log: LogSobreaviso | any) => {
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

  const getEffectiveStatus = (log: LogSobreaviso) => {
    return getDetailedStatus(log).status
  }

  const openInGoogleMaps = (lat: number, long: number) => {
    window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${long}`, '_blank')
  }

  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Painel de Auditoria</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Monitoramento e trilha de auditoria administrativa do sistema.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleGeneratePDF}
            disabled={isGeneratingPDF}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-bold hover:bg-zinc-50 transition-colors shadow-sm disabled:opacity-50"
          >
            {isGeneratingPDF ? (
              <Clock className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            {isGeneratingPDF ? 'Gerando...' : 'Gerar PDF'}
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
          Sobreaviso
        </button>
        <button
          onClick={() => { setActiveTab('presenca'); setPage(1); }}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
            activeTab === 'presenca' 
              ? 'bg-white dark:bg-zinc-700 text-blue-600 shadow-sm' 
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          <CheckCircle2 className="h-4 w-4" />
          Presença Regular
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
          Sistema
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
            placeholder={activeTab === 'sobreaviso' ? "Buscar por nome do servidor..." : "Buscar por ação (ex: SALVAR, REMOVER SERVIDOR DA ESCALA)..."}
            value={filtros.busca}
            onChange={(e) => setFiltros(prev => ({ ...prev, busca: e.target.value }))}
            className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl pl-10 pr-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none shadow-inner"
          />
        </div>
      </div>

      {/* Lista com Impressão Otimizada */}
      <div className="grid grid-cols-1 gap-6 print:hidden">
        <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 flex items-center justify-between print:bg-white print:border-zinc-300">
            <h2 className="text-lg font-semibold flex items-center print:text-xl print:font-black">
              {activeTab === 'sobreaviso' ? <Zap className="mr-2 h-5 w-5 text-orange-500 print:hidden" /> : 
               activeTab === 'presenca' ? <CheckCircle2 className="mr-2 h-5 w-5 text-emerald-500 print:hidden" /> : 
               <ShieldCheck className="mr-2 h-5 w-5 text-blue-500 print:hidden" />}
              {activeTab === 'sobreaviso' ? 'Relatório de Acionamentos Sobreaviso' : 
               activeTab === 'presenca' ? 'Validações de Presença Regular' : 
               'Histórico de Ações do Sistema'}
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
            ) : logs.length === 0 ? (
              <div className="p-12 text-center text-zinc-500 dark:text-zinc-400">
                <Clock className="mx-auto h-12 w-12 opacity-20 mb-4" />
                <p>Nenhum registro encontrado com os filtros aplicados.</p>
              </div>
            ) : (activeTab === 'sobreaviso' || activeTab === 'presenca') ? (
              (logs as LogSobreaviso[]).map((log) => {
                const isRegularPresence = log.categoria && log.categoria !== 'Sobreaviso';
                
                if (isRegularPresence || activeTab === 'presenca') {
                  return (
                    <div 
                      key={log.id} 
                      onClick={() => setSelectedLog(log)}
                      className="group hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer border-b border-zinc-100 dark:border-zinc-800 last:border-none print:break-inside-avoid print:border-zinc-300 bg-blue-50/20 dark:bg-blue-900/5"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 items-center gap-4 p-6">
                        <div className="flex items-start space-x-4 lg:col-span-4">
                          <div className="mt-1 rounded-full p-2 bg-blue-100 dark:bg-blue-900/30 print:hidden">
                            <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-zinc-900 dark:text-white print:text-black truncate text-sm">
                              {log.servidores?.nome}
                            </h3>
                            <p className="text-[10px] text-zinc-500 font-medium truncate flex items-center">
                              <Building2 className="mr-1 h-3 w-3 flex-shrink-0" />
                              {log.unidades?.nome}
                            </p>
                          </div>
                        </div>

                        <div className="lg:col-span-8 flex flex-wrap items-center justify-end gap-x-8 gap-y-4">
                          <div className="space-y-1">
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                              Origem da Validação
                            </p>
                            <div className={`flex items-center gap-1.5 font-bold text-[11px] ${log.validacao_manual ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}`}>
                              {log.validacao_manual ? (
                                <>
                                  <UserCheck className="h-3 w-3" />
                                  ADMINISTRATIVA (MANUAL)
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="h-3 w-3" />
                                  SISTEMA (AUTOMÁTICA)
                                </>
                              )}
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                              Categoria / Tipo
                            </p>
                            <p className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                              {log.categoria} - {log.motivo_acionamento?.includes('entrada') ? 'ENTRADA' : 'SAÍDA'} (Dia {log.dia})
                            </p>
                          </div>

                          <div className="space-y-1 min-w-[120px]">
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                              Validador Responsável
                            </p>
                            <p className="text-[11px] text-zinc-700 dark:text-zinc-300 font-medium truncate">
                              {log.validador?.full_name || 'Automação SisEscala'}
                            </p>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="flex flex-col items-end gap-1">
                              <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Status</div>
                              <div className={`rounded-full px-3 py-1 text-[10px] font-black ${getStatusColor(getEffectiveStatus(log))} print:border print:bg-white whitespace-nowrap`}>
                                {log.status === 'Cancelado' ? 'REVERTIDO' : 'VALIDADO'}
                              </div>
                            </div>

                            <button 
                              onClick={(e) => { e.stopPropagation(); setSelectedLog(log); }}
                              className="p-1.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all print:hidden ml-1"
                            >
                              <ChevronRight className="h-5 w-5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div 
                    key={log.id} 
                    onClick={() => setSelectedLog(log)}
                    className="group hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer border-b border-zinc-100 dark:border-zinc-800 last:border-none print:break-inside-avoid print:border-zinc-300"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 items-center gap-4 p-6">
                      <div className="flex items-start space-x-4 lg:col-span-5">
                        <div className="mt-1 rounded-full p-2 bg-zinc-100 dark:bg-zinc-800 print:hidden">
                          <UserCheck className="h-5 w-5 text-zinc-600" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-zinc-900 dark:text-white print:text-black truncate text-sm">
                            {log.servidores?.nome}
                          </h3>
                          <p className="text-[10px] text-zinc-500 font-medium truncate flex items-center">
                            <Building2 className="mr-1 h-3 w-3 flex-shrink-0" />
                            {log.unidades?.nome}
                          </p>
                        </div>
                      </div>

                      <div className="lg:col-span-7 flex flex-wrap items-center justify-end gap-x-8 gap-y-4">
                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                            Acionado
                          </p>
                          <p className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                            {new Date(log.data_hora_acionamento).toLocaleString('pt-BR')}
                          </p>
                        </div>

                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                            Aceite
                          </p>
                          {log.data_hora_aceite ? (
                            <p className="font-mono text-[11px] text-green-600 dark:text-green-400 whitespace-nowrap">
                              {new Date(log.data_hora_aceite).toLocaleString('pt-BR')}
                            </p>
                          ) : (
                            <p className="text-[11px] text-zinc-400 italic">Aguardando...</p>
                          )}
                        </div>

                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                            Chegada
                          </p>
                          {log.data_hora_chegada ? (
                            <p className="font-mono text-[11px] text-blue-600 dark:text-blue-400 whitespace-nowrap">
                              {new Date(log.data_hora_chegada).toLocaleString('pt-BR')}
                            </p>
                          ) : (
                            <p className="text-[11px] text-zinc-400 italic">
                              {log.data_hora_aceite ? 'Em deslocamento' : '---'}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="flex flex-col items-end gap-1">
                            <div className={`rounded-full px-3 py-1 text-[10px] font-black ${getStatusColor(getEffectiveStatus(log))} print:border print:bg-white whitespace-nowrap`}>
                              {getEffectiveStatus(log)}
                            </div>
                            {log.validacao_manual && (
                              <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[9px] font-bold border border-blue-100 dark:border-blue-800 print:text-blue-800 print:bg-white whitespace-nowrap">
                                <ShieldCheck className="h-2.5 w-2.5" />
                                VALIDADO
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1 print:hidden">
                            {log.lat_aceite && (
                              <button
                                onClick={(e) => { e.stopPropagation(); openInGoogleMaps(log.lat_aceite!, log.long_aceite!); }}
                                className="p-1 hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600 rounded transition-colors"
                                title="Ver local de aceite"
                              >
                                <MapPin className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {log.lat_chegada && (
                              <button
                                onClick={(e) => { e.stopPropagation(); openInGoogleMaps(log.lat_chegada!, log.long_chegada!); }}
                                  className="p-1 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600 rounded transition-colors"
                                  title="Ver local de chegada"
                                >
                                  <MapPin className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>

                            <button 
                              onClick={(e) => { e.stopPropagation(); setSelectedLog(log); }}
                              className="p-1.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all print:hidden ml-1"
                            >
                              <ChevronRight className="h-5 w-5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                (logs as LogSistema[]).map((log) => (
                  <div 
                    key={log.id} 
                    onClick={() => setSelectedLog(log)}
                    className="group hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer border-b border-zinc-100 dark:border-zinc-800 last:border-none"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 items-center gap-4 p-6">
                      <div className="flex items-start space-x-4">
                        <div className={`mt-1 rounded-full p-2 ${(log.acao || '').includes('REMOVER') ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                          <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-zinc-900 dark:text-white uppercase text-sm truncate">
                            {(log.acao || '').replace(/_/g, ' ')}
                          </h3>
                          <p className="text-[10px] text-zinc-500 font-medium truncate">
                            {log.detalhes?.nome || log.detalhes?.servidor || 'Log de Sistema'}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1">
                          <UserCheck className="h-3 w-3" /> Executor
                        </p>
                        <p className="font-bold text-zinc-700 dark:text-zinc-300 text-xs truncate">
                          {log.profiles?.full_name}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1">
                          <Building2 className="h-3 w-3" /> Unidade / Setor
                        </p>
                        <p className="text-xs text-zinc-600 dark:text-zinc-400 truncate">
                          {log.unidades?.nome || 'Geral'} / {log.setores?.nome || 'Dashboard'}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Registro
                          </p>
                          <p className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                            {new Date(log.created_at).toLocaleString('pt-BR')}
                          </p>
                        </div>
                        <div className="p-2 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all">
                          <ChevronRight className="h-5 w-5" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))
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
              (() => {
                const log = selectedLog as LogSistema;
                return (
                  <div className="p-6 space-y-6">
                    <div className="flex items-center space-x-4">
                      <div className={`h-12 w-12 rounded-full flex items-center justify-center ${(log.acao || '').includes('REMOVER') ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                        <ShieldCheck className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">Ação Realizada</p>
                        <p className="text-lg font-bold uppercase">{(log.acao || '').replace(/_/g, ' ')}</p>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">Por: {log.profiles?.full_name}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      <div className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-zinc-100 dark:border-zinc-800">
                        <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-2">Contexto da Escala</p>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Unidade/Setor:</span>
                            <span className="font-medium text-right">
                              {log.unidades?.nome ? `${log.unidades.nome} / ${log.setores?.nome || 'Geral'}` : 'Sistema / Global'}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Período:</span>
                            <span className="font-medium">
                              {log.detalhes?.mes ? `${log.detalhes.mes}/${log.detalhes.ano}` : 'N/A (Ação Global)'}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Data do Log:</span>
                            <span className="font-medium">{new Date(log.created_at).toLocaleString('pt-BR')}</span>
                          </div>
                          {log.detalhes?.ip && (
                            <div className="flex justify-between text-sm pt-2 border-t border-zinc-100 dark:border-zinc-800">
                              <span className="text-zinc-500">Endereço IP:</span>
                              <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{log.detalhes.ip}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-700 text-zinc-100">
                        <p className="text-xs font-bold text-zinc-400 uppercase mb-2">Dados do Registro (JSON)</p>
                        <pre className="text-[10px] font-mono whitespace-pre-wrap overflow-auto max-h-[150px]">
                          {JSON.stringify(log.detalhes, null, 2)}
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
                );
              })()
            ) : (
              (() => {
                const log = selectedLog as LogSobreaviso;
                const { status: effectiveStatus, reason: failureReason } = getDetailedStatus(log)
                return (
                  <div className="p-6 space-y-6">
                    <div className="flex items-center space-x-4">
                      <div className="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600">
                        <UserCheck className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">Servidor</p>
                        <p className="text-lg font-bold">{log.servidores?.nome}</p>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">{log.unidades?.nome}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      <div className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-zinc-100 dark:border-zinc-800">
                        <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-2">Linha do Tempo</p>
                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-zinc-600 dark:text-zinc-400">Acionamento:</span>
                            <span className="text-sm font-medium">{new Date(log.data_hora_acionamento).toLocaleString('pt-BR')}</span>
                          </div>
                          {log.data_hora_aceite && (
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                                  {log.status === 'Recusado' ? 'Recusa:' : 'Aceite:'}
                                </span>
                                {(log.lat_aceite || log.lat_recusa) && (
                                  <button 
                                    onClick={() => openInGoogleMaps(
                                      log.status === 'Recusado' ? log.lat_recusa! : log.lat_aceite!, 
                                      log.status === 'Recusado' ? log.long_recusa! : log.long_aceite!
                                    )}
                                    className="ml-2 text-[10px] text-blue-600 hover:underline flex items-center"
                                  >
                                    <MapPin className="h-3 w-3 mr-0.5" /> Ver no Mapa
                                  </button>
                                )}
                              </div>
                              <span className={`text-sm font-medium ${log.status === 'Recusado' ? 'text-red-600' : 'text-green-600'}`}>
                                {new Date(log.data_hora_aceite).toLocaleString('pt-BR')}
                              </span>
                            </div>
                          )}
                          {log.data_hora_chegada && (
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="text-sm text-zinc-600 dark:text-zinc-400">Chegada:</span>
                                <button 
                                  onClick={() => openInGoogleMaps(log.lat_chegada!, log.long_chegada!)}
                                  className="ml-2 text-[10px] text-blue-600 hover:underline flex items-center"
                                >
                                  <MapPin className="h-3 w-3 mr-0.5" /> Ver no Mapa
                                </button>
                              </div>
                              <span className="text-sm font-medium text-blue-600">{new Date(log.data_hora_chegada).toLocaleString('pt-BR')}</span>
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

                      {log.motivo_acionamento && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-100 dark:border-blue-800">
                          <p className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase mb-1">Motivo do Chamado</p>
                          <p className="text-sm text-blue-900 dark:text-blue-200 italic">"{log.motivo_acionamento}"</p>
                        </div>
                      )}

                      {log.validacao_manual && (
                        <div className="bg-zinc-900 dark:bg-zinc-800 p-4 rounded-xl border border-zinc-700 dark:border-zinc-600 text-white shadow-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <ShieldCheck className="h-5 w-5 text-green-400" />
                            <p className="text-xs font-bold uppercase tracking-wider text-green-400">Validação Administrativa</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm font-medium">Aprovado por: <span className="text-zinc-300">{log.validador?.full_name || log.validado_por || 'Sistema (Admin)'}</span></p>
                            <p className="text-[11px] text-zinc-400">Data/Hora: {log.data_hora_validacao ? new Date(log.data_hora_validacao).toLocaleString('pt-BR') : 'Agora (Processando...)'}</p>
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
