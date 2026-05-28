'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Plus, Tag, Loader2, Edit2, Check, X, Info, Palette } from 'lucide-react'

interface TipoEvento {
  id: string
  nome: string
  cor: string
  descricao: string | null
  ativo: boolean
}

export default function TiposEventosPage() {
  const [tipos, setTipos] = useState<TipoEvento[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  
  // Edit form states
  const [editNome, setEditNome] = useState('')
  const [editCor, setEditCor] = useState('#EF4444')
  const [editDesc, setEditDesc] = useState('')
  const [editAtivo, setEditAtivo] = useState(true)

  // New form states
  const [newData, setNewData] = useState({
    nome: '',
    cor: '#EF4444',
    descricao: '',
    ativo: true
  })
  
  const supabase = createClient()

  useEffect(() => {
    fetchTipos()
  }, [])

  async function fetchTipos() {
    try {
      const { data, error } = await supabase
        .from('tipos_eventos')
        .select('*')
        .order('nome', { ascending: true })
      
      if (error) throw error
      setTipos(data || [])
    } catch (error: any) {
      alert('Erro ao carregar tipos de afastamento: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd() {
    if (!newData.nome.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('tipos_eventos')
        .insert({
          nome: newData.nome,
          cor: newData.cor,
          descricao: newData.descricao || null,
          ativo: newData.ativo
        })
      
      if (error) throw error
      setNewData({ nome: '', cor: '#EF4444', descricao: '', ativo: true })
      fetchTipos()
    } catch (error: any) {
      alert('Erro ao adicionar tipo de afastamento: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(id: string) {
    if (!editNome.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('tipos_eventos')
        .update({
          nome: editNome,
          cor: editCor,
          descricao: editDesc || null,
          ativo: editAtivo
        })
        .eq('id', id)
      
      if (error) throw error
      setEditingId(null)
      fetchTipos()
    } catch (error: any) {
      alert('Erro ao atualizar tipo de afastamento: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  const startEditing = (t: TipoEvento) => {
    setEditingId(t.id)
    setEditNome(t.nome)
    setEditCor(t.cor)
    setEditDesc(t.descricao || '')
    setEditAtivo(t.ativo)
  }

  const colorPresets = [
    '#EF4444', // Red (Atestados)
    '#22C55E', // Green (Férias)
    '#3B82F6', // Blue (Licenças)
    '#A855F7', // Purple (Maternidade)
    '#EAB308', // Yellow (Licença Prêmio)
    '#F97316', // Orange
    '#06B6D4', // Cyan
    '#EC4899', // Pink
    '#71717A'  // Gray (Outros)
  ]

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Tipos de Afastamento</h1>
        <p className="mt-1 text-zinc-500 text-sm italic">Parametrização das justificativas de afastamento e suas respectivas cores de destaque.</p>
      </div>

      {/* Warning Banner */}
      <div className="bg-blue-50 border border-blue-200 dark:bg-blue-900/10 dark:border-blue-800 p-4 rounded-2xl flex gap-3">
        <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
        <p className="text-xs text-blue-700 dark:text-blue-300">
          <strong>Gestão de Governança:</strong> As cores cadastradas aqui serão exibidas na grade de escala para identificar os dias de afastamento do servidor. Escolha cores harmoniosas para facilitar a leitura visual da escala.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form */}
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm h-fit">
          <h2 className="text-sm font-black uppercase tracking-widest mb-6 flex items-center text-blue-600">
            <Plus className="mr-2 h-5 w-5" /> Novo Tipo
          </h2>
          <div className="space-y-5">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Nome do Afastamento</label>
              <input
                type="text"
                placeholder="Ex: Férias Regulamentares"
                value={newData.nome}
                onChange={e => setNewData({ ...newData, nome: e.target.value })}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm"
              />
            </div>
            
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Cor de Destaque no Calendário</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={newData.cor}
                  onChange={e => setNewData({ ...newData, cor: e.target.value })}
                  className="w-12 h-12 rounded-xl border border-zinc-200 dark:border-zinc-700 cursor-pointer overflow-hidden p-0 bg-transparent"
                />
                <div className="flex-1 grid grid-cols-5 gap-1.5 bg-zinc-50 dark:bg-zinc-800 p-2 rounded-xl border border-zinc-200 dark:border-zinc-700">
                  {colorPresets.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewData({ ...newData, cor: color })}
                      className="w-6 h-6 rounded-full border border-white dark:border-zinc-900 transition-transform hover:scale-110 active:scale-95 shadow-sm"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Descrição</label>
              <textarea
                placeholder="Ex: Afastamento anual remunerado garantido por lei."
                value={newData.descricao}
                onChange={e => setNewData({ ...newData, descricao: e.target.value })}
                rows={3}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm resize-none"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Status</label>
              <select
                value={newData.ativo ? 'true' : 'false'}
                onChange={e => setNewData({ ...newData, ativo: e.target.value === 'true' })}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm"
              >
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </select>
            </div>

            <button
              onClick={handleAdd}
              disabled={saving || !newData.nome.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest py-3 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 shadow-lg shadow-blue-600/20"
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Cadastrar Tipo'}
            </button>
          </div>
        </div>

        {/* List */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden h-fit">
          <table className="w-full text-left border-collapse">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 w-44">Nome</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 w-24">Cor</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Descrição</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 w-24">Status</th>
                <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 w-28">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center">
                    <Loader2 className="h-10 w-10 animate-spin mx-auto text-blue-500 opacity-50" />
                  </td>
                </tr>
              ) : tipos.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center">
                    <Tag className="h-12 w-12 mx-auto text-zinc-200 dark:text-zinc-800 mb-4" />
                    <p className="text-zinc-400 font-bold uppercase text-xs tracking-widest">Nenhum tipo cadastrado</p>
                  </td>
                </tr>
              ) : (
                tipos.map(t => (
                  <tr key={t.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      {editingId === t.id ? (
                        <input
                          type="text"
                          value={editNome}
                          onChange={e => setEditNome(e.target.value)}
                          className="w-full bg-zinc-100 dark:bg-zinc-800 border border-blue-300 dark:border-blue-700 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-blue-500 font-semibold text-sm text-zinc-900 dark:text-white"
                          autoFocus
                        />
                      ) : (
                        <div className="flex items-center font-black text-zinc-900 dark:text-white uppercase tracking-tighter text-sm">
                          <Tag className="mr-2 h-4 w-4 text-blue-500 shrink-0" />
                          {t.nome}
                        </div>
                      )}
                    </td>
                    
                    <td className="px-6 py-4 whitespace-nowrap">
                      {editingId === t.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={editCor}
                            onChange={e => setEditCor(e.target.value)}
                            className="w-8 h-8 rounded-lg cursor-pointer p-0 bg-transparent"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div
                            className="w-6 h-6 rounded-full border border-zinc-200 dark:border-zinc-700 shadow-sm"
                            style={{ backgroundColor: t.cor }}
                          />
                          <span className="text-[10px] font-mono text-zinc-400 uppercase">{t.cor}</span>
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      {editingId === t.id ? (
                        <textarea
                          value={editDesc}
                          onChange={e => setEditDesc(e.target.value)}
                          rows={2}
                          className="w-full bg-zinc-100 dark:bg-zinc-800 border border-blue-300 dark:border-blue-700 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-500 font-medium text-xs resize-none"
                        />
                      ) : (
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 block max-w-sm truncate" title={t.descricao || ''}>
                          {t.descricao || <span className="italic text-zinc-400">Sem descrição</span>}
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      {editingId === t.id ? (
                        <select
                          value={editAtivo ? 'true' : 'false'}
                          onChange={e => setEditAtivo(e.target.value === 'true')}
                          className="bg-zinc-100 dark:bg-zinc-800 border border-blue-300 dark:border-blue-700 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                        >
                          <option value="true">Ativo</option>
                          <option value="false">Inativo</option>
                        </select>
                      ) : (
                        <span className={`inline-flex px-2 py-0.5 text-[9px] font-black uppercase rounded-full ${
                          t.ativo 
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-600' 
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                        }`}>
                          {t.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-center whitespace-nowrap">
                      <div className="flex justify-center items-center gap-2">
                        {editingId === t.id ? (
                          <>
                            <button
                              onClick={() => handleUpdate(t.id)}
                              disabled={saving}
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-all"
                              title="Salvar"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                              title="Cancelar"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => startEditing(t)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all"
                            title="Editar"
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
