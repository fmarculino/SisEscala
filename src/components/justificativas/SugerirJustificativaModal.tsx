'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Send, Loader2, AlertCircle, Info } from 'lucide-react'

interface SugerirJustificativaModalProps {
  isOpen: boolean
  onClose: () => void
  evento: {
    escala_diaria_id: string
    escala_mensal_id: string
    dia: number
    mes: number
    ano: number
    categoria: string
    turno_codigo?: string
  } | null
  onSugerir: (texto: string) => Promise<void>
}

export function SugerirJustificativaModal({
  isOpen,
  onClose,
  evento,
  onSugerir
}: SugerirJustificativaModalProps) {
  const [texto, setTexto] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!texto || texto.trim().length < 10) {
      setError('Sua sugestão de justificativa deve conter pelo menos 10 caracteres.')
      return
    }
    setError(null)
    setSending(true)
    try {
      await onSugerir(texto.trim())
      setTexto('')
      onClose()
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar sugestão.')
    } finally {
      setSending(false)
    }
  }

  if (!evento) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sugerir Justificativa de Evento">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Banner Informativo */}
        <div className="p-3.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 rounded-2xl text-blue-800 dark:text-blue-300 text-xs font-medium flex items-start gap-3">
          <Info className="h-5 w-5 shrink-0 text-blue-600 mt-0.5" />
          <div>
            <p className="font-bold">Como funciona a sugestão?</p>
            <p className="mt-0.5 leading-relaxed text-[11px]">
              Sua sugestão será enviada para avaliação do coordenador do setor. Ela só terá efeito legal após a aprovação.
            </p>
          </div>
        </div>

        {/* Detalhes do Evento */}
        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/80 rounded-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-between text-xs">
          <div>
            <span className="text-zinc-500 font-bold">Dia: </span>
            <span className="font-black text-zinc-900 dark:text-white">{String(evento.dia).padStart(2, '0')}/{String(evento.mes).padStart(2, '0')}/{evento.ano}</span>
          </div>
          <div>
            <span className="text-zinc-500 font-bold">Categoria: </span>
            <span className="font-black text-indigo-600">{evento.categoria}</span>
          </div>
          <div>
            <span className="text-zinc-500 font-bold">Turno: </span>
            <span className="font-black text-zinc-900 dark:text-white">{evento.turno_codigo || '—'}</span>
          </div>
        </div>

        {/* Textarea */}
        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
            Descrição da Sua Sugestão <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={5}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Descreva detalhadamente o motivo que originou esta Hora Extra / Plantão / Sobreaviso..."
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium leading-relaxed"
          />
        </div>

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
            disabled={sending}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-blue-600/20 flex items-center gap-2 transition-all"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? 'Enviando...' : 'Enviar Sugestão'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
