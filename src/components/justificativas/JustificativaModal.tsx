'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { FileText, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

interface JustificativaModalProps {
  isOpen: boolean
  onClose: () => void
  evento: {
    escala_diaria_id: string
    escala_mensal_id: string
    servidor_id: string
    servidor_nome: string
    servidor_matricula?: string
    dia: number
    mes: number
    ano: number
    categoria: string
    turno_codigo?: string
    texto_justificativa?: string
  } | null
  templates: any[]
  onSave: (texto: string, templateId?: string) => Promise<void>
}

export function JustificativaModal({
  isOpen,
  onClose,
  evento,
  templates,
  onSave
}: JustificativaModalProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [texto, setTexto] = useState(evento?.texto_justificativa || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset states when event changes or modal opens
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
      setError('A justificativa deve conter pelo menos 10 caracteres para ser válida.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave(texto.trim(), selectedTemplateId || undefined)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar justificativa.')
    } finally {
      setSaving(false)
    }
  }

  if (!evento) return null

  const filteredTemplates = templates.filter(t => 
    !t.categoria || t.categoria === evento.categoria
  )

  const categoriaColors: Record<string, string> = {
    'Extra': 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300',
    'Plantão': 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-300',
    'Sobreaviso': 'bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-cyan-300',
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Registrar Justificativa do Evento">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Header Informações do Servidor */}
        <div className="p-4 bg-zinc-50 dark:bg-zinc-800/80 rounded-2xl border border-zinc-200 dark:border-zinc-700 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-black text-zinc-900 dark:text-white text-base">{evento.servidor_nome}</h4>
            <span className={`px-3 py-1 text-xs font-black uppercase tracking-wider rounded-full border ${categoriaColors[evento.categoria] || 'bg-zinc-100 text-zinc-800'}`}>
              {evento.categoria}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs text-zinc-500 font-medium">
            <div><strong className="text-zinc-700 dark:text-zinc-300">Matrícula:</strong> {evento.servidor_matricula || '—'}</div>
            <div><strong className="text-zinc-700 dark:text-zinc-300">Dia:</strong> {String(evento.dia).padStart(2, '0')}/{String(evento.mes).padStart(2, '0')}/{evento.ano}</div>
            <div><strong className="text-zinc-700 dark:text-zinc-300">Turno:</strong> {evento.turno_codigo || '—'}</div>
          </div>
        </div>

        {/* Template Padrão Selector */}
        {filteredTemplates.length > 0 && (
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
              {filteredTemplates.map(tmpl => (
                <option key={tmpl.id} value={tmpl.id}>
                  {tmpl.titulo}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Textarea da Justificativa */}
        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
            Descrição da Justificativa <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={5}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Descreva a motivação ou necessidade do serviço extraordinário/plantão/sobreaviso..."
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-medium leading-relaxed"
          />
          <p className="text-[11px] text-zinc-400">
            Você pode ajustar e personalizar o texto mesmo se selecionou um modelo pronto. Mínimo de 10 caracteres.
          </p>
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
            {saving ? 'Gravando...' : 'Salvar Justificativa'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
