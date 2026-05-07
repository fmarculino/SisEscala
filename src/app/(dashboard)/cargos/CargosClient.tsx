'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Briefcase, Plus, Loader2, Search, ChevronRight, Layers, EyeOff, Eye, Pencil, Check, X } from 'lucide-react'

interface Cargo {
  id: string
  nome: string
  parent_id: string | null
  nivel: number
  ativo: boolean
}

interface CargosClientProps {
  initialCargos: Cargo[]
}

export function CargosClient({ initialCargos }: CargosClientProps) {
  const supabase = createClient()
  const [cargos, setCargos] = useState(initialCargos)
  const [newCargo, setNewCargo] = useState('')
  const [selectedParent, setSelectedParent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  
  // Estados para edição
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

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
          ativo: true
        })
        .select()
        .single()

      if (error) throw error

      setCargos(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)))
      setNewCargo('')
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
        .update({ nome: editValue.trim() })
        .eq('id', id)

      if (error) throw error

      setCargos(prev => prev.map(c => c.id === id ? { ...c, nome: editValue.trim() } : c))
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
    c.nome.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const parentOptions = cargos.filter(c => c.nivel < 3 && c.ativo)

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white flex items-center gap-3">
          <Briefcase className="h-8 w-8 text-blue-500" />
          Gestão de Cargos
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Hierarquia de até 3 níveis. Edite nomes ou desative categorias conforme necessário.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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
        <div className="md:col-span-2 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar cargos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
            />
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {filteredCargos.map((cargo) => (
                <li key={cargo.id} className={`flex items-center justify-between p-4 transition-colors ${cargo.ativo ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50' : 'bg-zinc-50/50 dark:bg-zinc-900/50 opacity-60'}`}>
                  <div className="flex items-center gap-2 flex-1">
                    {cargo.nivel === 1 && <Briefcase className={`h-4 w-4 shrink-0 ${cargo.ativo ? 'text-blue-500' : 'text-zinc-400'}`} />}
                    {cargo.nivel === 2 && <div className="ml-4 flex items-center gap-1 text-zinc-400 shrink-0"><ChevronRight className="h-3 w-3" /><Layers className="h-4 w-4" /></div>}
                    {cargo.nivel === 3 && <div className="ml-10 flex items-center gap-1 text-zinc-300 shrink-0"><ChevronRight className="h-3 w-3" /><div className={`h-2 w-2 rounded-full ${cargo.ativo ? 'bg-zinc-400' : 'bg-zinc-300'}`} /></div>}
                    
                    {editingId === cargo.id ? (
                      <div className="flex items-center gap-2 flex-1 max-w-sm">
                        <input
                          autoFocus
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleUpdateCargo(cargo.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          className="flex-1 px-2 py-1 bg-white dark:bg-zinc-800 border border-blue-500 rounded text-sm outline-none"
                        />
                        <button onClick={() => handleUpdateCargo(cargo.id)} className="text-emerald-500 p-1 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded"><Check className="h-4 w-4" /></button>
                        <button onClick={() => setEditingId(null)} className="text-red-500 p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <span className={`text-sm font-medium truncate ${cargo.ativo ? (cargo.nivel === 1 ? 'text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400') : 'text-zinc-400 italic line-through'}`}>
                        {cargo.nome}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {!editingId && (
                      <>
                        <button
                          onClick={() => startEditing(cargo)}
                          className="p-2 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                          title="Editar Nome"
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
                </li>
              ))}
              {filteredCargos.length === 0 && (
                <li className="p-8 text-center text-zinc-500 dark:text-zinc-400 text-sm">
                  Nenhum cargo encontrado.
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
