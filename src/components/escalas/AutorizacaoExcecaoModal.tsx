'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Shield, Loader2, Save, X, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface AutorizacaoExcecaoModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  servidorId: string
  servidorNome: string
  unidadeId: string
  unidadeNome?: string
  mes: number
  ano: number
  limiteGlobalHoras: number
  limiteGlobalSobreavisos: number
  horasAtuais: number
  sobreavisosAtuais: number
  excecaoExistente?: {
    id?: string
    horas_adicionais_autorizadas: number
    sobreavisos_adicionais_autorizados: number
    motivo_justificativa: string
  } | null
}

export function AutorizacaoExcecaoModal({
  isOpen,
  onClose,
  onSaved,
  servidorId,
  servidorNome,
  unidadeId,
  unidadeNome,
  mes,
  ano,
  limiteGlobalHoras,
  limiteGlobalSobreavisos,
  horasAtuais,
  sobreavisosAtuais,
  excecaoExistente
}: AutorizacaoExcecaoModalProps) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const [horasAdicionais, setHorasAdicionais] = useState<number>(0)
  const [sobreavisosAdicionais, setSobreavisosAdicionais] = useState<number>(0)
  const [justificativa, setJustificativa] = useState('')

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('')
      if (excecaoExistente) {
        setHorasAdicionais(Number(excecaoExistente.horas_adicionais_autorizadas) || 0)
        setSobreavisosAdicionais(Number(excecaoExistente.sobreavisos_adicionais_autorizados) || 0)
        setJustificativa(excecaoExistente.motivo_justificativa || '')
      } else {
        // Sugere margem para cobrir o excesso atual se houver
        const excessoHoras = Math.max(0, Math.ceil(horasAtuais - limiteGlobalHoras))
        const excessoSob = Math.max(0, sobreavisosAtuais - limiteGlobalSobreavisos)
        setHorasAdicionais(excessoHoras)
        setSobreavisosAdicionais(excessoSob)
        setJustificativa('')
      }
    }
  }, [isOpen, excecaoExistente, horasAtuais, sobreavisosAtuais, limiteGlobalHoras, limiteGlobalSobreavisos])

  if (!isOpen) return null

  const nomeMes = new Date(ano, mes - 1, 1).toLocaleString('pt-BR', { month: 'long' }).toUpperCase()
  const tetoEfetivoHoras = limiteGlobalHoras + horasAdicionais
  const tetoEfetivoSob = limiteGlobalSobreavisos + sobreavisosAdicionais

  const handleSave = async () => {
    if (!justificativa.trim()) {
      setErrorMsg('Por favor, informe a justificativa obrigatória para esta autorização extraordinária.')
      return
    }

    setSaving(true)
    setErrorMsg('')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Sessão expirada. Faça login novamente.')

      const payload = {
        servidor_id: servidorId,
        unidade_id: unidadeId,
        mes,
        ano,
        horas_adicionais_autorizadas: horasAdicionais,
        sobreavisos_adicionais_autorizados: sobreavisosAdicionais,
        motivo_justificativa: justificativa.trim(),
        autorizado_por: user.id,
        updated_at: new Date().toISOString()
      }

      const { error } = await supabase
        .from('excecoes_escala_servidor')
        .upsert(payload, { onConflict: 'servidor_id,unidade_id,mes,ano' })

      if (error) throw error

      onSaved()
      onClose()
    } catch (err: any) {
      console.error('Erro ao salvar autorização extraordinária:', err)
      setErrorMsg(err.message || 'Erro ao salvar a autorização extraordinária.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header Modal */}
        <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 bg-amber-500/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-2xl">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                Autorização Extraordinária
              </h3>
              <p className="text-xs text-zinc-500 font-medium">
                Prerrogativa do Administrador para exceção de limites na escala
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Info Card do Servidor */}
          <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/60 rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-black text-zinc-400 uppercase tracking-widest">Servidor</span>
              <span className="font-bold text-amber-600 dark:text-amber-400 uppercase">{nomeMes} / {ano}</span>
            </div>
            <p className="text-base font-black text-zinc-900 dark:text-white uppercase">{servidorNome}</p>
            {unidadeNome && <p className="text-xs text-zinc-500">{unidadeNome}</p>}
          </div>

          {/* Comparativo de Limites Globais vs Atuais */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 rounded-2xl space-y-1">
              <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">Horas de Trabalho</span>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-zinc-500">Grade: <strong className="text-zinc-900 dark:text-white">{horasAtuais}h</strong></span>
                <span className="text-xs text-zinc-500">Global: <strong>{limiteGlobalHoras}h</strong></span>
              </div>
            </div>

            <div className="p-4 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-2xl space-y-1">
              <span className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest">Sobreavisos (Unidades)</span>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-zinc-500">Grade: <strong className="text-zinc-900 dark:text-white">{sobreavisosAtuais} un</strong></span>
                <span className="text-xs text-zinc-500">Global: <strong>{limiteGlobalSobreavisos} un</strong></span>
              </div>
            </div>
          </div>

          {/* Formulário de Exceção */}
          <div className="space-y-4 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block">
                  Horas Adicionais Autorizadas
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={horasAdicionais}
                    onChange={(e) => setHorasAdicionais(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-amber-500 outline-none font-bold pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">h</span>
                </div>
                <p className="text-[10px] text-zinc-400">Teto final: <strong>{tetoEfetivoHoras}h</strong></p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block">
                  Sobreavisos Adicionais
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={sobreavisosAdicionais}
                    onChange={(e) => setSobreavisosAdicionais(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-amber-500 outline-none font-bold pr-10"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">un</span>
                </div>
                <p className="text-[10px] text-zinc-400">Teto final: <strong>{tetoEfetivoSob} un</strong></p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block">
                Motivo / Justificativa Legal <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                placeholder="Descreva fundamentação legal ou operacional que autoriza o aumento extraordinário..."
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-xs focus:ring-2 focus:ring-amber-500 outline-none font-medium"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl flex items-center gap-2 text-xs text-red-600 dark:text-red-400 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-5 py-3 rounded-xl font-bold text-xs uppercase tracking-wider text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider bg-amber-600 text-white hover:bg-amber-700 transition-all shadow-md shadow-amber-600/20 active:scale-95 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Gravando...' : 'Salvar Autorização'}
          </button>
        </div>
      </div>
    </div>
  )
}
