'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { FileText, Loader2, Save, AlertCircle } from 'lucide-react'

interface TemplatePadraoModalProps {
  isOpen: boolean
  onClose: () => void
  template: any | null
  unidades: any[]
  setores: any[]
  onSave: (dados: {
    id?: string
    unidadeId?: string
    setorId?: string
    titulo: string
    texto: string
    categoria?: string
    ativo?: boolean
  }) => Promise<void>
}

export function TemplatePadraoModal({
  isOpen,
  onClose,
  template,
  unidades,
  setores,
  onSave
}: TemplatePadraoModalProps) {
  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [categoria, setCategoria] = useState('')
  const [unidadeId, setUnidadeId] = useState('')
  const [setorId, setSetorId] = useState('')
  const [ativo, setAtivo] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (template) {
      setTitulo(template.titulo || '')
      setTexto(template.texto || '')
      setCategoria(template.categoria || '')
      setUnidadeId(template.unidade_id || '')
      setSetorId(template.setor_id || '')
      setAtivo(template.ativo ?? true)
    } else {
      setTitulo('')
      setTexto('')
      setCategoria('')
      setUnidadeId('')
      setSetorId('')
      setAtivo(true)
    }
    setError(null)
  }, [template, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!titulo.trim()) {
      setError('Por favor, informe o título do modelo.')
      return
    }
    if (!texto.trim() || texto.trim().length < 10) {
      setError('O texto da justificativa deve conter pelo menos 10 caracteres.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave({
        id: template?.id,
        unidadeId: unidadeId || undefined,
        setorId: setorId || undefined,
        titulo: titulo.trim(),
        texto: texto.trim(),
        categoria: categoria || undefined,
        ativo
      })
      onClose()
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar modelo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={template ? 'Editar Modelo de Justificativa' : 'Novo Modelo de Justificativa Padrão'}>
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Título */}
        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
            Título do Modelo <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex: Substituição emergencial por atestado médico"
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-zinc-900 dark:text-white"
          />
        </div>

        {/* Categoria + Unidade em grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
              Categoria Aplicação
            </label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-zinc-800 dark:text-zinc-200"
            >
              <option value="">Todas as Categorias</option>
              <option value="Extra">Hora Extra</option>
              <option value="Plantão">Plantão</option>
              <option value="Sobreaviso">Sobreaviso</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
              Escopo de Unidade
            </label>
            <select
              value={unidadeId}
              onChange={(e) => setUnidadeId(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-zinc-800 dark:text-zinc-200"
            >
              <option value="">Global (Todas as Unidades)</option>
              {unidades.map(u => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Texto do Modelo */}
        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
            Texto Completo da Justificativa <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={5}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Digite o texto padrão que será inserido ao selecionar este modelo..."
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-medium leading-relaxed"
          />
        </div>

        {/* Checkbox Ativo */}
        <div className="flex items-center gap-3 pt-1">
          <input
            type="checkbox"
            id="template_ativo"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
          />
          <label htmlFor="template_ativo" className="text-xs font-bold text-zinc-700 dark:text-zinc-300 cursor-pointer">
            Modelo ativo e disponível para uso imediato
          </label>
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
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Gravando...' : 'Salvar Modelo'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
