'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Layers, Loader2, CheckCircle2, AlertCircle, Users } from 'lucide-react'

interface JustificativaBulkModalProps {
  isOpen: boolean
  onClose: () => void
  selectedEventos: any[]
  templates: any[]
  onSaveBulk: (texto: string, templateId?: string) => Promise<void>
}

export function JustificativaBulkModal({
  isOpen,
  onClose,
  selectedEventos,
  templates,
  onSaveBulk
}: JustificativaBulkModalProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [texto, setTexto] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)

  const handleTemplateSelect = (tId: string) => {
    setSelectedTemplateId(tId)
    if (!tId) return
    const tmpl = templates.find(t => t.id === tId)
    if (tmpl) {
      setTexto(tmpl.texto)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!texto || texto.trim().length < 10) {
      setError('A justificativa em lote deve conter pelo menos 10 caracteres para ser válida.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSaveBulk(texto.trim(), selectedTemplateId || undefined)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Erro ao aplicar justificativas em lote.')
    } finally {
      setSaving(false)
    }
  }

  if (selectedEventos.length === 0) return null

  // Contadores agregados
  const totalServidoresUnicos = new Set(selectedEventos.map(e => e.servidor_id)).size
  const temExistente = selectedEventos.some(e => e.justificativa_texto)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Preenchimento de Justificativas em Lote">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Resumo da Seleção */}
        <div className="p-4 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/60 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-600 rounded-xl text-white">
                <Layers className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-bold text-zinc-900 dark:text-white text-sm">
                  {selectedEventos.length} evento(s) selecionado(s)
                </h4>
                <p className="text-xs text-zinc-500 font-medium">
                  {totalServidoresUnicos} servidor(es) diferente(s)
                </p>
                {/*
                  O LOTE SÓ VALIDA — nunca marca falta, e a tela precisa dizer isso.
                  Marcar falta é registro sobre a conduta de uma pessoa: sai de uma decisão
                  individual, com texto próprio, olhando o ponto daquele dia. Um botão que
                  fizesse isso em 20 eventos de uma vez seria a forma mais fácil de produzir
                  acusação em massa sem ninguém ler nenhuma.
                */}
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold mt-0.5">
                  Em lote só é possível VALIDAR. Para registrar falta, abra o evento.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs font-bold text-indigo-600 hover:underline uppercase tracking-wider"
            >
              {showDetails ? 'Ocultar Lista' : 'Ver Servidores'}
            </button>
          </div>

          {showDetails && (
            <div className="max-h-36 overflow-y-auto border-t border-indigo-200 dark:border-indigo-900/40 pt-2 space-y-1 text-xs">
              {selectedEventos.map((ev, idx) => (
                <div key={idx} className="flex items-center justify-between text-zinc-700 dark:text-zinc-300 py-0.5">
                  <span>{ev.servidor_nome}</span>
                  <span className="text-[11px] font-mono text-zinc-500">Dia {String(ev.dia).padStart(2, '0')} ({ev.categoria})</span>
                </div>
              ))}
            </div>
          )}

          {temExistente && (
            <div className="p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl text-amber-800 dark:text-amber-300 text-[11px] font-medium flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Atenção: Alguns dos eventos selecionados já possuem justificativa prévia. O envio irá <strong>sobrescrever</strong> o texto atual deles.</span>
            </div>
          )}
        </div>

        {/* Template Selector */}
        {templates.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
              Usar Justificativa Padrão (Modelo)
            </label>
            <select
              value={selectedTemplateId}
              onChange={(e) => handleTemplateSelect(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-zinc-800 dark:text-zinc-200"
            >
              <option value="">-- SELECIONE UM MODELO PRONTO (OPCIONAL) --</option>
              {templates.map(tmpl => (
                <option key={tmpl.id} value={tmpl.id}>
                  {tmpl.titulo} {tmpl.categoria ? `(${tmpl.categoria})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Textarea */}
        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
            Texto Único da Justificativa <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={5}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Informe a justificativa que será aplicada a todos os eventos selecionados..."
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-medium leading-relaxed"
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
            disabled={saving}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-indigo-600/20 flex items-center gap-2 transition-all"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {saving ? 'Aplicando...' : `Aplicar em ${selectedEventos.length} Eventos`}
          </button>
        </div>
      </form>
    </Modal>
  )
}
