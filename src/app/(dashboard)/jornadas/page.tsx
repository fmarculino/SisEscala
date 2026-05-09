'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Plus, Clock, Loader2, Edit2, Check, X, Power, PowerOff } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'

interface Jornada {
  id: string
  nome: string
  ativo: boolean
}

export default function JornadasPage() {
  const [jornadas, setJornadas] = useState<Jornada[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNome, setEditNome] = useState('')
  const [newNome, setNewNome] = useState('')
  
  const supabase = createClient()

  const [alertModal, setAlertModal] = useState<{ isOpen: boolean, title: string, message: string, type: 'default' | 'danger' | 'success' | 'warning' }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'default'
  })

  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean, title: string, message: string, onConfirm: () => void }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  })

  useEffect(() => {
    fetchJornadas()
  }, [])

  async function fetchJornadas() {
    try {
      const { data, error } = await supabase
        .from('jornadas')
        .select('*')
        .order('ativo', { ascending: false })
        .order('nome', { ascending: true })
      
      if (error) throw error
      setJornadas(data || [])
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro ao Carregar',
        message: 'Não foi possível carregar as jornadas: ' + error.message,
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd() {
    if (!newNome.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('jornadas')
        .insert({ nome: newNome.trim().toUpperCase() })
      
      if (error) throw error
      setNewNome('')
      fetchJornadas()
      setAlertModal({
        isOpen: true,
        title: 'Sucesso',
        message: 'Jornada cadastrada com sucesso!',
        type: 'success'
      })
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro no Cadastro',
        message: 'Não foi possível cadastrar a jornada: ' + error.message,
        type: 'danger'
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(id: string) {
    if (!editNome.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('jornadas')
        .update({ nome: editNome.trim().toUpperCase() })
        .eq('id', id)
      
      if (error) throw error
      setEditingId(null)
      fetchJornadas()
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro na Atualização',
        message: 'Não foi possível atualizar a jornada: ' + error.message,
        type: 'danger'
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleAtivo(id: string, currentStatus: boolean) {
    const action = currentStatus ? 'inativar' : 'ativar'
    
    setConfirmModal({
      isOpen: true,
      title: 'Confirmar Alteração',
      message: `Deseja realmente ${action} esta jornada? Ela deixará de aparecer nas novas seleções.`,
      onConfirm: async () => {
        setSaving(true)
        try {
          const { error } = await supabase
            .from('jornadas')
            .update({ ativo: !currentStatus })
            .eq('id', id)
          
          if (error) throw error
          fetchJornadas()
        } catch (error: any) {
          setAlertModal({
            isOpen: true,
            title: 'Erro',
            message: `Erro ao ${action} jornada: ` + error.message,
            type: 'danger'
          })
        } finally {
          setSaving(false)
          setConfirmModal(prev => ({ ...prev, isOpen: false }))
        }
      }
    })
  }

  const startEditing = (j: Jornada) => {
    setEditingId(j.id)
    setEditNome(j.nome)
  }

  return (
    <div className="space-y-8">
      {/* Modais */}
      <Modal
        isOpen={alertModal.isOpen}
        onClose={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
        title={alertModal.title}
        type={alertModal.type as any}
        footer={
          <button
            onClick={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
            className="w-full px-4 py-2 rounded-xl bg-zinc-900 dark:bg-white dark:text-zinc-900 text-white font-black uppercase tracking-widest text-[10px]"
          >
            Entendido
          </button>
        }
      >
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{alertModal.message}</p>
      </Modal>

      <Modal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        title={confirmModal.title}
        type="warning"
        footer={
          <div className="flex gap-3 w-full">
            <button
              onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
              className="flex-1 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-black uppercase tracking-widest text-[10px]"
            >
              Cancelar
            </button>
            <button
              onClick={confirmModal.onConfirm}
              disabled={saving}
              className="flex-1 px-4 py-2 rounded-xl bg-blue-600 text-white font-black uppercase tracking-widest text-[10px] hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : 'Confirmar'}
            </button>
          </div>
        }
      >
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{confirmModal.message}</p>
      </Modal>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Jornadas de Trabalho</h1>
        <p className="mt-1 text-zinc-500 text-sm italic">Gerencie os horários de trabalho. Jornadas inativas não aparecerão na escala regular.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Form */}
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm h-fit">
          <h2 className="text-sm font-black uppercase tracking-widest mb-6 flex items-center text-blue-600">
            <Plus className="mr-2 h-5 w-5" /> Nova Jornada
          </h2>
          <div className="space-y-5">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Descrição do Horário</label>
              <input
                type="text"
                placeholder="Ex: 08H ÀS 18H"
                value={newNome}
                onChange={e => setNewNome(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={saving || !newNome.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest py-3 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 shadow-lg shadow-blue-600/20"
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Cadastrar Jornada'}
            </button>
          </div>
        </div>

        {/* List */}
        <div className="md:col-span-2 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Jornada</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Status</th>
                <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 w-32">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-20 text-center">
                    <Loader2 className="h-10 w-10 animate-spin mx-auto text-blue-500 opacity-50" />
                  </td>
                </tr>
              ) : jornadas.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-20 text-center">
                    <Clock className="h-12 w-12 mx-auto text-zinc-200 dark:text-zinc-800 mb-4" />
                    <p className="text-zinc-400 font-bold uppercase text-xs tracking-widest">Nenhuma jornada cadastrada</p>
                  </td>
                </tr>
              ) : (
                jornadas.map(j => (
                  <tr key={j.id} className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors ${!j.ativo ? 'opacity-50' : ''}`}>
                    <td className="px-6 py-4">
                      {editingId === j.id ? (
                        <input
                          type="text"
                          value={editNome}
                          onChange={e => setEditNome(e.target.value)}
                          className="w-full bg-zinc-100 dark:bg-zinc-800 border border-blue-300 dark:border-blue-700 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 font-bold text-zinc-900 dark:text-white uppercase"
                          autoFocus
                        />
                      ) : (
                        <div className="flex items-center font-black text-zinc-900 dark:text-white uppercase tracking-tighter text-lg">
                          <Clock className={`mr-3 h-5 w-5 ${j.ativo ? 'text-blue-500' : 'text-zinc-400'}`} />
                          {j.nome}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest ${j.ativo ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                        {j.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex justify-center items-center gap-3">
                        {editingId === j.id ? (
                          <>
                            <button
                              onClick={() => handleUpdate(j.id)}
                              disabled={saving}
                              className="p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-all"
                              title="Salvar"
                            >
                              <Check className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                              title="Cancelar"
                            >
                              <X className="h-5 w-5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEditing(j)}
                              className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all"
                              title="Editar"
                            >
                              <Edit2 className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => handleToggleAtivo(j.id, j.ativo)}
                              className={`p-2 rounded-lg transition-all ${j.ativo ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20' : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'}`}
                              title={j.ativo ? 'Inativar' : 'Ativar'}
                            >
                              {j.ativo ? <PowerOff className="h-5 w-5" /> : <Power className="h-5 w-5" />}
                            </button>
                          </>
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
