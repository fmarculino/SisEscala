'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Plus, Clock, Loader2, Edit2, Check, X, Power, PowerOff, Edit3 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'

interface Jornada {
  id: string
  nome: string
  ativo: boolean
  intervalo_minutos: number
  horas_totais: number
  intervalo_inicio_padrao?: string | null
  intervalo_fim_padrao?: string | null
}

export default function JornadasPage() {
  const [jornadas, setJornadas] = useState<Jornada[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Unified form state for left side panel (Creation or Edit)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formNome, setFormNome] = useState('')
  const [formHorasTotais, setFormHorasTotais] = useState<number>(0)
  const [formIntervalo, setFormIntervalo] = useState<number>(0)
  const [formIntervaloInicio, setFormIntervaloInicio] = useState<string>('')
  const [formIntervaloFim, setFormIntervaloFim] = useState<string>('')

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

  const resetForm = () => {
    setEditingId(null)
    setFormNome('')
    setFormHorasTotais(0)
    setFormIntervalo(0)
    setFormIntervaloInicio('')
    setFormIntervaloFim('')
  }

  const startEditing = (j: Jornada) => {
    setEditingId(j.id)
    setFormNome(j.nome)
    setFormHorasTotais(j.horas_totais || 0)
    setFormIntervalo(j.intervalo_minutos || 0)
    setFormIntervaloInicio(j.intervalo_inicio_padrao || '')
    setFormIntervaloFim(j.intervalo_fim_padrao || '')
  }

  async function handleSaveForm() {
    if (!formNome.trim()) return
    setSaving(true)

    try {
      if (editingId) {
        // Update mode
        const { error } = await supabase
          .from('jornadas')
          .update({ 
            nome: formNome.trim().toUpperCase(),
            intervalo_minutos: formIntervalo || 0,
            horas_totais: formHorasTotais || 0,
            intervalo_inicio_padrao: formIntervaloInicio || null,
            intervalo_fim_padrao: formIntervaloFim || null
          })
          .eq('id', editingId)
        
        if (error) throw error

        setAlertModal({
          isOpen: true,
          title: 'Jornada Atualizada',
          message: 'As alterações da jornada foram salvas com sucesso!',
          type: 'success'
        })
      } else {
        // Insert mode
        const { error } = await supabase
          .from('jornadas')
          .insert({ 
            nome: formNome.trim().toUpperCase(),
            intervalo_minutos: formIntervalo || 0,
            horas_totais: formHorasTotais || 0,
            intervalo_inicio_padrao: formIntervaloInicio || null,
            intervalo_fim_padrao: formIntervaloFim || null
          })
        
        if (error) throw error

        setAlertModal({
          isOpen: true,
          title: 'Sucesso',
          message: 'Jornada cadastrada com sucesso!',
          type: 'success'
        })
      }

      resetForm()
      fetchJornadas()
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: editingId ? 'Erro na Atualização' : 'Erro no Cadastro',
        message: 'Ocorreu um erro: ' + error.message,
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

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Painel Esquerdo: Formulário (Criação / Edição) */}
        <div className={`bg-white dark:bg-zinc-900 p-6 rounded-2xl border shadow-sm h-fit transition-all ${editingId ? 'border-amber-400 dark:border-amber-600 ring-2 ring-amber-400/20' : 'border-zinc-200 dark:border-zinc-800'}`}>
          <div className="flex items-center justify-between mb-6">
            <h2 className={`text-sm font-black uppercase tracking-widest flex items-center ${editingId ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
              {editingId ? <Edit3 className="mr-2 h-5 w-5 animate-pulse" /> : <Plus className="mr-2 h-5 w-5" />}
              {editingId ? 'Editar Jornada' : 'Nova Jornada'}
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 font-bold underline"
              >
                Cancelar Edição
              </button>
            )}
          </div>

          <div className="space-y-5">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">
                Descrição do Horário
              </label>
              <input
                type="text"
                placeholder="Ex: 08H ÀS 18H"
                value={formNome}
                onChange={e => setFormNome(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium mb-4 uppercase"
              />

              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">
                Duração Total (Horas)
              </label>
              <input
                type="number"
                placeholder="Ex: 10"
                min={0}
                step="0.5"
                value={formHorasTotais || ''}
                onChange={e => setFormHorasTotais(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium mb-4"
              />

              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">
                Intervalo (Minutos)
              </label>
              <input
                type="number"
                placeholder="Ex: 60 ou 120"
                min={0}
                value={formIntervalo || ''}
                onChange={e => setFormIntervalo(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium mb-4"
              />

              <div className="grid grid-cols-2 gap-2 mb-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Início Padrão</label>
                  <input
                    type="time"
                    value={formIntervaloInicio}
                    onChange={e => setFormIntervaloInicio(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Fim Padrão</label>
                  <input
                    type="time"
                    value={formIntervaloFim}
                    onChange={e => setFormIntervaloFim(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                  />
                </div>
              </div>
              <p className="text-[10px] text-zinc-400 italic mb-4">
                Os horários padrão de início e fim são usados para o modo Rígido nas unidades que exigem intervalo.
              </p>
            </div>

            <div className="space-y-2">
              <button
                onClick={handleSaveForm}
                disabled={saving || !formNome.trim()}
                className={`w-full font-black uppercase tracking-widest py-3 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 shadow-lg ${
                  editingId
                    ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/20'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20'
                }`}
              >
                {saving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : editingId ? (
                  'Salvar Alterações'
                ) : (
                  'Cadastrar Jornada'
                )}
              </button>

              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="w-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs uppercase tracking-wider py-2.5 rounded-xl transition-all"
                >
                  Cancelar Edição
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Painel Direito: Tabela de Jornadas */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Jornada</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Duração</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Intervalo</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Status</th>
                <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 w-32">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center">
                    <Loader2 className="h-10 w-10 animate-spin mx-auto text-blue-500 opacity-50" />
                  </td>
                </tr>
              ) : jornadas.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center">
                    <Clock className="h-12 w-12 mx-auto text-zinc-200 dark:text-zinc-800 mb-4" />
                    <p className="text-zinc-400 font-bold uppercase text-xs tracking-widest">Nenhuma jornada cadastrada</p>
                  </td>
                </tr>
              ) : (
                jornadas.map(j => {
                  const isBeingEdited = editingId === j.id
                  return (
                    <tr 
                      key={j.id} 
                      className={`transition-colors ${
                        isBeingEdited 
                          ? 'bg-amber-50/70 dark:bg-amber-950/30 font-semibold' 
                          : !j.ativo 
                            ? 'opacity-50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30' 
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center font-black text-zinc-900 dark:text-white uppercase tracking-tighter text-base">
                          <Clock className={`mr-3 h-5 w-5 flex-shrink-0 ${isBeingEdited ? 'text-amber-500 animate-pulse' : j.ativo ? 'text-blue-500' : 'text-zinc-400'}`} />
                          <span>{j.nome}</span>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <span className="font-bold text-zinc-700 dark:text-zinc-300">
                          {j.horas_totais}h
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        {j.intervalo_minutos > 0 ? (
                          <div className="space-y-0.5">
                            <span className="font-bold text-zinc-900 dark:text-white block">
                              {j.intervalo_minutos} min
                            </span>
                            {j.intervalo_inicio_padrao && j.intervalo_fim_padrao ? (
                              <span className="inline-flex items-center text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                                {j.intervalo_inicio_padrao} às {j.intervalo_fim_padrao}
                              </span>
                            ) : j.intervalo_inicio_padrao ? (
                              <span className="text-xs text-zinc-500 font-medium block">
                                Início: {j.intervalo_inicio_padrao}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-zinc-400 font-medium">-</span>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${j.ativo ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                          {j.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-center">
                        <div className="flex justify-center items-center gap-2">
                          <button
                            onClick={() => isBeingEdited ? resetForm() : startEditing(j)}
                            className={`p-2 rounded-lg transition-all ${
                              isBeingEdited
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                : 'text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                            }`}
                            title={isBeingEdited ? 'Cancelar edição' : 'Editar jornada'}
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
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
