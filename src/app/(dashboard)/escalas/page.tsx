'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Calendar, Plus, ChevronRight, Layers, Filter, Eye, EyeOff, Search, Loader2, Building2 } from 'lucide-react'
import Link from 'next/link'

export default function EscalasPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [escalas, setEscalas] = useState<any[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterUnidade, setFilterUnidade] = useState('todas')

  useEffect(() => {
    fetchEscalas()
  }, [])

  async function fetchEscalas() {
    setLoading(true)
    const { data, error } = await supabase
      .from('escala_mensal')
      .select('*, servidores(nome), unidades(nome), setores(nome)')
      .order('ano', { ascending: false })
      .order('mes', { ascending: false })

    if (error) {
      console.error('Erro ao carregar escalas:', error)
    } else {
      setEscalas(data || [])
    }
    setLoading(false)
  }

  async function toggleAtivo(uId: string, sId: string, mes: number, ano: number, currentAtivo: boolean) {
    const confirmMsg = currentAtivo 
      ? 'Deseja INATIVAR todas as escalas deste período/setor?' 
      : 'Deseja REATIVAR todas as escalas deste período/setor?'
    
    if (!confirm(confirmMsg)) return

    const { error } = await supabase
      .from('escala_mensal')
      .update({ 
        ativo: !currentAtivo,
        inativada_em: !currentAtivo ? new Date().toISOString() : null
      })
      .match({ unidade_id: uId, setor_id: sId, mes, ano })

    if (error) {
      alert('Erro: ' + error.message)
    } else {
      fetchEscalas()
    }
  }

  // Get unique units for the filter
  const unidades = Array.from(new Set(escalas.map(e => JSON.stringify({ id: e.unidade_id, nome: e.unidades?.nome }))))
    .map(s => JSON.parse(s))

  // Grouped logic
  const filteredEscalas = escalas.filter(e => {
    const matchesSearch = e.unidades?.nome?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          e.setores?.nome?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesUnidade = filterUnidade === 'todas' || e.unidade_id === filterUnidade
    const matchesAtivo = showInactive ? true : e.ativo !== false
    
    return matchesSearch && matchesUnidade && matchesAtivo
  })

  const groupedKeys = Array.from(new Set(filteredEscalas.map(e => `${e.unidade_id}|${e.setor_id}|${e.mes}|${e.ano}`)))

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
        <Link
          href="/escalas/nova"
          className="inline-flex items-center rounded-xl bg-blue-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all uppercase tracking-tighter"
        >
          <Plus className="mr-2 h-5 w-5" />
          Gerar Nova Escala
        </Link>
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input 
            type="text" 
            placeholder="Buscar por unidade ou setor..."
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
          {showInactive ? 'Ocultar Inativas' : 'Mostrar Inativas'}
        </button>
      </div>

      {/* List */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {groupedKeys.map((key) => {
            const [uId, sId, mes, ano] = key.split('|')
            const item = filteredEscalas.find(e => 
              e.unidade_id === uId && 
              e.setor_id === sId && 
              e.mes === parseInt(mes) && 
              e.ano === parseInt(ano)
            )

            if (!item) return null
            const isAtiva = item.ativo !== false

            return (
              <div key={key} className={`flex items-center justify-between p-6 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-all group ${!isAtiva ? 'opacity-60 bg-zinc-50/50 dark:bg-zinc-900/50' : ''}`}>
                <Link
                  href={`/escalas/unidade/${uId}?setor=${sId}&mes=${mes}&ano=${ano}`}
                  className="flex-1 flex items-center space-x-8"
                >
                  <div className="text-center w-20 border-r border-zinc-200 dark:border-zinc-800 pr-6">
                    <span className={`block text-3xl font-black uppercase tracking-tighter ${isAtiva ? 'text-blue-600' : 'text-zinc-500'}`}>
                      {new Date(parseInt(ano), parseInt(mes) - 1).toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}
                    </span>
                    <span className="block text-[10px] font-black text-zinc-500 dark:text-zinc-500 uppercase tracking-widest">
                      {ano}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                        {item.unidades?.nome}
                      </h3>
                      {!isAtiva && (
                        <span className="text-[10px] font-black uppercase bg-red-100 dark:bg-red-900/30 text-red-600 px-2 py-0.5 rounded-full">Inativa</span>
                      )}
                    </div>
                    <div className="flex items-center text-sm font-bold text-blue-600 dark:text-blue-400">
                      <Layers className="mr-1.5 h-4 w-4" />
                      {item.setores?.nome}
                      <span className="mx-3 text-zinc-300 dark:text-zinc-700">|</span>
                      <span className={`px-2 py-0.5 text-[10px] font-black uppercase rounded ${
                        item.status === 'Fechada' 
                          ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600' 
                          : 'bg-green-100 dark:bg-green-900/30 text-green-600'
                      }`}>
                        {item.status}
                      </span>
                    </div>
                  </div>
                </Link>
                
                <div className="flex items-center gap-4">
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
      </div>
    </div>
  )
}
