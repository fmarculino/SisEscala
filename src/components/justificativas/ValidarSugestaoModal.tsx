'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { CheckCircle2, XCircle, Loader2, AlertCircle, MessageSquare } from 'lucide-react'

interface ValidarSugestaoModalProps {
  isOpen: boolean
  onClose: () => void
  sugestao: any | null
  onValidar: (params: {
    justificativaId: string
    acao: 'aprovar' | 'rejeitar'
    textoEditado?: string
    motivoRejeicao?: string
  }) => Promise<void>
}

export function ValidarSugestaoModal({
  isOpen,
  onClose,
  sugestao,
  onValidar
}: ValidarSugestaoModalProps) {
  const [textoEditado, setTextoEditado] = useState('')
  const [motivoRejeicao, setMotivoRejeicao] = useState('')
  const [mode, setMode] = useState<'aprovar' | 'rejeitar'>('aprovar')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sugestao) {
      setTextoEditado(sugestao.texto_justificativa || '')
      setMotivoRejeicao('')
      setMode('aprovar')
      setError(null)
    }
  }, [sugestao, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (mode === 'aprovar' && (!textoEditado || textoEditado.trim().length < 10)) {
      setError('O texto da justificativa deve conter pelo menos 10 caracteres.')
      return
    }

    if (mode === 'rejeitar' && (!motivoRejeicao || motivoRejeicao.trim().length < 5)) {
      setError('Por favor, informe o motivo da rejeição (mínimo 5 caracteres).')
      return
    }

    setError(null)
    setSaving(true)
    try {
      await onValidar({
        justificativaId: sugestao.id,
        acao: mode,
        textoEditado: mode === 'aprovar' ? textoEditado.trim() : undefined,
        motivoRejeicao: mode === 'rejeitar' ? motivoRejeicao.trim() : undefined
      })
      onClose()
    } catch (err: any) {
      setError(err.message || 'Erro ao processar sugestão.')
    } finally {
      setSaving(false)
    }
  }

  if (!sugestao) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Análise de Sugestão de Justificativa">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Informações da sugestão */}
        <div className="p-4 bg-zinc-50 dark:bg-zinc-800/80 rounded-2xl border border-zinc-200 dark:border-zinc-700 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-zinc-900 dark:text-white text-sm">{sugestao.servidor_nome}</h4>
            <span className="px-2.5 py-0.5 text-xs font-black uppercase tracking-wider rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
              Sugestão do Servidor
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs text-zinc-500 font-medium">
            <div><strong className="text-zinc-700 dark:text-zinc-300">Dia:</strong> {String(sugestao.dia).padStart(2, '0')}/{String(sugestao.mes).padStart(2, '0')}/{sugestao.ano}</div>
            <div><strong className="text-zinc-700 dark:text-zinc-300">Categoria:</strong> {sugestao.categoria}</div>
            <div><strong className="text-zinc-700 dark:text-zinc-300">Turno:</strong> {sugestao.turno_codigo || '—'}</div>
          </div>
        </div>

        {/* Seleção da Ação (Aprovar / Rejeitar) */}
        <div className="flex items-center gap-3 p-1.5 bg-zinc-100 dark:bg-zinc-800/80 rounded-2xl border border-zinc-200 dark:border-zinc-700">
          <button
            type="button"
            onClick={() => setMode('aprovar')}
            className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
              mode === 'aprovar'
                ? 'bg-green-600 text-white shadow-md'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <CheckCircle2 className="h-4 w-4" />
            Aprovar Sugestão
          </button>
          <button
            type="button"
            onClick={() => setMode('rejeitar')}
            className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
              mode === 'rejeitar'
                ? 'bg-red-600 text-white shadow-md'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <XCircle className="h-4 w-4" />
            Rejeitar Sugestão
          </button>
        </div>

        {mode === 'aprovar' ? (
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
              Texto da Justificativa (você pode editar antes de aprovar)
            </label>
            <textarea
              rows={5}
              value={textoEditado}
              onChange={(e) => setTextoEditado(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-green-500 outline-none font-medium leading-relaxed"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
              Motivo da Rejeição <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={4}
              value={motivoRejeicao}
              onChange={(e) => setMotivoRejeicao(e.target.value)}
              placeholder="Descreva por que a sugestão do servidor está sendo rejeitada..."
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-red-500 outline-none font-medium leading-relaxed"
            />
            <p className="text-[11px] text-zinc-400">
              O motivo será exibido para o servidor no portal de consultas.
            </p>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl text-red-700 dark:text-red-300 text-xs font-bold flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className={`px-6 py-2.5 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-lg flex items-center gap-2 transition-all ${
              mode === 'aprovar'
                ? 'bg-green-600 hover:bg-green-700 shadow-green-600/20'
                : 'bg-red-600 hover:bg-red-700 shadow-red-600/20'
            }`}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'aprovar' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {saving ? 'Processando...' : mode === 'aprovar' ? 'Confirmar Aprovação' : 'Confirmar Rejeição'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
