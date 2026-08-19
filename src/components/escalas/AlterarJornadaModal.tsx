'use client'

import { useState, useEffect } from 'react'
import { Clock, Loader2, AlertTriangle, CalendarClock, Pencil } from 'lucide-react'
import { criarVigenciaJornada, corrigirJornadaDoMes } from '@/app/(dashboard)/escalas/unidade/[unidadeId]/jornadaActions'

/**
 * Modal que aparece ao trocar a jornada de um servidor que JA TEM BATIDA no mes.
 *
 * POR QUE ELE EXISTE
 *   `escala_mensal.jornada_id` e uma jornada por (servidor, mes) — nao tem vigencia. Trocar no
 *   dia 12 nao muda "dali pra frente": reescreve a premissa dos dias 1 a 11 tambem, porque o
 *   previsto de todo dia sai dessa coluna. Batida real nao se perde (marcacoes_ponto e
 *   INSERT-only), mas o JULGAMENTO dela muda — hora extra e falta dos dias ja passados sao
 *   recalculadas contra um horario que nao valia neles.
 *
 *   Sem batida no mes, nada disso importa e a troca acontece direto, sem este modal.
 *
 * AS DUAS SAIDAS NAO SAO A MESMA COISA
 *   VIGENCIA  - "passou a cumprir outro horario a partir do dia X". Reducao judicial, acordo,
 *               troca de setor. Nao toca no mes; os dias anteriores continuam julgados pelo
 *               horario que valia neles, que e o correto.
 *   CORRECAO  - "a jornada estava errada desde o dia 1". Reescreve o mes mesmo — e o certo
 *               nesse caso — com justificativa obrigatoria e registro em historico.
 *
 *   Bloquear a troca resolveria o engano e proibiria a reducao judicial. Por isso os dois
 *   caminhos existem, e por isso a escolha e de quem sabe o que aconteceu, nao do sistema.
 */

export interface AlterarJornadaAlvo {
  escalaMensalId: string
  servidorId: string
  servidorNome: string
  jornadaAtualId: string
  jornadaAtualNome: string
  jornadaNovaId: string
  jornadaNovaNome: string
  /** Dias do mes que ja tem entrada ou saida registrada. */
  diasComBatida: number[]
}

interface Props {
  isOpen: boolean
  onClose: () => void
  /** Aplicou a correcao do mes: a grade precisa refletir a jornada nova no estado local. */
  onCorrigido: (escalaMensalId: string, jornadaId: string) => void
  /** Criou vigencia: a jornada do mes NAO muda, mas a grade recarrega para mostrar o aviso. */
  onVigenciaCriada: () => void
  alvo: AlterarJornadaAlvo | null
  mes: number
  ano: number
  unidadeId: string
}

