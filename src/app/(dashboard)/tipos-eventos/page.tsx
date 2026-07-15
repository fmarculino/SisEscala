'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { AcessoNegado } from '@/components/AcessoNegado'
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
  const [userRole, setUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  
  // Form state (used for both creation and editing)
  const [formData, setFormData] = useState({
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
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()
        
        const role = profile?.role || 'servidor'
        setUserRole(role)
        
        if (role === 'super_admin') {
          const { data, error } = await supabase
            .from('tipos_eventos')
            .select('*')
            .order('nome', { ascending: true })
          
          if (error) throw error
          setTipos(data || [])
        }
      }
    } catch (error: any) {
      alert('Erro ao carregar tipos de afastamento: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd() {
    if (!formData.nome.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('tipos_eventos')
        .insert({
          nome: formData.nome,
          cor: formData.cor,
          descricao: formData.descricao || null,
          ativo: formData.ativo
        })
      
      if (error) throw error
      setFormData({ nome: '', cor: '#EF4444', descricao: '', ativo: true })
      fetchTipos()
    } catch (error: any) {
      alert('Erro ao adicionar tipo de afastamento: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(id: string) {
    if (!formData.nome.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('tipos_eventos')
        .update({
          nome: formData.nome,
          cor: formData.cor,
          descricao: formData.descricao || null,
          ativo: formData.ativo
        })
        .eq('id', id)
      
      if (error) throw error
      setEditingId(null)
      setFormData({ nome: '', cor: '#EF4444', descricao: '', ativo: true })
      fetchTipos()
    } catch (error: any) {
      alert('Erro ao atualizar tipo de afastamento: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleStatus(t: TipoEvento) {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('tipos_eventos')
        .update({ ativo: !t.ativo })
        .eq('id', t.id)
      
      if (error) throw error
      fetchTipos()
      
      if (editingId === t.id) {
        setFormData(prev => ({ ...prev, ativo: !t.ativo }))
      }
    } catch (error: any) {
      alert('Erro ao alterar status: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  const startEditing = (t: TipoEvento) => {
    setEditingId(t.id)
    setFormData({
      nome: t.nome,
      cor: t.cor,
      descricao: t.descricao || '',
      ativo: t.ativo
    })
  }

  const cancelEditing = () => {
    setEditingId(null)
    setFormData({
      nome: '',
      cor: '#EF4444',
      descricao: '',
      ativo: true
    })
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

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (userRole !== 'super_admin') {
    return <AcessoNegado />
  }

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
            {editingId ? (
              <>
                <Edit2 className="mr-2 h-5 w-5" /> Editar Tipo
              </>
            ) : (
              <>
                <Plus className="mr-2 h-5 w-5" /> Novo Tipo
              </>
            )}
          </h2>
          <div className="space-y-5">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Nome do Afastamento</label>
              <input
                type="text"
                placeholder="Ex: Férias Regulamentares"
                value={formData.nome}
                onChange={e => setFormData({ ...formData, nome: e.target.value })}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm"
              />
            </div>
            
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Cor de Destaque no Calendário</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={formData.cor}
                  onChange={e => setFormData({ ...formData, cor: e.target.value })}
                  className="w-12 h-12 rounded-xl border border-zinc-200 dark:border-zinc-700 cursor-pointer overflow-hidden p-0 bg-transparent"
                />
                <div className="flex-1 grid grid-cols-5 gap-1.5 bg-zinc-50 dark:bg-zinc-800 p-2 rounded-xl border border-zinc-200 dark:border-zinc-700">
                  {colorPresets.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setFormData({ ...formData, cor: color })}
                      className="w-6 h-6 rounded-full border border-white dark:border-zinc-900 transition-transform hover:scale-110 active:scale-95 shadow-sm cursor-pointer"
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
                value={formData.descricao}
                onChange={e => setFormData({ ...formData, descricao: e.target.value })}
                rows={3}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm resize-none"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Status</label>
              <select
                value={formData.ativo ? 'true' : 'false'}
                onChange={e => setFormData({ ...formData, ativo: e.target.value === 'true' })}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm"
              >
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </select>
            </div>

            {editingId ? (
              <div className="flex gap-2">
                <button
                  onClick={() => handleUpdate(editingId)}
                  disabled={saving || !formData.nome.trim()}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest py-3 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 shadow-lg shadow-emerald-600/20 cursor-pointer"
                >
                  {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Salvar'}
                </button>
                <button
                  onClick={cancelEditing}
                  disabled={saving}
                  className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-black uppercase tracking-widest px-4 py-3 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={handleAdd}
                disabled={saving || !formData.nome.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest py-3 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 shadow-lg shadow-blue-600/20 cursor-pointer"
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Cadastrar Tipo'}
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden h-fit">
          <div className="overflow-x-auto">
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
                    <tr 
                      key={t.id} 
                      className={`transition-colors ${
                        editingId === t.id 
                          ? 'bg-blue-50/50 dark:bg-blue-950/20 border-l-4 border-l-blue-500' 
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
                      }`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center font-black text-zinc-900 dark:text-white uppercase tracking-tighter text-sm">
                          <Tag className="mr-2 h-4 w-4 text-blue-500 shrink-0" />
                          {t.nome}
                        </div>
                      </td>
                      
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-6 h-6 rounded-full border border-zinc-200 dark:border-zinc-700 shadow-sm"
                            style={{ backgroundColor: t.cor }}
                          />
                          <span className="text-[10px] font-mono text-zinc-400 uppercase">{t.cor}</span>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 block max-w-sm truncate" title={t.descricao || ''}>
                          {t.descricao || <span className="italic text-zinc-400">Sem descrição</span>}
                        </span>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleToggleStatus(t)}
                          disabled={saving}
                          className={`inline-flex items-center px-2.5 py-1 text-[10px] font-black uppercase rounded-full cursor-pointer transition-all hover:scale-105 active:scale-95 disabled:opacity-50 ${
                            t.ativo 
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-600 border border-green-200 dark:border-green-800' 
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border border-zinc-200 dark:border-zinc-700'
                          }`}
                          title={t.ativo ? "Clique para inativar" : "Clique para ativar"}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${t.ativo ? 'bg-green-500' : 'bg-zinc-400'}`} />
                          {t.ativo ? 'Ativo' : 'Inativo'}
                        </button>
                      </td>

                      <td className="px-6 py-4 text-center whitespace-nowrap">
                        <div className="flex justify-center items-center gap-2">
                          {editingId === t.id ? (
                            <span className="text-[10px] font-black uppercase text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded-md">
                              Editando
                            </span>
                          ) : (
                            <button
                              onClick={() => startEditing(t)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all cursor-pointer"
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
    </div>
  )
}
