'use client'

import { useState, useMemo } from 'react'
import { Users, Plus, UserCircle, Building2, Search, Filter, Layers, UserX, UserCheck } from 'lucide-react'
import Link from 'next/link'

interface Servidor {
  id: string
  nome: string
  matricula: string
  cargo: string
  vinculo: string
  unidade_id: string
  setor_id: string
  status: 'Ativo' | 'Inativo'
  unidades?: { nome: string }
  setores?: { nome: string }
}

interface Unidade {
  id: string
  nome: string
}

interface Setor {
  id: string
  nome: string
  unidade_id: string
}

interface ServidoresClientProps {
  initialServidores: Servidor[]
  unidades: Unidade[]
  setores: Setor[]
}

export function ServidoresClient({ initialServidores, unidades, setores }: ServidoresClientProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedUnidade, setSelectedUnidade] = useState('')
  const [selectedSetor, setSelectedSetor] = useState('')
  const [selectedVinculo, setSelectedVinculo] = useState('')
  const [selectedStatus, setSelectedStatus] = useState<string>('Ativo')

  // Filter sectors based on selected unit
  const filteredSetoresOptions = useMemo(() => {
    if (!selectedUnidade) return setores
    return setores.filter(s => s.unidade_id === selectedUnidade)
  }, [selectedUnidade, setores])

  // Main filtering logic
  const filteredServidores = useMemo(() => {
    return initialServidores.filter(s => {
      const matchesSearch = 
        s.nome.toLowerCase().includes(searchTerm.toLowerCase()) || 
        s.matricula?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.cargo?.toLowerCase().includes(searchTerm.toLowerCase())
      
      const matchesUnidade = !selectedUnidade || s.unidade_id === selectedUnidade
      const matchesSetor = !selectedSetor || s.setor_id === selectedSetor
      const matchesVinculo = !selectedVinculo || s.vinculo === selectedVinculo
      const matchesStatus = !selectedStatus || s.status === selectedStatus

      return matchesSearch && matchesUnidade && matchesSetor && matchesVinculo && matchesStatus
    })
  }, [initialServidores, searchTerm, selectedUnidade, selectedSetor, selectedVinculo, selectedStatus])

  const vinculos = ['Contratada', 'Concursada', 'Efetiva', 'Comissionada']

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Servidores</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Gerencie o quadro de funcionários e seus vínculos.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/servidores/importar"
            className="inline-flex items-center rounded-lg bg-zinc-100 dark:bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-zinc-900 dark:text-white shadow-sm hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
          >
            Importar CSV
          </Link>
          <Link
            href="/servidores/novo"
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-all"
          >
            <Plus className="mr-2 h-4 w-4" />
            Novo Servidor
          </Link>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 bg-zinc-50 dark:bg-zinc-800/40 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Buscar por nome, matrícula..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <select
          value={selectedUnidade}
          onChange={(e) => {
            setSelectedUnidade(e.target.value)
            setSelectedSetor('') // Reset sector when unit changes
          }}
          className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">Todas as Unidades</option>
          {unidades.map(u => (
            <option key={u.id} value={u.id}>{u.nome}</option>
          ))}
        </select>

        <select
          value={selectedVinculo}
          onChange={(e) => setSelectedVinculo(e.target.value)}
          className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">Todos os Vínculos</option>
          {vinculos.map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="Ativo">Apenas Ativos</option>
          <option value="Inativo">Apenas Inativos</option>
          <option value="">Todos os Status</option>
        </select>

        <button 
          onClick={() => {
            setSearchTerm('')
            setSelectedUnidade('')
            setSelectedSetor('')
            setSelectedVinculo('')
            setSelectedStatus('Ativo')
          }}
          className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
        >
          Limpar Filtros
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Servidor</th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Matrícula</th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Cargo</th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Status</th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Vínculo</th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Unidade / Setor</th>
                <th className="relative px-6 py-4"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {filteredServidores.map((servidor) => (
                <tr key={servidor.id} className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors group ${servidor.status === 'Inativo' ? 'opacity-60 grayscale-[0.5]' : ''}`}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className={`h-9 w-9 flex-shrink-0 rounded-full flex items-center justify-center transition-colors ${
                        servidor.status === 'Inativo' 
                        ? 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800' 
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 group-hover:text-blue-600'
                      }`}>
                        <UserCircle className="h-7 w-7" />
                      </div>
                      <div className="ml-4">
                        <div className={`text-sm font-bold ${servidor.status === 'Inativo' ? 'text-zinc-500 line-through' : 'text-zinc-900 dark:text-white'}`}>
                          {servidor.nome}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-600 dark:text-zinc-400 font-medium">
                    {servidor.matricula || '---'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-600 dark:text-zinc-400">
                    {servidor.cargo || '---'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {servidor.status === 'Inativo' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-700 dark:bg-red-900/20 dark:text-red-400">
                        <UserX className="h-3 w-3" />
                        Inativo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                        <UserCheck className="h-3 w-3" />
                        Ativo
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`inline-flex rounded-md px-2.5 py-0.5 text-xs font-bold ${
                      servidor.vinculo === 'Efetiva' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800' : 
                      servidor.vinculo === 'Contratada' ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800' :
                      servidor.vinculo === 'Concursada' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800' :
                      'bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800'
                    }`}>
                      {servidor.vinculo}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-600 dark:text-zinc-400">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center">
                        <Building2 className="mr-2 h-3.5 w-3.5 opacity-50" />
                        {servidor.unidades?.nome || 'Sem Unidade'}
                      </div>
                      <div className="flex items-center font-semibold text-blue-600 dark:text-blue-400">
                        <Layers className="mr-2 h-3.5 w-3.5 opacity-50" />
                        {servidor.setores?.nome || '---'}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Link href={`/servidores/${servidor.id}`} className="inline-flex items-center text-blue-600 hover:text-blue-900 font-bold px-3 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all">
                      Gerenciar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filteredServidores.length === 0 && (
          <div className="flex flex-col items-center justify-center p-16 text-zinc-500 dark:text-zinc-400">
            <div className="h-16 w-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
              <Users className="h-8 w-8 opacity-20" />
            </div>
            <p className="font-medium">Nenhum servidor encontrado com estes filtros.</p>
            <button 
              onClick={() => {
                setSearchTerm('')
                setSelectedUnidade('')
                setSelectedSetor('')
                setSelectedVinculo('')
                setSelectedStatus('Ativo')
              }}
              className="mt-2 text-blue-600 hover:underline text-sm font-bold"
            >
              Limpar todos os filtros
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
