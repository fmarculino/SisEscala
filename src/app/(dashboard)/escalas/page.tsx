'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { autoCloseExpiredScalesAndTimesheets } from '@/utils/autoClose'
import { Calendar, Plus, ChevronRight, Layers, Filter, Eye, EyeOff, Search, Loader2, Building2, Check, ShieldCheck, FileText, UserSearch, UserCheck, X, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { Modal } from '@/components/ui/Modal'
import { applyAccessFilters, hasSectorAccess, hasUnitAccess } from '@/utils/permissions'
import { useCallback } from 'react'

function formatCpf(cpf: string | null) {
  if (!cpf) return ''
  const clean = cpf.replace(/\D/g, '')
  if (clean.length === 11) {
    return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  }
  return cpf
}

export default function EscalasPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [escalas, setEscalas] = useState<any[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchServidor, setSearchServidor] = useState('')
  const [serverSearchResult, setServerSearchResult] = useState<{
    isSearching: boolean
    matchedServidores: any[]
    globalEscalas: any[]
    hasSearched: boolean
  }>({
    isSearching: false,
    matchedServidores: [],
    globalEscalas: [],
    hasSearched: false
  })
  const [filterUnidade, setFilterUnidade] = useState('todas')
  const [filterMes, setFilterMes] = useState(String(new Date().getMonth() + 1))
  const [filterAno, setFilterAno] = useState(String(new Date().getFullYear()))
  const [filterStatus, setFilterStatus] = useState('todos')
  const [currentPage, setCurrentPage] = useState(1)
  const [profile, setProfile] = useState<any>(null)
  const [linkedServidorId, setLinkedServidorId] = useState<string | null>(null)
  
  // Modal states
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean, title: string, message: string, type: 'default' | 'danger' | 'success' }>({
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

  const logAction = useCallback(async (acao: string, unidadeId: string, setorId: string, mes: number, ano: number, detalhes: any = {}) => {
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
  }, [supabase])

  // Load user profile & initial filters
  useEffect(() => {
    async function init() {
      try {
        await autoCloseExpiredScalesAndTimesheets()
      } catch (err) {
        console.error('Erro no fechamento automático:', err)
      }
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

          if (prof?.role === 'comum' || prof?.role === 'servidor') {
            const { data: serv } = await supabase
              .from('servidores')
              .select('id')
              .eq('email', user.email)
              .single()
            if (serv) setLinkedServidorId(serv.id)
          }

          // Fetch with the profile we just loaded to avoid race conditions
          fetchEscalas(userProfile, String(new Date().getMonth() + 1), String(new Date().getFullYear()))
          return
        }
      }
      fetchEscalas(undefined, String(new Date().getMonth() + 1), String(new Date().getFullYear()))
    }
    init()
  }, [])

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, searchServidor, filterUnidade, filterMes, filterAno, filterStatus, showInactive])

  // Global search effect when user types in searchServidor (incremental)
  useEffect(() => {
    const term = searchServidor.trim()
    if (term.length < 2) {
      setServerSearchResult({
        isSearching: false,
        matchedServidores: [],
        globalEscalas: [],
        hasSearched: false
      })
      return
    }

    setServerSearchResult(prev => ({ ...prev, isSearching: true }))

    const timer = setTimeout(async () => {
      try {
        const cleanCpf = term.replace(/\D/g, '')
        let servQuery = supabase
          .from('servidores')
          .select('id, nome, cpf, matricula, cargo')

        if (cleanCpf && cleanCpf.length >= 3) {
          servQuery = servQuery.or(`nome.ilike.%${term}%,matricula.ilike.%${term}%,cpf.ilike.%${cleanCpf}%`)
        } else {
          servQuery = servQuery.or(`nome.ilike.%${term}%,matricula.ilike.%${term}%`)
        }

        const { data: matchedServs } = await servQuery.limit(10)

        if (!matchedServs || matchedServs.length === 0) {
          setServerSearchResult({
            isSearching: false,
            matchedServidores: [],
            globalEscalas: [],
            hasSearched: true
          })
          return
        }

        const servIds = matchedServs.map(s => s.id)
        const { data: globEsc } = await supabase
          .from('escala_mensal')
          .select('id, mes, ano, status, ativo, unidade_id, setor_id, unidades(nome), setores(dicionario_setores(nome)), servidores(id, nome, cpf, matricula)')
          .in('servidor_id', servIds)

        const mappedGlobEsc = (globEsc || []).map((e: any) => {
          const sectorData = Array.isArray(e.setores) ? e.setores[0] : e.setores
          const dictData = sectorData ? (Array.isArray(sectorData.dicionario_setores) 
            ? sectorData.dicionario_setores[0] 
            : sectorData.dicionario_setores) : null
            
          return {
            ...e,
            setores: sectorData ? {
              nome: dictData?.nome || 'SETOR SEM NOME'
            } : null
          }
        })

        setServerSearchResult({
          isSearching: false,
          matchedServidores: matchedServs,
          globalEscalas: mappedGlobEsc,
          hasSearched: true
        })
      } catch (err) {
        console.error('Erro ao buscar servidor globalmente:', err)
        setServerSearchResult({
          isSearching: false,
          matchedServidores: [],
          globalEscalas: [],
          hasSearched: true
        })
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchServidor, supabase])

  // Trigger fetchEscalas when period filters change
  useEffect(() => {
    if (profile) {
      fetchEscalas()
    }
  }, [filterMes, filterAno])

  async function fetchEscalas(activeProfile?: any, mesVal?: string, anoVal?: string) {
    setLoading(true)
    let query = supabase
      .from('escala_mensal')
      .select('*, servidores(id, nome, cpf, matricula), unidades(nome), setores(dicionario_setores(nome))')
      .order('ano', { ascending: false })
      .order('mes', { ascending: false })

    const targetProfile = activeProfile || profile

    if (targetProfile) {
      query = applyAccessFilters(query, targetProfile)
    }

    const currentMes = mesVal !== undefined ? mesVal : filterMes
    const currentAno = anoVal !== undefined ? anoVal : filterAno

    if (currentMes !== 'todos') {
      query = query.eq('mes', parseInt(currentMes, 10))
    }
    if (currentAno !== 'todos') {
      query = query.eq('ano', parseInt(currentAno, 10))
    }

    const { data, error } = await query

    if (error) {
      console.error('Erro ao carregar escalas:', error)
    } else if (data) {
      const mapped = data.map(e => {
        const sectorData = Array.isArray(e.setores) ? e.setores[0] : e.setores
        const dictData = sectorData ? (Array.isArray(sectorData.dicionario_setores) 
          ? sectorData.dicionario_setores[0] 
          : sectorData.dicionario_setores) : null
          
        return {
          ...e,
          setores: sectorData ? {
            nome: dictData?.nome || 'SETOR SEM NOME'
          } : null
        }
      })
      setEscalas(mapped)
    }
    setLoading(false)
  }

  async function toggleAtivo(uId: string, sId: string, mes: number, ano: number, currentAtivo: boolean) {
    const title = currentAtivo ? 'Inativar Escala' : 'Reativar Escala'
    const message = currentAtivo 
      ? 'Deseja INATIVAR todas as escalas deste período/setor? Elas não aparecerão nas buscas padrão.' 
      : 'Deseja REATIVAR todas as escalas deste período/setor?'
    
    setConfirmModal({
      isOpen: true,
      title,
      message,
      type: currentAtivo ? 'warning' : 'default',
      onConfirm: async () => {
        const { error } = await supabase
          .from('escala_mensal')
          .update({ 
            ativo: !currentAtivo,
            inativada_em: !currentAtivo ? new Date().toISOString() : null
          })
          .match({ unidade_id: uId, setor_id: sId, mes, ano })

        if (error) {
          setAlertModal({
            isOpen: true,
            title: 'Erro',
            message: error.message,
            type: 'danger'
          })
        } else {
          setAlertModal({
            isOpen: true,
            title: 'Sucesso',
            message: currentAtivo ? 'Escala inativada com sucesso.' : 'Escala reativada com sucesso.',
            type: 'success'
          })
          logAction(
            currentAtivo ? 'INATIVAR_ESCALA' : 'REATIVAR_ESCALA',
            uId, sId, mes, ano,
            { motivo: currentAtivo ? 'Inativação manual pela lista' : 'Reativação manual pela lista' }
          )
          fetchEscalas()
        }
        setConfirmModal(null)
      }
    })
  }

  // Get unique units for the filter
  const unidades = Array.from(new Set(escalas.map(e => JSON.stringify({ id: e.unidade_id, nome: e.unidades?.nome }))))
    .map(s => JSON.parse(s))

  // Grouped logic
  const filteredEscalas = escalas.filter(e => {
    const searchTermLower = searchTerm.toLowerCase()
    const unitName = (e.unidades?.nome || '').toLowerCase()
    const sectorName = (e.setores?.nome || '').toLowerCase()

    const matchesSearch = unitName.includes(searchTermLower) || sectorName.includes(searchTermLower)
    const matchesUnidade = filterUnidade === 'todas' || e.unidade_id === filterUnidade
    const matchesAtivo = showInactive ? true : e.ativo !== false
    const matchesStatus = filterStatus === 'todos' || 
      (filterStatus === 'fechada' && e.status === 'Fechada') ||
      (filterStatus === 'previsao' && e.status !== 'Fechada')

    // Incremental Servidor Filter (Nome, CPF ou Matrícula)
    let matchesServidor = true
    if (searchServidor.trim()) {
      const servTermLower = searchServidor.trim().toLowerCase()
      const cleanCpfSearch = searchServidor.replace(/\D/g, '')

      const servNome = (e.servidores?.nome || '').toLowerCase()
      const servMatricula = (e.servidores?.matricula || '').toLowerCase()
      const servCpf = (e.servidores?.cpf || '').replace(/\D/g, '')
      const rawServCpf = (e.servidores?.cpf || '').toLowerCase()

      const matchName = servNome.includes(servTermLower)
      const matchMatricula = servMatricula.includes(servTermLower)
      const matchCpf = cleanCpfSearch ? servCpf.includes(cleanCpfSearch) : rawServCpf.includes(servTermLower)

      matchesServidor = matchName || matchMatricula || matchCpf
    }
    
    // Security layer in memory (Secondary check)
    let rolePermitted = true
    if (profile?.role === 'super_admin') {
      rolePermitted = true
    } else if (profile?.role === 'admin') {
      rolePermitted = hasSectorAccess(profile, e.setor_id, e.unidade_id)
    } else if (profile?.role === 'coordenador') {
      // Regra restrita: Coordenador só vê se estiver vinculado ao setor ou se tiver acesso total aos setores da sua unidade
      rolePermitted = hasSectorAccess(profile, e.setor_id, e.unidade_id)
    } else if (profile?.role === 'comum' || profile?.role === 'servidor') {
      rolePermitted = e.servidor_id === linkedServidorId
    }

    return matchesSearch && matchesUnidade && matchesAtivo && matchesStatus && matchesServidor && rolePermitted
  })

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

  const anos = [
    { value: 'todos', label: 'Todos os Anos' },
    ...Array.from({ length: 5 }, (_, i) => {
      const year = new Date().getFullYear() - 2 + i
      return { value: String(year), label: String(year) }
    })
  ]

  const groupedKeys = Array.from(new Set(filteredEscalas.map(e => `${e.unidade_id}|${e.setor_id}|${e.mes}|${e.ano}`)))

  const itemsPerPage = 10
  const totalItems = groupedKeys.length
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const paginatedKeys = groupedKeys.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  const getPageNumbers = () => {
    const range = 2
    const pages: number[] = []
    for (let i = Math.max(1, currentPage - range); i <= Math.min(totalPages, currentPage + range); i++) {
      pages.push(i)
    }
    return pages
  }

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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Escalas de Serviço</h1>
          <p className="mt-1 text-zinc-500 text-sm italic">Gestão centralizada de plantões e sobreavisos.</p>
        </div>
          {(profile?.role === 'super_admin' || profile?.role === 'admin' || profile?.role === 'coordenador' || profile?.role === 'rh' || profile?.role === 'rh_unidade') && (
            <Link
              href="/escalas/nova"
              className="inline-flex items-center rounded-xl bg-blue-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all uppercase tracking-tighter"
            >
              <Plus className="mr-2 h-5 w-5" />
              Gerar Nova Escala
            </Link>
          )}
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input 
              type="text" 
              placeholder="Buscar por unidade ou setor..."
              className="w-full pl-10 pr-8 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-zinc-400" />
            <select 
              className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              value={filterUnidade}
              onChange={(e) => setFilterUnidade(e.target.value)}
            >
              <option value="todas">Todas as Unidades</option>
              {unidades.map(u => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-zinc-400" />
            <select 
              className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              value={filterMes}
              onChange={(e) => setFilterMes(e.target.value)}
            >
              {meses.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <select 
              className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              value={filterAno}
              onChange={(e) => setFilterAno(e.target.value)}
            >
              {anos.map(a => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-zinc-400" />
            <select 
              className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="todos">Todos os Status</option>
              <option value="previsao">Previsão</option>
              <option value="fechada">Fechada</option>
            </select>
          </div>

          <button 
            onClick={() => setShowInactive(!showInactive)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all border ${
              showInactive 
                ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-600' 
                : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            {showInactive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {showInactive ? 'Ocultar Inativas' : 'Mostrar Inativas'}
          </button>
        </div>

        {/* Linha dedicada de filtro por Servidor (Destaque da busca incremental) */}
        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-3">
          <div className="flex-1 relative">
            <UserSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-500" />
            <input 
              type="text" 
              placeholder="Buscar servidor por nome, CPF ou matrícula (busca incremental)..."
              className="w-full pl-10 pr-10 py-2 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/60 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-blue-900/50 dark:placeholder:text-blue-300/40 text-blue-950 dark:text-blue-100 font-medium"
              value={searchServidor}
              onChange={(e) => setSearchServidor(e.target.value)}
            />
            {searchServidor ? (
              <button 
                onClick={() => setSearchServidor('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                title="Limpar busca de servidor"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          {searchServidor.trim() && (
            <span className="text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40 px-3 py-1.5 rounded-lg whitespace-nowrap hidden sm:inline-block">
              Filtrando por servidor
            </span>
          )}
        </div>
      </div>

      {/* Servidor Search Global Diagnosis Banner */}
      {searchServidor.trim().length >= 2 && serverSearchResult.hasSearched && (
        <div className="space-y-3">
          {/* Scenario 1: Server exists in database, but is NOT in any scale globally */}
          {serverSearchResult.matchedServidores.length > 0 && serverSearchResult.globalEscalas.length === 0 && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl flex items-start gap-3 text-amber-800 dark:text-amber-300 text-sm">
              <AlertCircle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div>
                <p className="font-bold">Servidor localizado no cadastro, porém NÃO ESTÁ INSERIDO em nenhuma escala de serviço:</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {serverSearchResult.matchedServidores.map(s => (
                    <span key={s.id} className="bg-amber-100 dark:bg-amber-900/50 px-2.5 py-0.5 rounded-md font-semibold text-xs border border-amber-300 dark:border-amber-700">
                      {s.nome} {s.matricula ? `(Mat: ${s.matricula})` : ''} {s.cpf ? `(CPF: ${formatCpf(s.cpf)})` : ''}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Scenario 2: Server has scales in other months/years, but none match current active filter */}
          {serverSearchResult.matchedServidores.length > 0 && 
           serverSearchResult.globalEscalas.length > 0 && 
           groupedKeys.length === 0 && 
           (filterMes !== 'todos' || filterAno !== 'todos') && (
            <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-blue-900 dark:text-blue-200 text-sm">
              <div className="flex items-start gap-3">
                <UserCheck className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
                <div>
                  <p className="font-bold">Servidor localizado em escala(s) de OUTRO PERÍODO:</p>
                  <p className="text-xs mt-0.5 opacity-90">
                    O servidor possui {serverSearchResult.globalEscalas.length} escala(s) em outros meses ou anos.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setFilterMes('todos')
                  setFilterAno('todos')
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shrink-0 shadow-md shadow-blue-500/20"
              >
                Ver em Todos os Meses
              </button>
            </div>
          )}

          {/* Scenario 3: No server found in database at all */}
          {serverSearchResult.matchedServidores.length === 0 && (
            <div className="p-4 bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-2xl flex items-center gap-3 text-zinc-600 dark:text-zinc-400 text-sm">
              <AlertCircle className="h-5 w-5 shrink-0 text-zinc-400" />
              <span>Nenhum servidor cadastrado encontrado contendo <strong>"{searchServidor}"</strong>.</span>
            </div>
          )}
        </div>
      )}

      {/* List */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {paginatedKeys.map((key) => {
            const [uId, sId, mes, ano] = key.split('|')
            const item = filteredEscalas.find(e => 
              e.unidade_id === uId && 
              e.setor_id === sId && 
              e.mes === parseInt(mes) && 
              e.ano === parseInt(ano)
            )

            if (!item) return null
            const isAtiva = item.ativo !== false

            // Find matching servers for this card if searchServidor is typed
            let matchingServersInCard: any[] = []
            if (searchServidor.trim()) {
              const servTermLower = searchServidor.trim().toLowerCase()
              const cleanCpfSearch = searchServidor.replace(/\D/g, '')

              const matchingItemsInScale = filteredEscalas.filter(e => {
                if (e.unidade_id !== uId || e.setor_id !== sId || e.mes !== parseInt(mes) || e.ano !== parseInt(ano) || !e.servidores) {
                  return false
                }
                const servNome = (e.servidores.nome || '').toLowerCase()
                const servMatricula = (e.servidores.matricula || '').toLowerCase()
                const servCpf = (e.servidores.cpf || '').replace(/\D/g, '')
                const rawServCpf = (e.servidores.cpf || '').toLowerCase()

                return servNome.includes(servTermLower) || servMatricula.includes(servTermLower) || (cleanCpfSearch ? servCpf.includes(cleanCpfSearch) : rawServCpf.includes(servTermLower))
              })

              matchingServersInCard = Array.from(
                new Map(matchingItemsInScale.map(e => [e.servidores.id, e.servidores])).values()
              )
            }

            return (
              <div key={key} className={`flex flex-col sm:flex-row sm:items-center justify-between p-6 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-all group gap-4 ${!isAtiva ? 'opacity-60 bg-zinc-50/50 dark:bg-zinc-900/50' : ''}`}>
                <Link
                  href={`/escalas/unidade/${uId}?setor=${sId}&mes=${mes}&ano=${ano}`}
                  className="flex-1 flex items-start sm:items-center space-x-6 sm:space-x-8"
                >
                  <div className="text-center w-20 border-r border-zinc-200 dark:border-zinc-800 pr-6 shrink-0">
                    <span className={`block text-3xl font-black uppercase tracking-tighter ${isAtiva ? 'text-blue-600' : 'text-zinc-500'}`}>
                      {new Date(parseInt(ano), parseInt(mes) - 1).toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}
                    </span>
                    <span className="block text-[10px] font-black text-zinc-500 dark:text-zinc-500 uppercase tracking-widest">
                      {ano}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                        {item.unidades?.nome}
                      </h3>
                      {!isAtiva && (
                        <span className="text-[10px] font-black uppercase bg-red-100 dark:bg-red-900/30 text-red-600 px-2 py-0.5 rounded-full">Inativa</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center text-sm font-bold text-blue-600 dark:text-blue-400 gap-2">
                      <div className="flex items-center">
                        <Layers className="mr-1.5 h-4 w-4" />
                        {item.setores?.nome}
                      </div>
                      <span className="text-zinc-300 dark:text-zinc-700">|</span>
                      <span className={`px-2 py-0.5 text-[10px] font-black uppercase rounded ${
                        item.status === 'Fechada' 
                          ? 'bg-zinc-100 dark:bg-zinc-805 text-zinc-500' 
                          : 'bg-amber-100 dark:bg-amber-900/20 text-amber-600'
                      }`}>
                        {item.status === 'Fechada' ? 'Fechada' : 'Previsão'}
                      </span>
                    </div>

                    {/* Badge do Servidor Localizado */}
                    {searchServidor.trim() && matchingServersInCard.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-extrabold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2.5 py-0.5 rounded-lg flex items-center gap-1.5 shadow-xs">
                          <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                          Servidor localizado ({matchingServersInCard.length}):
                        </span>
                        {matchingServersInCard.map((s: any) => (
                          <span key={s.id} className="text-xs font-bold text-zinc-900 dark:text-white bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700">
                            {s.nome} {s.matricula ? `• Mat: ${s.matricula}` : ''} {s.cpf ? `• CPF: ${formatCpf(s.cpf)}` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
                
                <div className="flex items-center gap-4 self-end sm:self-center">
                  <button 
                    onClick={() => toggleAtivo(uId, sId, parseInt(mes), parseInt(ano), isAtiva)}
                    className={`p-2 rounded-xl transition-all ${
                      isAtiva 
                        ? 'text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20' 
                        : 'text-zinc-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                    }`}
                    title={isAtiva ? 'Inativar Escala' : 'Reativar Escala'}
                  >
                    {isAtiva ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                  <Link href={`/escalas/unidade/${uId}?setor=${sId}&mes=${mes}&ano=${ano}`}>
                    <ChevronRight className="h-6 w-6 text-zinc-300 group-hover:text-blue-500 transition-colors" />
                  </Link>
                </div>
              </div>
            )
          })}

          {groupedKeys.length === 0 && (
            <div className="p-20 text-center text-zinc-500 dark:text-zinc-400">
              <Calendar className="mx-auto h-16 w-16 opacity-10 mb-6" />
              <p className="text-xl font-bold uppercase tracking-tight">Nenhuma escala encontrada</p>
              <p className="text-sm mt-2">Tente ajustar seus filtros ou gere uma nova escala.</p>
              <Link href="/escalas/nova" className="mt-8 inline-flex items-center text-blue-600 font-bold hover:underline">
                Gerar Nova Escala agora <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </div>
          )}
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between border-t border-zinc-200 dark:border-zinc-800 px-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/50 gap-4">
            <div className="text-xs font-black uppercase tracking-wider text-zinc-400">
              Mostrando <span className="font-extrabold text-zinc-900 dark:text-white">{(currentPage - 1) * itemsPerPage + 1}</span> a <span className="font-extrabold text-zinc-900 dark:text-white">{Math.min(totalItems, currentPage * itemsPerPage)}</span> de <span className="font-extrabold text-zinc-900 dark:text-white">{totalItems}</span> escalas
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

      {/* Modals */}
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
    </div>
  )
}
