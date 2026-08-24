'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { formatarHora } from '@/utils/horario'
import { Loader2, CheckCircle2, AlertCircle, AlertTriangle, Clock } from 'lucide-react'
import type { Desfecho } from '@/utils/gestaoJustificativas'

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
    /** Estado vindo de fn_desfecho_evento_dia. `null` = a RPC não respondeu — ver abaixo. */
    estado?: string | null
    estado_motivo?: string | null
    resultado?: Desfecho
    presenca_entrada_em?: string | null
    presenca_saida_em?: string | null
  } | null
  templates: any[]
  /**
   * Se o usuário pode desfazer um desfecho JÁ gravado (RH Geral, RH da Unidade, Administrador
   * Geral). Coordenador e ass_adm decidem, não revisam a própria decisão — decisão do usuário
   * em 23/08/2026. A regra real é da action e do banco; isto é só o que a tela oferece.
   */
  podeReverter?: boolean
  onSave: (texto: string, templateId?: string, resultado?: Desfecho) => Promise<void>
}

export function JustificativaModal({
  isOpen,
  onClose,
  evento,
  templates,
  podeReverter = false,
  onSave
}: JustificativaModalProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [texto, setTexto] = useState(evento?.texto_justificativa || '')
  const [desfecho, setDesfecho] = useState<Desfecho>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // O modal é reaproveitado entre eventos: sem isto, a decisão tomada no evento anterior
  // apareceria pré-selecionada no seguinte. Marcar falta na pessoa errada por estado residual
  // de componente é exatamente o tipo de erro que não se descobre olhando a tela.
  useEffect(() => {
    setTexto(evento?.texto_justificativa || '')
    setDesfecho(evento?.resultado ?? null)
    setSelectedTemplateId('')
    setError(null)
  }, [evento?.escala_diaria_id, evento?.texto_justificativa, evento?.resultado])

  const handleTemplateSelect = (tId: string) => {
    setSelectedTemplateId(tId)
    if (!tId) return
    const tmpl = templates.find(t => t.id === tId)
    if (tmpl) setTexto(tmpl.texto)
  }

  if (!evento) return null

  // A decisão só é pedida onde existe decisão a tomar. Evento que o ponto já provou
  // (`registrado`) ou que ainda não aconteceu (`previsto`) segue como a justificativa
  // motivacional de sempre. Estado desconhecido (a RPC não respondeu) NÃO oferece a escolha —
  // oferecer sem saber o estado é pedir uma decisão sobre um fato que a tela não conhece.
  //
  // O RH também abre a decisão num evento que JÁ tem desfecho — é por aqui que se reverte uma
  // falta, inclusive a que o auto-fechamento criou por decurso de prazo. Para quem não pode
  // reverter, o modal continua sendo só a justificativa: a decisão já foi tomada.
  const ehReversao = !!evento.resultado && podeReverter
  const pedeDecisao = evento.estado === 'em_avaliacao' || ehReversao

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!texto || texto.trim().length < 10) {
      setError('A justificativa deve conter pelo menos 10 caracteres para ser válida.')
      return
    }
    if (pedeDecisao && desfecho === null) {
      setError('Escolha se o plantão foi cumprido ou se deve ser registrado como falta.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave(texto.trim(), selectedTemplateId || undefined, pedeDecisao ? desfecho : undefined)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar justificativa.')
    } finally {
      setSaving(false)
    }
  }

  const filteredTemplates = templates.filter(t => !t.categoria || t.categoria === evento.categoria)

  const categoriaColors: Record<string, string> = {
    'Extra': 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300',
    'Plantão': 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-300',
    'Sobreaviso': 'bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-cyan-300',
  }

  const ehSobreaviso = evento.categoria === 'Sobreaviso'
  const entrada = evento.presenca_entrada_em ? formatarHora(evento.presenca_entrada_em) : null
  const saida = evento.presenca_saida_em ? formatarHora(evento.presenca_saida_em) : null

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

          {/* O ponto daquele dia, na frente de quem vai decidir. */}
          {!ehSobreaviso && (
            <div className="flex items-center gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700 text-xs">
              <Clock className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <strong className="text-zinc-700 dark:text-zinc-300">Ponto registrado:</strong>
              {entrada || saida ? (
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                  {entrada || '— sem entrada'} {'→'} {saida || '— sem saída'}
                </span>
              ) : (
                <span className="font-bold text-red-600 dark:text-red-400">Nenhum registro</span>
              )}
            </div>
          )}
        </div>

        {/* A DECISÃO — primeiro campo, obrigatória, só onde há o que decidir */}
        {pedeDecisao && (
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
              {ehSobreaviso ? 'Este sobreaviso foi cumprido?' : 'Este plantão foi cumprido?'}{' '}
              <span className="text-red-500">*</span>
            </label>
            {ehReversao && (
              <p className="text-[11px] text-blue-700 dark:text-blue-400 font-bold flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                Este evento já está registrado como
                <strong>{evento.resultado === 'falta' ? ' FALTA' : ' VALIDADO'}</strong>.
                Alterar agora é uma reversão e fica registrada no histórico com seu nome.
              </p>
            )}
            {evento.estado_motivo && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400 font-bold flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                {evento.estado_motivo}
              </p>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setDesfecho('validado')}
                className={`text-left p-3 rounded-xl border-2 transition-all ${
                  desfecho === 'validado'
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                    : 'border-zinc-200 dark:border-zinc-700 hover:border-emerald-300'
                }`}
              >
                <div className="font-black text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  Sim — validar
                </div>
                <div className="text-[11px] text-zinc-500 mt-1 leading-snug">
                  Conta como cumprido no anexo. A justificativa registra a motivação do serviço.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDesfecho('falta')}
                className={`text-left p-3 rounded-xl border-2 transition-all ${
                  desfecho === 'falta'
                    ? 'border-red-500 bg-red-50 dark:bg-red-950/30'
                    : 'border-zinc-200 dark:border-zinc-700 hover:border-red-300'
                }`}
              >
                <div className="font-black text-xs uppercase tracking-wider text-red-700 dark:text-red-400">
                  Não — registrar falta
                </div>
                <div className="text-[11px] text-zinc-500 mt-1 leading-snug">
                  Não conta no anexo e aparece no somatório de faltas. Descreva o que aconteceu.
                </div>
              </button>
            </div>

            {/* Excluir da escala é o caminho de "escalei errado" — mas só existe enquanto não
                houver batida nenhuma (Direito Adquirido). Dizer isso aqui evita a viagem até a
                grade para levar um erro sem explicação. */}
            {!entrada && !saida && !ehSobreaviso && (
              <p className="text-[11px] text-zinc-400 leading-snug">
                Se o plantão foi lançado por engano, o caminho é <strong>apagar a célula na grade
                da escala</strong> — ainda é possível, porque não há nenhuma batida neste dia.
              </p>
            )}
            {(entrada || saida) && (
              <p className="text-[11px] text-zinc-400 leading-snug">
                Este dia já tem batida, então a célula <strong>não pode mais ser apagada</strong> na
                grade (Direito Adquirido). A decisão é aqui.
              </p>
            )}
          </div>
        )}

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
                <option key={tmpl.id} value={tmpl.id}>{tmpl.titulo}</option>
              ))}
            </select>
          </div>
        )}

        {/* Textarea da Justificativa */}
        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
            {desfecho === 'falta' ? 'Descrição da falta' : 'Descrição da Justificativa'}{' '}
            <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={5}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={desfecho === 'falta'
              ? 'Descreva o que aconteceu: ausência sem aviso, sem troca e sem justificativa apresentada...'
              : 'Descreva a motivação ou necessidade do serviço extraordinário/plantão/sobreaviso...'}
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
            className={`px-6 py-2.5 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-lg flex items-center gap-2 transition-all ${
              desfecho === 'falta'
                ? 'bg-red-600 hover:bg-red-700 shadow-red-600/20'
                : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20'
            }`}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {saving
              ? 'Gravando...'
              : desfecho === 'falta' ? 'Registrar Falta' : 'Salvar Justificativa'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
