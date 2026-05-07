'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Plus, Calendar as CalendarIcon, Loader2, Edit2, Check, X, Info } from 'lucide-react'

interface Feriado {
  id: string
  data: string
  descricao: string
}

export default function FeriadosPage() {
  const [feriados, setFeriados] = useState<Feriado[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const [newData, setNewData] = useState({ data: '', descricao: '' })
  
  const supabase = createClient()

  useEffect(() => {
    fetchFeriados()
  }, [])

  async function fetchFeriados() {
    try {
      const { data, error } = await supabase
        .from('feriados')
        .select('*')
        .order('data', { ascending: true })
      
      if (error) throw error
      setFeriados(data || [])
    } catch (error: any) {
      alert('Erro ao carregar feriados: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd() {
    if (!newData.data || !newData.descricao) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('feriados')
        .insert(newData)
      
      if (error) throw error
      setNewData({ data: '', descricao: '' })
      fetchFeriados()
    } catch (error: any) {
      alert('Erro ao adicionar feriado: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(id: string) {
    if (!editDesc.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('feriados')
        .update({ descricao: editDesc })
        .eq('id', id)
      
      if (error) throw error
      setEditingId(null)
      fetchFeriados()
    } catch (error: any) {
      alert('Erro ao atualizar feriado: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  const startEditing = (f: Feriado) => {
    setEditingId(f.id)
    setEditDesc(f.descricao)
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Gestão de Feriados</h1>
        <p className="mt-1 text-zinc-500 text-sm italic">Configuração de datas especiais para cálculos de HE 100%.</p>
      </div>

      {/* Warning Banner */}
      <div className="bg-amber-50 border border-amber-200 dark:bg-amber-900/10 dark:border-amber-800 p-4 rounded-2xl flex gap-3">
        <Info className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
        <p className="text-xs text-amber-700 dark:text-amber-300">
          <strong>Atenção:</strong> Por motivos de integridade dos cálculos de escalas passadas, feriados <strong>não podem ser excluídos</strong>. 
          Você pode corrigir a descrição, mas a data é imutável após o cadastro.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Form */}
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm h-fit">
          <h2 className="text-sm font-black uppercase tracking-widest mb-6 flex items-center text-blue-600">
            <Plus className="mr-2 h-5 w-5" /> Novo Feriado
          </h2>
          <div className="space-y-5">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Data do Evento</label>
              <input
                type="date"
                value={newData.data}
                onChange={e => setNewData({ ...newData, data: e.target.value })}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Descrição / Nome</label>
              <input
                type="text"
                placeholder="Ex: Confraternização Universal"
                value={newData.descricao}
                onChange={e => setNewData({ ...newData, descricao: e.target.value })}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={saving || !newData.data || !newData.descricao}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest py-3 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 shadow-lg shadow-blue-600/20"
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Cadastrar Feriado'}
            </button>
          </div>
        </div>

        {/* List */}
        <div className="md:col-span-2 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Data</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Descrição</th>
                <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 w-24">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-20 text-center">
                    <Loader2 className="h-10 w-10 animate-spin mx-auto text-blue-500 opacity-50" />
                  </td>
                </tr>
              ) : feriados.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-20 text-center">
                    <CalendarIcon className="h-12 w-12 mx-auto text-zinc-200 dark:text-zinc-800 mb-4" />
                    <p className="text-zinc-400 font-bold uppercase text-xs tracking-widest">Nenhum feriado cadastrado</p>
                  </td>
                </tr>
              ) : (
                feriados.map(f => (
                  <tr key={f.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center font-black text-zinc-900 dark:text-white uppercase tracking-tighter">
                        <CalendarIcon className="mr-2 h-4 w-4 text-blue-500" />
                        {new Date(f.data + 'T00:00:00').toLocaleDateString('pt-BR')}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {editingId === f.id ? (
                        <input
                          type="text"
                          value={editDesc}
                          onChange={e => setEditDesc(e.target.value)}
                          className="w-full bg-zinc-100 dark:bg-zinc-800 border border-blue-300 dark:border-blue-700 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                          autoFocus
                        />
                      ) : (
                        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{f.descricao}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex justify-center items-center gap-2">
                        {editingId === f.id ? (
                          <>
                            <button
                              onClick={() => handleUpdate(f.id)}
                              disabled={saving}
                              className="p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-all"
                              title="Salvar"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                              title="Cancelar"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => startEditing(f)}
                            className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all"
                            title="Editar descrição"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