export function AlterarJornadaModal({
  isOpen, onClose, onCorrigido, onVigenciaCriada, alvo, mes, ano, unidadeId,
}: Props) {
  const [modo, setModo] = useState<'vigencia' | 'correcao'>('vigencia')
  const [diaInicio, setDiaInicio] = useState<number>(1)
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  const ultimoDia = new Date(ano, mes, 0).getDate()

  useEffect(() => {
    if (!isOpen || !alvo) return
    setErro('')
    setMotivo('')
    setModo('vigencia')
    // Default: o dia seguinte a ultima batida. E a leitura mais provavel de "mudou agora" e
    // deixa intacto todo dia que ja foi efetivamente cumprido no horario antigo.
    const ultimaBatida = alvo.diasComBatida.length ? Math.max(...alvo.diasComBatida) : 0
    setDiaInicio(Math.min(Math.max(ultimaBatida + 1, 1), ultimoDia))
  }, [isOpen, alvo, ultimoDia])

  if (!isOpen || !alvo) return null

  const diasAfetados = alvo.diasComBatida.filter(d => d < diaInicio)
  const primeira = alvo.diasComBatida.length ? Math.min(...alvo.diasComBatida) : null
  const ultima = alvo.diasComBatida.length ? Math.max(...alvo.diasComBatida) : null

  const handleConfirmar = async () => {
    setErro('')
    if (!motivo.trim()) {
      setErro(modo === 'vigencia' ? 'Informe o motivo da alteração.' : 'Justificativa obrigatória para reescrever o mês.')
      return
    }
    setSaving(true)
    try {
      if (modo === 'vigencia') {
        const dataInicio = `${ano}-${String(mes).padStart(2, '0')}-${String(diaInicio).padStart(2, '0')}`
        const dataFim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
        const r = await criarVigenciaJornada(alvo.servidorId, alvo.jornadaNovaId, dataInicio, dataFim, motivo, unidadeId)
        if (r?.error) { setErro(r.error); return }
        onVigenciaCriada()
      } else {
        const r = await corrigirJornadaDoMes(alvo.escalaMensalId, alvo.jornadaNovaId, motivo, unidadeId)
        if (r?.error) { setErro(r.error); return }
        onCorrigido(alvo.escalaMensalId, alvo.jornadaNovaId)
      }
      onClose()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao alterar a jornada.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 shadow-xl">
        <div className="flex items-start gap-3 border-b border-zinc-200 dark:border-zinc-700 p-4">
          <Clock className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Alterar jornada de {alvo.servidorNome}</h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
              {alvo.jornadaAtualNome} <span className="mx-1">&rarr;</span> <strong>{alvo.jornadaNovaNome}</strong>
            </p>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex gap-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              Esta escala já tem <strong>{alvo.diasComBatida.length} dia(s) com ponto registrado</strong>
              {primeira && ultima ? <> (do dia {primeira} ao dia {ultima})</> : null}. A jornada do mês vale para
              <strong> todos os dias</strong>, então trocá-la reavalia também os dias já trabalhados — hora extra e
              falta são recalculadas contra o horário novo.
            </p>
          </div>

          {/* Opcao 1: vigencia */}
          <label className={`block rounded-md border p-3 cursor-pointer transition-colors ${modo === 'vigencia' ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/10' : 'border-zinc-200 dark:border-zinc-700'}`}>
            <div className="flex items-start gap-2">
              <input type="radio" checked={modo === 'vigencia'} onChange={() => setModo('vigencia')} className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  <CalendarClock className="h-4 w-4" /> Passou a cumprir o novo horário a partir de um dia
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                  Redução de jornada por decisão judicial, acordo interno, mudança de setor. Os dias anteriores
                  continuam valendo pelo horário antigo.
                </p>
                {modo === 'vigencia' && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-zinc-700 dark:text-zinc-300">A partir do dia</span>
                    <input
                      type="number" min={1} max={ultimoDia} value={diaInicio}
                      onChange={e => setDiaInicio(Math.min(Math.max(parseInt(e.target.value) || 1, 1), ultimoDia))}
                      className="w-16 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 py-1 text-sm"
                    />
                    <span className="text-xs text-zinc-500">até {ultimoDia}/{String(mes).padStart(2, '0')}</span>
                  </div>
                )}
                {modo === 'vigencia' && diasAfetados.length > 0 && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    {diasAfetados.length} dia(s) com ponto ficam antes desta data e <strong>não</strong> são afetados —
                    é o comportamento esperado.
                  </p>
                )}
              </div>
            </div>
          </label>

          {/* Opcao 2: correcao */}
          <label className={`block rounded-md border p-3 cursor-pointer transition-colors ${modo === 'correcao' ? 'border-red-500 bg-red-50/50 dark:bg-red-900/10' : 'border-zinc-200 dark:border-zinc-700'}`}>
            <div className="flex items-start gap-2">
              <input type="radio" checked={modo === 'correcao'} onChange={() => setModo('correcao')} className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  <Pencil className="h-4 w-4" /> A jornada estava errada desde o dia 1
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                  Erro de cadastro. Reescreve o mês inteiro — inclusive os {alvo.diasComBatida.length} dia(s) já
                  registrados — e fica gravado no histórico com a justificativa.
                </p>
              </div>
            </div>
          </label>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {modo === 'vigencia' ? 'Motivo' : 'Justificativa'} <span className="text-red-500">*</span>
            </label>
            <textarea
              value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
              placeholder={modo === 'vigencia'
                ? 'Ex.: redução de jornada deferida no processo nº ...'
                : 'Ex.: jornada lançada errada na abertura da escala; a correta desde o dia 1 é ...'}
              className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
            />
          </div>

          {erro && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-300">
              {erro}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 dark:border-zinc-700 p-4">
          <button onClick={onClose} disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleConfirmar} disabled={saving}
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${modo === 'correcao' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {modo === 'vigencia' ? `Aplicar a partir do dia ${diaInicio}` : 'Reescrever o mês'}
          </button>
        </div>
      </div>
    </div>
  )
}
