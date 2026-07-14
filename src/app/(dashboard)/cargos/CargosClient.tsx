'use client'

import { useState, useMemo, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Briefcase, Plus, Loader2, Search, ChevronRight, Layers, EyeOff, Eye, Pencil, Check, X } from 'lucide-react'

interface Cargo {
  id: string
  nome: string
  parent_id: string | null
  nivel: number
  ativo: boolean
  codigo?: string | null
}

interface CargosClientProps {
  initialCargos: Cargo[]
}

export function CargosClient({ initialCargos }: CargosClientProps) {
  const supabase = createClient()
  const [cargos, setCargos] = useState(initialCargos)
  const [newCargo, setNewCargo] = useState('')
  const [newCodigo, setNewCodigo] = useState('')
  const [selectedParent, setSelectedParent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  
  // Estados para edição
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editCodigo, setEditCodigo] = useState('')

  // Estados para paginação
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, cargos])

  const handleAddCargo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCargo.trim()) return

    setLoading(true)
    try {
      const parent = cargos.find(c => c.id === selectedParent)
      const nivel = parent ? parent.nivel + 1 : 1

      const { data, error } = await supabase
        .from('cargos')
        .insert({ 
          nome: newCargo.trim(),
          parent_id: selectedParent || null,
          nivel,
          ativo: true,
          codigo: newCodigo.trim() || null
        })
        .select()
        .single()

      if (error) throw error

      setCargos(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)))
      setNewCargo('')
      setNewCodigo('')
      setSelectedParent('')
    } catch (error: any) {
      alert('Erro ao cadastrar cargo: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleToggleCargoStatus = async (id: string, currentStatus: boolean) => {
    const action = currentStatus ? 'desativar' : 'ativar'
    if (!confirm(`Tem certeza que deseja ${action} este cargo?`)) return

    setLoading(true)
    try {
      const { error } = await supabase
        .from('cargos')
        .update({ ativo: !currentStatus })
        .eq('id', id)

      if (error) throw error

      setCargos(prev => prev.map(c => c.id === id ? { ...c, ativo: !currentStatus } : c))
    } catch (error: any) {
      alert(`Erro ao ${action} cargo: ` + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateCargo = async (id: string) => {
    if (!editValue.trim()) return
    setLoading(true)
    try {
      const { error } = await supabase
        .from('cargos')
        .update({ 
          nome: editValue.trim(),
          codigo: editCodigo.trim() || null
        })
        .eq('id', id)

      if (error) throw error

      setCargos(prev => prev.map(c => c.id === id ? { ...c, nome: editValue.trim(), codigo: editCodigo.trim() || null } : c))
      setEditingId(null)
    } catch (error: any) {
      alert('Erro ao atualizar cargo: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const startEditing = (cargo: Cargo) => {
    setEditingId(cargo.id)
    setEditValue(cargo.nome)
    setEditCodigo(cargo.codigo || '')
  }

  // Organizar cargos hierarquicamente para a lista
  const organizedCargos = useMemo(() => {
    const root = cargos.filter(c => !c.parent_id)
    const result: Cargo[] = []

    const addChildren = (parentId: string, level: number) => {
      const children = cargos.filter(c => c.parent_id === parentId)
      children.forEach(child => {
        result.push(child)
        if (level < 3) addChildren(child.id, level + 1)
      })
    }

    root.forEach(r => {
      result.push(r)
      addChildren(r.id, 1)
    })

    return result
  }, [cargos])

  const filteredCargos = organizedCargos.filter(c => 
    c.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.codigo && c.codigo.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  const parentOptions = cargos.filter(c => c.nivel < 3 && c.ativo)

  // Cálculos de Paginação
  const totalItems = filteredCargos.length
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  
  const paginatedCargos = useMemo(() => {
    return filteredCargos.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
  }, [filteredCargos, currentPage, itemsPerPage])

  const getPageNumbers = () => {
    const range = 2
    const pages: number[] = []
    for (let i = Math.max(1, currentPage - range); i <= Math.min(totalPages, currentPage + range); i++) {
      pages.push(i)
    }
    return pages
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white flex items-center gap-3">
          <Briefcase className="h-8 w-8 text-blue-500" />
          Gestão de Cargos
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Hierarquia de até 3 níveis com códigos contábeis. Edite nomes ou desative categorias conforme necessário.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Formulário de Cadastro */}
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm h-fit">
          <h2 className="text-lg font-semibold mb-4 text-zinc-900 dark:text-white">Novo Cargo</h2>
          <form onSubmit={handleAddCargo} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Cargo Pai (Opcional)</label>
              <select
                value={selectedParent}
                onChange={(e) => setSelectedParent(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">Nível Principal (Raiz)</option>
                {parentOptions.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nivel === 2 ? '-- ' : ''}{c.nome}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Código do Cargo</label>
              <input
                type="text"
                value={newCodigo}
                onChange={(e) => setNewCodigo(e.target.value)}
                placeholder="Ex: 0001"
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Nome do Cargo</label>
              <input
                type="text"
                value={newCargo}
                onChange={(e) => setNewCargo(e.target.value)}
                placeholder="Ex: Cirurgião"
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !newCargo.trim()}
              className="w-full inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Cadastrar Cargo
            </button>
          </form>
        </div>

        {/* Lista de Cargos */}
        <div className="lg:col-span-2 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar cargos por nome ou código..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
            />
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 text-zinc-500 dark:text-zinc-400 text-xs font-black uppercase tracking-wider">
                    <th className="p-4 w-32">Código</th>
                    <th className="p-4">Cargo / Nome</th>
                    <th className="p-4 w-28 text-center">Nível</th>
                    <th className="p-4 w-28 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {paginatedCargos.map((cargo) => (
                    <tr 
                      key={cargo.id} 
                      className={`transition-colors ${
                        cargo.ativo 
                          ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50' 
                          : 'bg-zinc-50/50 dark:bg-zinc-900/50 opacity-60'
                      }`}
                    >
                      {/* Código Column */}
                      <td className="p-4">
                        {cargo.codigo ? (
                          <span className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded text-zinc-600 dark:text-zinc-400 font-semibold border border-zinc-200/50 dark:border-zinc-700/50">
                            {cargo.codigo}
                          </span>
                        ) : (
                          <span className="text-zinc-300 dark:text-zinc-700 italic text-xs">-</span>
                        )}
                      </td>

                      {/* Cargo / Nome Column */}
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {cargo.nivel === 1 && <Briefcase className={`h-4 w-4 shrink-0 ${cargo.ativo ? 'text-blue-500' : 'text-zinc-400'}`} />}
                          {cargo.nivel === 2 && <div className="ml-4 flex items-center gap-1 text-zinc-400 shrink-0"><ChevronRight className="h-3 w-3" /><Layers className="h-4 w-4" /></div>}
                          {cargo.nivel === 3 && <div className="ml-10 flex items-center gap-1 text-zinc-300 shrink-0"><ChevronRight className="h-3 w-3" /><div className={`h-2 w-2 rounded-full ${cargo.ativo ? 'bg-zinc-400' : 'bg-zinc-300'}`} /></div>}
                          
                          {editingId === cargo.id ? (
                            <div className="flex flex-col gap-2 flex-1 max-w-sm">
                              <input
                                autoFocus
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                placeholder="Nome do cargo"
                                className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-blue-500 rounded text-sm outline-none"
                              />
                              <input
                                type="text"
                                value={editCodigo}
                                onChange={(e) => setEditCodigo(e.target.value)}
                                placeholder="Código do cargo"
                                className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-sm outline-none"
                              />
                              <div className="flex gap-2 justify-end">
                                <button onClick={() => handleUpdateCargo(cargo.id)} className="text-emerald-500 p-1 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded flex items-center gap-1 text-xs font-semibold">
                                  <Check className="h-4 w-4" /> Salvar
                                </button>
                                <button onClick={() => setEditingId(null)} className="text-red-500 p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded flex items-center gap-1 text-xs font-semibold">
                                  <X className="h-4 w-4" /> Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span className={`text-sm font-medium truncate ${cargo.ativo ? (cargo.nivel === 1 ? 'text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400') : 'text-zinc-400 italic line-through'}`}>
                              {cargo.nome}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Nível Column */}
                      <td className="p-4 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          cargo.nivel === 1 
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' 
                            : cargo.nivel === 2 
                              ? 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400' 
                              : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}>
                          Nível {cargo.nivel}
                        </span>
                      </td>

                      {/* Ações Column */}
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!editingId && (
                            <>
                              <button
                                onClick={() => startEditing(cargo)}
                                className="p-2 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                title="Editar Nome e Código"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleToggleCargoStatus(cargo.id, cargo.ativo)}
                                className={`p-2 transition-colors rounded-lg ${cargo.ativo ? 'text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20' : 'text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'}`}
                                title={cargo.ativo ? 'Desativar' : 'Ativar'}
                              >
                                {cargo.ativo ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paginatedCargos.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-zinc-500 dark:text-zinc-400 text-sm">
                        Nenhum cargo encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between border-t border-zinc-200 dark:border-zinc-800 px-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/50 gap-4">
                <div className="text-xs font-black uppercase tracking-wider text-zinc-400">
                  Mostrando <span className="font-extrabold text-zinc-900 dark:text-white">{(currentPage - 1) * itemsPerPage + 1}</span> a <span className="font-extrabold text-zinc-900 dark:text-white">{Math.min(totalItems, currentPage * itemsPerPage)}</span> de <span className="font-extrabold text-zinc-900 dark:text-white">{totalItems}</span> cargos
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold text-xs uppercase tracking-wider transition-all hover:bg-zinc-50 dark:hover:bg-zinc-700/50 disabled:opacity-50 active:scale-95 cursor-pointer"
                  >
                    Anterior
                  </button>
                  <div className="flex items-center gap-1">
                    {getPageNumbers().map(page => (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`w-8 h-8 rounded-xl font-black text-xs transition-all active:scale-95 cursor-pointer ${
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
                    className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold text-xs uppercase tracking-wider transition-all hover:bg-zinc-50 dark:hover:bg-zinc-700/50 disabled:opacity-50 active:scale-95 cursor-pointer"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
