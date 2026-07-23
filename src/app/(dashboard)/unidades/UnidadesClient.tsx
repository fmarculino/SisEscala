'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { 
  Building2, 
  Plus, 
  MapPin, 
  Eye, 
  EyeOff, 
  Search, 
  Loader2, 
  ChevronRight,
  LayoutGrid,
  List,
  TableProperties,
  Layers,
  Navigation,
  CheckCircle2,
  XCircle
} from 'lucide-react'
import Link from 'next/link'
import { applyAccessFilters } from '@/utils/permissions'

interface UnidadesClientProps {
  userProfile: any
}

export default function UnidadesClient({ userProfile }: UnidadesClientProps) {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [unidades, setUnidades] = useState<any[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'cards' | 'list' | 'detailed'>('cards')

  useEffect(() => {
    fetchUnidades()
    const savedMode = localStorage.getItem('unidades_view_mode') as 'cards' | 'list' | 'detailed'
    if (savedMode && ['cards', 'list', 'detailed'].includes(savedMode)) {
      setViewMode(savedMode)
    }
  }, [])

  const handleViewModeChange = (mode: 'cards' | 'list' | 'detailed') => {
    setViewMode(mode)
    localStorage.setItem('unidades_view_mode', mode)
  }

  async function fetchUnidades() {
    setLoading(true)
    
    let query = supabase
      .from('unidades')
      .select('*, setores(id)')
      .order('nome')
    
    // Aplicar filtros de acesso baseados no perfil
    query = applyAccessFilters(query, userProfile)
    
    const { data, error } = await query
    
    if (error) {
      console.error('Erro ao carregar unidades:', error)
    } else {
      setUnidades(data || [])
    }
    setLoading(false)
  }

  const filteredUnidades = unidades.filter(u => {
    const matchesSearch = u.nome?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          u.endereco?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesAtivo = showInactive ? true : u.ativo !== false
    return matchesSearch && matchesAtivo
  })

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Unidades de Saúde</h1>
          <p className="mt-1 text-zinc-500 text-sm italic">Gestão de estabelecimentos e geolocalização.</p>
        </div>
        {userProfile?.role === 'super_admin' && (
          <Link
            href="/unidades/nova"
            className="inline-flex items-center rounded-xl bg-blue-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all uppercase tracking-tighter"
          >
            <Plus className="mr-2 h-5 w-5" />
            Nova Unidade
          </Link>
        )}
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input 
            type="text" 
            placeholder="Buscar por nome ou endereço..."
            className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-3">
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

          {/* View Switcher Toggle */}
          <div className="flex items-center bg-zinc-100 dark:bg-zinc-800/80 p-1 rounded-xl border border-zinc-200 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => handleViewModeChange('cards')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'cards'
                  ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
              }`}
              title="Visualização em Cards"
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="hidden sm:inline">Cards</span>
            </button>

            <button
              type="button"
              onClick={() => handleViewModeChange('list')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
              }`}
              title="Listagem Simples"
            >
              <List className="h-4 w-4" />
              <span className="hidden sm:inline">Lista</span>
            </button>

            <button
              type="button"
              onClick={() => handleViewModeChange('detailed')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'detailed'
                  ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
              }`}
              title="Listagem Detalhada"
            >
              <TableProperties className="h-4 w-4" />
              <span className="hidden sm:inline">Detalhada</span>
            </button>
          </div>
        </div>
      </div>

      {/* Render View Modes */}
      {filteredUnidades.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 p-16 bg-white dark:bg-zinc-900">
          <Building2 className="h-16 w-16 text-zinc-300 dark:text-zinc-700 mb-4 opacity-20" />
          <p className="text-lg font-black text-zinc-400 dark:text-zinc-600 uppercase tracking-tight">Nenhuma unidade encontrada</p>
          <p className="text-sm text-zinc-500 mt-2 italic">Tente ajustar seus filtros ou cadastre uma nova unidade.</p>
        </div>
      ) : viewMode === 'cards' ? (
        /* CARDS VIEW */
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredUnidades.map((unidade) => {
            const isAtiva = unidade.ativo !== false
            const qtdSetores = Array.isArray(unidade.setores) ? unidade.setores.length : 0

            return (
              <div
                key={unidade.id}
                className={`group rounded-2xl border bg-white p-6 shadow-sm dark:bg-zinc-900 transition-all hover:shadow-xl hover:scale-[1.02] flex flex-col justify-between ${
                  isAtiva 
                    ? 'border-zinc-200 dark:border-zinc-800' 
                    : 'border-zinc-100 dark:border-zinc-800 opacity-60 grayscale-[0.5]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    {unidade.logo_url ? (
                      <div className="h-12 w-24 border border-zinc-200 dark:border-zinc-800 rounded-xl p-1 bg-white dark:bg-zinc-950 flex items-center justify-center overflow-hidden">
                        <img 
                          src={unidade.logo_url} 
                          alt={`Logo ${unidade.nome}`} 
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className={`rounded-xl p-3 ${isAtiva ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>
                        <Building2 className="h-6 w-6" />
                      </div>
                    )}
                    {!isAtiva && (
                      <span className="text-[10px] font-black uppercase bg-red-100 dark:bg-red-900/30 text-red-600 px-2 py-0.5 rounded-full">Inativa</span>
                    )}
                  </div>
                  
                  <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">
                    {unidade.nome}
                  </h3>
                  
                  <div className="mt-2 space-y-2">
                    <div className="flex items-start text-sm text-zinc-500 dark:text-zinc-400">
                      <MapPin className="mr-2 h-4 w-4 mt-0.5 shrink-0 text-zinc-400" />
                      <span className="line-clamp-2 leading-relaxed">
                        {unidade.endereco || 'Endereço não informado'}
                      </span>
                    </div>

                    <div className="flex items-center text-xs font-semibold text-zinc-600 dark:text-zinc-400 pt-1">
                      <Layers className="mr-2 h-3.5 w-3.5 text-blue-500 opacity-70" />
                      <span>{qtdSetores} {qtdSetores === 1 ? 'setor cadastrado' : 'setores cadastrados'}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
                  <Link
                    href={`/unidades/${unidade.id}`}
                    className="inline-flex items-center text-xs font-black uppercase tracking-widest text-blue-600 hover:gap-2 transition-all"
                  >
                    Configurar Unidade <ChevronRight className="ml-1 h-3 w-3" />
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      ) : viewMode === 'list' ? (
        /* SIMPLE LIST VIEW */
        <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800 text-left">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                <tr>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Unidade</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Endereço</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {filteredUnidades.map((unidade) => {
                  const isAtiva = unidade.ativo !== false

                  return (
                    <tr 
                      key={unidade.id}
                      className={`hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30 transition-colors ${
                        !isAtiva ? 'opacity-60 grayscale-[0.5]' : ''
                      }`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          {unidade.logo_url ? (
                            <div className="h-10 w-12 border border-zinc-200 dark:border-zinc-800 rounded-lg p-0.5 bg-white dark:bg-zinc-950 flex items-center justify-center overflow-hidden shrink-0">
                              <img 
                                src={unidade.logo_url} 
                                alt={`Logo ${unidade.nome}`} 
                                className="max-h-full max-w-full object-contain"
                              />
                            </div>
                          ) : (
                            <div className={`rounded-lg p-2.5 shrink-0 ${isAtiva ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>
                              <Building2 className="h-5 w-5" />
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                              {unidade.nome}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400 max-w-md truncate">
                        {unidade.endereco || 'Endereço não informado'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {isAtiva ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/50">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Ativa
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-900/20 px-2.5 py-0.5 text-xs font-bold text-red-700 dark:text-red-400 border border-red-200/50 dark:border-red-800/50">
                            <XCircle className="h-3.5 w-3.5" />
                            Inativa
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                        <Link
                          href={`/unidades/${unidade.id}`}
                          className="inline-flex items-center text-xs font-black uppercase tracking-widest text-blue-600 hover:text-blue-800 dark:hover:text-blue-400 transition-all"
                        >
                          Configurar <ChevronRight className="ml-1 h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* DETAILED LIST VIEW */
        <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800 text-left">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                <tr>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Unidade</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Endereço Completo</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Geolocalização / Geofence</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Setores</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {filteredUnidades.map((unidade) => {
                  const isAtiva = unidade.ativo !== false
                  const qtdSetores = Array.isArray(unidade.setores) ? unidade.setores.length : 0
                  const hasGeo = unidade.latitude !== null && unidade.longitude !== null

                  return (
                    <tr 
                      key={unidade.id}
                      className={`hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30 transition-colors ${
                        !isAtiva ? 'opacity-60 grayscale-[0.5]' : ''
                      }`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          {unidade.logo_url ? (
                            <div className="h-10 w-12 border border-zinc-200 dark:border-zinc-800 rounded-lg p-0.5 bg-white dark:bg-zinc-950 flex items-center justify-center overflow-hidden shrink-0">
                              <img 
                                src={unidade.logo_url} 
                                alt={`Logo ${unidade.nome}`} 
                                className="max-h-full max-w-full object-contain"
                              />
                            </div>
                          ) : (
                            <div className={`rounded-lg p-2.5 shrink-0 ${isAtiva ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>
                              <Building2 className="h-5 w-5" />
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                              {unidade.nome}
                            </div>
                            <span className="text-[10px] text-zinc-400 font-mono">ID: {unidade.id.slice(0, 8)}...</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400 max-w-xs">
                        <div className="flex items-start gap-1.5">
                          <MapPin className="h-4 w-4 text-zinc-400 shrink-0 mt-0.5" />
                          <span>{unidade.endereco || 'Endereço não informado'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm whitespace-nowrap">
                        {hasGeo ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-800 dark:text-zinc-200">
                              <Navigation className="h-3.5 w-3.5 text-blue-500" />
                              {unidade.latitude?.toFixed(5)}, {unidade.longitude?.toFixed(5)}
                            </span>
                            <span className="text-[11px] text-zinc-500 font-medium">
                              Cerca: <strong className="text-zinc-700 dark:text-zinc-300">{unidade.raio_geofence || 100}m</strong>
                            </span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-md">
                            Sem geolocalização
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-bold">
                          <Layers className="h-3.5 w-3.5 text-blue-500" />
                          {qtdSetores} {qtdSetores === 1 ? 'setor' : 'setores'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {isAtiva ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/50">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Ativa
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-900/20 px-2.5 py-0.5 text-xs font-bold text-red-700 dark:text-red-400 border border-red-200/50 dark:border-red-800/50">
                            <XCircle className="h-3.5 w-3.5" />
                            Inativa
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                        <Link
                          href={`/unidades/${unidade.id}`}
                          className="inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs font-black uppercase tracking-wider hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all"
                        >
                          Configurar <ChevronRight className="ml-1 h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

