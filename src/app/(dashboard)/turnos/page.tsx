'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Clock, Plus, Edit2, Info, Search, Filter, Eye, EyeOff, Loader2 } from 'lucide-react'
import Link from 'next/link'

interface Turno {
  id: string
  codigo: string
  descricao: string
  horas_computadas: number
  tipo: string
  ativo: boolean
}

export default function TurnosPage() {
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  
  const supabase = createClient()

  useEffect(() => {
    fetchTurnos()
  }, [])

  async function fetchTurnos() {
    try {
      const { data, error } = await supabase
        .from('dicionario_turnos')
        .select('*')
        .order('codigo')
      
      if (error) throw error
      setTurnos(data || [])
    } catch (error: any) {
      console.error('Erro ao carregar turnos:', error.message)
    } finally {
      setLoading(false)
    }
  }

  const filteredTurnos = turnos.filter(t => {
    const matchesSearch = 
      t.codigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.descricao.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesStatus = showInactive || t.ativo !== false
    
    return matchesSearch && matchesStatus
  })

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 bg-white dark:bg-zinc-950 p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-none">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-xl text-white">
              <Clock className="h-6 w-6" />
            </div>
            <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Dicionário de Turnos</h1>
          </div>
          <p className="text-zinc-500 font-medium italic">Gerencie os códigos de escala e suas respectivas cargas horárias.</p>
        </div>
        
        <Link
          href="/turnos/novo"
          className="inline-flex items-center justify-center rounded-2xl bg-blue-600 px-6 py-4 text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 hover:-translate-y-0.5 active:translate-y-0 transition-all"
        >
          <Plus className="mr-2 h-5 w-5" />
          Novo Turno
        </Link>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col md:flex-row gap-4 bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <div className="relative flex-1 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 group-focus-within:text-blue-500 transition-colors" />
          <input
            type="text"
            placeholder="Buscar por código ou descrição..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm font-medium"
          />
        </div>
        
        <button
          onClick={() => setShowInactive(!showInactive)}
          className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl border font-black uppercase tracking-widest text-[10px] transition-all ${
            showInactive 
              ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800' 
              : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-400'
          }`}
        >
          {showInactive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          {showInactive ? 'Ocultar Inativos' : 'Mostrar Inativos'}
        </button>
      </div>

      {/* Table Container */}
      <div className="overflow-hidden rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl shadow-zinc-200/50 dark:shadow-none">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900/80">
            <tr>
              <th className="px-6 py-5 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Status</th>
              <th className="px-6 py-5 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Código</th>
              <th className="px-6 py-5 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Descrição</th>
              <th className="px-6 py-5 text-center text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Carga Horária</th>
              <th className="px-6 py-5 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Tipo</th>
              <th className="px-6 py-5 text-right text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 w-24">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-6 py-20 text-center">
                  <Loader2 className="h-10 w-10 animate-spin mx-auto text-blue-500 opacity-50" />
                </td>
              </tr>
            ) : filteredTurnos.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-20 text-center">
                  <Clock className="h-12 w-12 mx-auto text-zinc-200 dark:text-zinc-800 mb-4" />
                  <p className="text-zinc-400 font-bold uppercase text-xs tracking-widest">Nenhum turno encontrado</p>
                </td>
              </tr>
            ) : (
              filteredTurnos.map((turno) => (
                <tr 
                  key={turno.id} 
                  className={`group transition-all ${
                    turno.ativo === false ? 'bg-zinc-50/50 dark:bg-zinc-900/20 opacity-60' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/40'
                  }`}
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                      turno.ativo !== false 
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' 
                        : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-500'
                    }`}>
                      {turno.ativo !== false ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="font-mono font-black text-sm text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 rounded-xl border border-blue-100 dark:border-blue-800">
                      {turno.codigo}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-zinc-900 dark:text-white">{turno.descricao}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <div className="inline-flex flex-col items-center">
                      <span className="text-lg font-black text-zinc-900 dark:text-white tabular-nums">{turno.horas_computadas}</span>
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Horas</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex rounded-xl px-3 py-1 text-[10px] font-black uppercase tracking-widest leading-5 ${
                      turno.tipo === 'Plantão' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' : 
                      turno.tipo === 'Sobreaviso' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' : 
                      'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'
                    }`}>
                      {turno.tipo}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <Link 
                      href={`/turnos/${turno.id}`}
                      className="inline-flex items-center justify-center p-2 rounded-xl text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all border border-transparent hover:border-blue-100"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      
      {/* Tip Section */}
      <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/50 p-6 rounded-3xl flex items-start shadow-inner">
        <div className="bg-blue-600 p-2 rounded-lg text-white mr-4 shrink-0">
          <Info className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-black uppercase tracking-widest text-blue-900 dark:text-blue-400">Guia de Gestão</h4>
          <p className="text-xs font-medium text-blue-700/80 dark:text-blue-300/60 leading-relaxed">
            Turnos inativados não aparecerão mais nas opções de preenchimento de novas escalas, mas permanecerão 
            historiados nas escalas antigas para garantir a integridade dos cálculos de carga horária.
          </p>
        </div>
      </div>
    </div>
  )
}
