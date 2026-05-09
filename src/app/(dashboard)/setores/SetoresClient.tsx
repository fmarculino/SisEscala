'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Layers, Plus, Building2, ChevronRight, Eye, EyeOff, Search, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { applyAccessFilters } from '@/utils/permissions'

interface SetoresClientProps {
  userProfile: any
}

export default function SetoresClient({ userProfile }: SetoresClientProps) {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [setores, setSetores] = useState<any[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterUnidade, setFilterUnidade] = useState('todas')

  useEffect(() => {
    fetchSetores()
  }, [])

  async function fetchSetores() {
    setLoading(true)
    
    let query = supabase
      .from('setores')
      .select('*, unidades(id, nome), parent:setores!parent_id(nome)')
      .order('nome')
    
    // Aplicar filtros de acesso baseados no perfil
    query = applyAccessFilters(query, userProfile, { setorField: 'id' })
    
    const { data, error } = await query
    
    if (error) {
      console.error('Erro ao carregar setores:', error)
    } else {
      setSetores(data || [])
    }
    setLoading(false)
  }

  // Get unique units for the filter
  const unidades = Array.from(new Set(setores.map(s => JSON.stringify(s.unidades))))
    .filter(Boolean)
    .map(u => JSON.parse(u as string))

  const filteredSetores = setores.filter(s => {
    const matchesSearch = s.nome?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          s.unidades?.nome?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesUnidade = filterUnidade === 'todas' || s.unidade_id === filterUnidade
    const matchesAtivo = showInactive ? true : s.ativo !== false
    return matchesSearch && matchesUnidade && matchesAtivo
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
          <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Setores e Serviços</h1>
          <p className="mt-1 text-zinc-500 text-sm italic">Organização estrutural para escalas e plantões.</p>
        </div>
        <Link
          href="/setores/novo"
          className="inline-flex items-center rounded-xl bg-blue-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all uppercase tracking-tighter"
        >
          <Plus className="mr-2 h-5 w-5" />
          Novo Setor
        </Link>
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input 
            type="text" 
            placeholder="Buscar por nome ou unidade..."
            className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
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

        <button 
          onClick={() => setShowInactive(!showInactive)}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all border ${
            showInactive 
              ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-600' 
              : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'
          }`}
        >
          {showInactive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          {showInactive ? 'Ocultar Inativos' : 'Mostrar Inativos'}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white shadow-xl dark:bg-zinc-900">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50">
            <tr>
              <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Setor / Serviço</th>
              <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Unidade</th>
              <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Vínculo Pai</th>
              <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Status</th>
              <th className="relative px-6 py-4"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
            {filteredSetores.map((setor) => {
              const isAtivo = setor.ativo !== false
              return (
                <tr key={setor.id} className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors group ${!isAtivo ? 'opacity-60 bg-zinc-50/50 dark:bg-zinc-900/50' : ''}`}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center mr-3 transition-colors ${isAtivo ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'}`}>
                        <Layers className="h-5 w-5" />
                      </div>
                      <span className={`text-sm font-black uppercase tracking-tight ${isAtivo ? 'text-zinc-900 dark:text-white' : 'text-zinc-500'}`}>
                        {setor.nome}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-zinc-600 dark:text-zinc-400">
                    <div className="flex items-center uppercase tracking-tighter">
                      <Building2 className="h-4 w-4 mr-2 opacity-50" />
                      {setor.unidades?.nome}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                    {setor.parent ? (
                      <div className="flex items-center font-medium italic">
                        <ChevronRight className="h-3 w-3 mr-1 opacity-50" />
                        {setor.parent.nome}
                      </div>
                    ) : (
                      <span className="text-[10px] font-black uppercase tracking-widest opacity-30">Principal</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <span className={`px-2 py-0.5 text-[10px] font-black uppercase rounded-full ${
                      isAtivo 
                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' 
                        : 'bg-red-100 dark:bg-red-900/30 text-red-600'
                    }`}>
                      {isAtivo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Link href={`/setores/${setor.id}`} className="inline-flex items-center text-blue-600 hover:text-blue-900 font-black uppercase text-[10px] tracking-widest">
                      Configurar <ChevronRight className="ml-1 h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {filteredSetores.length === 0 && (
          <div className="flex flex-col items-center justify-center p-20 text-zinc-500 dark:text-zinc-400">
            <Layers className="h-16 w-16 opacity-10 mb-6" />
            <p className="text-xl font-black uppercase tracking-tight">Nenhum setor encontrado</p>
            <p className="text-sm mt-2 italic">Tente ajustar seus filtros ou cadastre um novo setor.</p>
          </div>
        )}
      </div>
    </div>
  )
}
