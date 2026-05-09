'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Building2, Plus, MapPin, Eye, EyeOff, Search, Loader2, ChevronRight } from 'lucide-react'
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

  useEffect(() => {
    fetchUnidades()
  }, [])

  async function fetchUnidades() {
    setLoading(true)
    
    let query = supabase
      .from('unidades')
      .select('*')
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
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-wrap items-center gap-4">
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

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {filteredUnidades.map((unidade) => {
          const isAtiva = unidade.ativo !== false
          return (
            <div
              key={unidade.id}
              className={`group rounded-2xl border bg-white p-6 shadow-sm dark:bg-zinc-900 transition-all hover:shadow-xl hover:scale-[1.02] ${
                isAtiva 
                  ? 'border-zinc-200 dark:border-zinc-800' 
                  : 'border-zinc-100 dark:border-zinc-800 opacity-60 grayscale-[0.5]'
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className={`rounded-xl p-3 ${isAtiva ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>
                  <Building2 className="h-6 w-6" />
                </div>
                {!isAtiva && (
                  <span className="text-[10px] font-black uppercase bg-red-100 dark:bg-red-900/30 text-red-600 px-2 py-0.5 rounded-full">Inativa</span>
                )}
              </div>
              
              <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">
                {unidade.nome}
              </h3>
              
              <div className="mt-2 space-y-2">
                <div className="flex items-start text-sm text-zinc-500 dark:text-zinc-400">
                  <MapPin className="mr-2 h-4 w-4 mt-0.5 shrink-0" />
                  <span className="line-clamp-2 leading-relaxed">
                    {unidade.endereco || 'Endereço não informado'}
                  </span>
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

        {filteredUnidades.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 p-16">
            <Building2 className="h-16 w-16 text-zinc-300 dark:text-zinc-700 mb-4 opacity-20" />
            <p className="text-lg font-black text-zinc-400 dark:text-zinc-600 uppercase tracking-tight">Nenhuma unidade encontrada</p>
            <p className="text-sm text-zinc-500 mt-2 italic">Tente ajustar seus filtros ou cadastre uma nova unidade.</p>
          </div>
        )}
      </div>
    </div>
  )
}
