'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Layers, Plus, Building2, ChevronRight, Eye, EyeOff, Search, Loader2, ChevronDown, Tag, MoreHorizontal } from 'lucide-react'
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
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetchSetores()
  }, [])

  async function fetchSetores() {
    setLoading(true)
    
    let query = supabase
      .from('setores')
      .select('*, unidades(id, nome)')
      .order('nome')
    
    query = applyAccessFilters(query, userProfile, { setorField: 'id' })
    
    const { data, error } = await query
    
    if (error) {
      console.error('Erro ao carregar setores:', error)
    } else {
      setSetores(data || [])
    }
    setLoading(false)
  }

  const toggleNode = (id: string) => {
    setExpandedNodes(prev => ({ ...prev, [id]: !prev[id] }))
  }

  // Organizar setores em estrutura de árvore por unidade
  const setoresTree = useMemo(() => {
    const filtered = setores.filter(s => {
      const matchesSearch = s.nome?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            s.unidades?.nome?.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesUnidade = filterUnidade === 'todas' || s.unidade_id === filterUnidade
      const matchesAtivo = showInactive ? true : s.ativo !== false
      return matchesSearch && matchesUnidade && matchesAtivo
    })

    const tree: Record<string, { unidade: any, rootSectors: any[] }> = {}

    filtered.forEach(s => {
      const unidadeId = s.unidade_id
      if (!tree[unidadeId]) {
        tree[unidadeId] = { 
          unidade: s.unidades, 
          rootSectors: [] 
        }
      }
    })

    // Construir árvore para cada unidade
    Object.keys(tree).forEach(unidadeId => {
      const unitSetores = filtered.filter(s => s.unidade_id === unidadeId)
      const sectorMap: Record<string, any> = {}
      
      unitSetores.forEach(s => {
        sectorMap[s.id] = { ...s, children: [] }
      })

      unitSetores.forEach(s => {
        if (s.parent_id && sectorMap[s.parent_id]) {
          sectorMap[s.parent_id].children.push(sectorMap[s.id])
        } else {
          tree[unidadeId].rootSectors.push(sectorMap[s.id])
        }
      })
    })

    return tree
  }, [setores, searchTerm, filterUnidade, showInactive])

  const unidadesParaFiltro = useMemo(() => {
    const map = new Map()
    setores.forEach(s => {
      if (s.unidades) map.set(s.unidades.id, s.unidades.nome)
    })
    return Array.from(map.entries()).map(([id, nome]) => ({ id, nome }))
  }, [setores])

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
          <p className="text-zinc-500 font-black uppercase tracking-widest text-[10px]">Construindo Estrutura...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
              <Layers className="h-6 w-6" />
            </div>
            <h1 className="text-4xl font-black tracking-tighter text-zinc-900 dark:text-white uppercase">Organização</h1>
          </div>
          <p className="text-zinc-500 text-sm font-medium italic pl-1">Hierarquia de setores e fluxos administrativos.</p>
        </div>
        <Link
          href="/setores/novo"
          className="inline-flex items-center rounded-2xl bg-zinc-900 dark:bg-white px-8 py-4 text-sm font-black text-white dark:text-zinc-900 shadow-2xl hover:scale-105 active:scale-95 transition-all uppercase tracking-widest"
        >
          <Plus className="mr-2 h-5 w-5" />
          Novo Setor
        </Link>
      </div>

      {/* Control Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-6 relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-400 group-focus-within:text-blue-500 transition-colors" />
          <input 
            type="text" 
            placeholder="Filtrar por nome do setor ou unidade..."
            className="w-full pl-12 pr-4 py-4 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 rounded-2xl text-sm font-bold outline-none focus:border-blue-500 transition-all shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="lg:col-span-3 flex items-center gap-2">
          <div className="relative w-full">
            <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-400" />
            <select 
              className="w-full pl-12 pr-4 py-4 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 rounded-2xl text-sm font-black outline-none focus:border-blue-500 transition-all appearance-none uppercase tracking-tighter"
              value={filterUnidade}
              onChange={(e) => setFilterUnidade(e.target.value)}
            >
              <option value="todas">Todas as Unidades</option>
              {unidadesParaFiltro.map(u => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
          </div>
        </div>

        <div className="lg:col-span-3">
          <button 
            onClick={() => setShowInactive(!showInactive)}
            className={`w-full h-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border-2 ${
              showInactive 
                ? 'bg-amber-500 border-amber-600 text-white shadow-lg shadow-amber-500/20' 
                : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300'
            }`}
          >
            {showInactive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {showInactive ? 'Ocultando Inativos' : 'Exibir Inativos'}
          </button>
        </div>
      </div>

      {/* Tree Content */}
      <div className="space-y-6">
        {Object.entries(setoresTree).map(([unidadeId, data]) => (
          <div key={unidadeId} className="group overflow-hidden rounded-[2.5rem] border-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 shadow-sm hover:shadow-xl hover:border-blue-500/30 transition-all">
            {/* Unidade Header */}
            <div className="bg-white dark:bg-zinc-900 px-8 py-6 border-b-2 border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                  <Building2 className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-black uppercase tracking-tighter text-zinc-900 dark:text-white">
                    {data.unidade?.nome}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                      {data.rootSectors.length} setores principais
                    </span>
                  </div>
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <Link 
                  href={`/unidades/${unidadeId}`}
                  className="text-[10px] font-black uppercase tracking-widest text-blue-600 hover:underline"
                >
                  Ver Unidade
                </Link>
              </div>
            </div>

            {/* Tree Nodes */}
            <div className="p-4 space-y-2">
              {data.rootSectors.map((sector: any) => (
                <SectorNode 
                  key={sector.id} 
                  sector={sector} 
                  level={0} 
                  expandedNodes={expandedNodes} 
                  toggleNode={toggleNode} 
                />
              ))}
            </div>
          </div>
        ))}

        {Object.keys(setoresTree).length === 0 && (
          <div className="flex flex-col items-center justify-center p-32 text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-900 rounded-[3rem] border-2 border-dashed border-zinc-200 dark:border-zinc-800">
            <Layers className="h-20 w-20 opacity-5 mb-8" />
            <p className="text-2xl font-black uppercase tracking-tighter">Nenhum setor encontrado</p>
            <p className="text-sm mt-2 italic font-medium">Refine sua busca ou verifique as permissões de acesso.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function SectorNode({ sector, level, expandedNodes, toggleNode }: any) {
  const isExpanded = expandedNodes[sector.id]
  const hasChildren = sector.children && sector.children.length > 0
  const isAtivo = sector.ativo !== false

  return (
    <div className="space-y-1">
      <div 
        className={`flex items-center justify-between p-3 rounded-2xl transition-all group/node ${
          isAtivo 
            ? 'bg-white dark:bg-zinc-900 shadow-sm border border-zinc-100 dark:border-zinc-800 hover:border-blue-500/50' 
            : 'bg-zinc-100/50 dark:bg-zinc-800/30 opacity-60 border-dashed border border-zinc-300 dark:border-zinc-700'
        }`}
        style={{ marginLeft: `${level * 2}rem` }}
      >
        <div className="flex items-center gap-4 flex-1">
          {hasChildren ? (
            <button 
              onClick={() => toggleNode(sector.id)}
              className={`p-1.5 rounded-lg transition-all ${isExpanded ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 rotate-90' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <div className="w-7 flex justify-center">
              <Tag className="h-3 w-3 text-zinc-300" />
            </div>
          )}

          <div className="flex flex-col">
            <span className={`text-sm font-black uppercase tracking-tight ${isAtivo ? 'text-zinc-900 dark:text-white' : 'text-zinc-500'}`}>
              {sector.nome}
            </span>
            {hasChildren && !isExpanded && (
              <span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest mt-0.5">
                {sector.children.length} subdivisões ocultas
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!isAtivo && (
            <span className="px-2 py-0.5 text-[8px] font-black uppercase bg-red-100 dark:bg-red-900/30 text-red-600 rounded-full">
              Inativo
            </span>
          )}
          <Link 
            href={`/setores/${sector.id}`}
            className="p-2 rounded-xl text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all"
          >
            <MoreHorizontal className="h-5 w-5" />
          </Link>
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div className="relative">
          {/* Vertical line for the tree */}
          <div 
            className="absolute left-[0.85rem] top-0 bottom-4 w-0.5 bg-zinc-200 dark:bg-zinc-800" 
            style={{ marginLeft: `${level * 2}rem` }}
          />
          <div className="space-y-1">
            {sector.children.map((child: any) => (
              <SectorNode 
                key={child.id} 
                sector={child} 
                level={level + 1} 
                expandedNodes={expandedNodes} 
                toggleNode={toggleNode} 
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
