'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { formatarHora, formatarDataHora } from '@/utils/horario'
import { AlertTriangle, Clock, Loader2 } from 'lucide-react'
import {
  classificarLugarDaBatida,
  rotuloDiaRelativo,
  deltaDiaDaBatida,
  type BatidaComLugar,
} from '@/utils/janelaBatidas'

/**
 * Corrigir um passo que JÁ TEM batida real — a tela da Fase 2 (17/09/2026).
 *
 * 🚨 POR QUE ELE NÃO É O MODAL DE VALIDAÇÃO MANUAL
 *   Aquele existe para PREENCHER um passo vazio, e o botão dele é "validar". Aqui o passo já
 *   está preenchido pelo relógio, e as duas únicas saídas legítimas são **trocar por outra
 *   batida real** ou **retirar a batida que não pertence a este turno**. Digitar horário por
 *   cima de batida continua fora daqui, e fora do alcance do RH: é a vedação 4 da Portaria
 *   671/2021 (alterar o dado registrado pelo empregado).
 *
 * ⚠️ NUNCA MANDA HORÁRIO — MANDA O `id`. Copiar o HH:MM perderia os segundos, a origem e o
 *    vínculo com a marcação, e transformaria a batida real numa declaração do gestor. O servidor
 *    relê o instante da fonte (mesma regra da v1.26.0).
 */

export type PassoCorrecao = 'entrada' | 'intervalo_saida' | 'intervalo_retorno' | 'saida'

const ROTULO: Record<PassoCorrecao, string> = {
  entrada: 'Entrada',
  intervalo_saida: 'Saída para o intervalo',
  intervalo_retorno: 'Retorno do intervalo',
  saida: 'Saída final',
}

export interface BatidaOferecida extends BatidaComLugar {
  id: string
  ocorrido_em: string
  origem?: string | null
  /** Em qual passo/linha esta batida está HOJE, se estiver em algum. */
  usadaEm?: { passo: PassoCorrecao; rotuloLinha: string } | null
  /** Distância em minutos do horário previsto deste passo. */
  distanciaMin?: number | null
}

interface Props {
  isOpen: boolean
  onClose: () => void
  servidorNome: string
  dia: number
  mes: number
  ano: number
  passo: PassoCorrecao
  rotuloLinha: string
  /** A batida que ocupa o passo agora. */
  batidaAtual: { id: string; ocorrido_em: string } | null
  batidas: BatidaOferecida[]
  /** Unidade da escala desta célula — é contra ela que "bateu em outra unidade" é decidido. */
  unidadeDaEscalaId?: string | null
  /** Quem pode digitar horário por cima de batida real (só Administrador). */
  podeDigitar: boolean
  onConfirmar: (escolha:
    | { tipo: 'trocar'; marcacaoId: string; justificativa: string }
    | { tipo: 'retirar'; justificativa: string }
  ) => Promise<void>
}

export function CorrecaoBatidaModal({
  isOpen, onClose, servidorNome, dia, mes, ano, passo, rotuloLinha,
  batidaAtual, batidas, unidadeDaEscalaId, podeDigitar, onConfirmar,
}: Props) {
  const [escolhida, setEscolhida] = useState<string | null>(null)
  const [retirar, setRetirar] = useState(false)
  const [justificativa, setJustificativa] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // O modal é reaproveitado entre células: sem isto a escolha feita no passo anterior
  // apareceria pré-selecionada no seguinte, e corrigir ponto da pessoa errada por estado
  // residual de componente é o tipo de erro que não se descobre olhando a tela.
  useEffect(() => {
    setEscolhida(null)
    setRetirar(false)
    setJustificativa('')
    setErro(null)
  }, [batidaAtual?.id, passo, rotuloLinha])

  const dataCelulaISO = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`

  const lista = useMemo(
    () => batidas.filter(b => !batidaAtual || b.id !== batidaAtual.id),
    [batidas, batidaAtual],
  )

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (justificativa.trim().length < 10) {
      setErro('Descreva o motivo da correção (mínimo 10 caracteres). Ele fica registrado junto com a batida.')
      return
    }
    if (!retirar && !escolhida) {
      setErro('Escolha a batida que deve ocupar este passo, ou marque que a batida atual não pertence a este turno.')
      return
    }
    setErro(null)
    setSalvando(true)
    try {
      await onConfirmar(retirar
        ? { tipo: 'retirar', justificativa: justificativa.trim() }
        : { tipo: 'trocar', marcacaoId: escolhida!, justificativa: justificativa.trim() })
      onClose()
    } catch (err: any) {
      setErro(err?.message || 'Não foi possível aplicar a correção.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Corrigir com as batidas reais">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="p-4 bg-zinc-50 dark:bg-zinc-800/80 rounded-2xl border border-zinc-200 dark:border-zinc-700 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-black text-zinc-900 dark:text-white text-base">{servidorNome}</h4>
            <span className="px-3 py-1 text-xs font-black uppercase tracking-wider rounded-full border bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300">
              {ROTULO[passo]}
            </span>
          </div>
          <div className="text-xs text-zinc-500 font-medium">
            <strong className="text-zinc-700 dark:text-zinc-300">Dia:</strong>{' '}
            {String(dia).padStart(2, '0')}/{String(mes).padStart(2, '0')}/{ano}
            {' · '}
            <strong className="text-zinc-700 dark:text-zinc-300">Turno:</strong> {rotuloLinha}
          </div>
          {batidaAtual && (
            <div className="flex items-center gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700 text-xs">
              <Clock className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <strong className="text-zinc-700 dark:text-zinc-300">Neste passo hoje:</strong>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                {formatarHora(batidaAtual.ocorrido_em)}
                {rotuloDiaRelativo(deltaDiaDaBatida(batidaAtual.ocorrido_em, dataCelulaISO)) || ''}
              </span>
            </div>
          )}
        </div>

        {/* A batida continua existindo — isto não é apagar nada, e dizê-lo aqui evita a dúvida
            que trava quem vai decidir. */}
        <p className="text-[11px] text-zinc-500 leading-snug flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px text-amber-500" />
          <span>
            A batida <strong>nunca é apagada</strong>: ela continua registrada no relógio e no
            sistema. O que se grava aqui é o <strong>juízo</strong> sobre ela — com seu nome, o
            motivo e a data — e ele sobrevive às próximas sincronizações.
          </span>
        </p>

        {/* RETIRAR */}
        <label className={`block p-3 rounded-xl border-2 cursor-pointer transition-all ${
          retirar ? 'border-red-500 bg-red-50 dark:bg-red-950/30'
                  : 'border-zinc-200 dark:border-zinc-700 hover:border-red-300'}`}>
          <div className="flex items-start gap-2">
            <input
              type="radio"
              checked={retirar}
              onChange={() => { setRetirar(true); setEscolhida(null) }}
              className="mt-0.5 h-4 w-4"
            />
            <div>
              <div className="font-black text-xs uppercase tracking-wider text-red-700 dark:text-red-400">
                Esta batida não pertence a este turno
              </div>
              <div className="text-[11px] text-zinc-500 mt-1 leading-snug">
                O passo fica vazio e a batida sai de circulação. É o caso de quem bateu no horário
                deste turno mas estava chegando para outro — ou não trabalhou nele.
              </div>
            </div>
          </div>
        </label>

        {/* TROCAR */}
        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
            …ou use outra batida real deste dia
          </label>
          {lista.length === 0 ? (
            <p className="text-[11px] text-zinc-400 leading-snug px-1">
              Não há outra batida registrada neste dia.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {lista.map(b => {
                const lugar = classificarLugarDaBatida(b, unidadeDaEscalaId)
                const delta = rotuloDiaRelativo(deltaDiaDaBatida(b.ocorrido_em, dataCelulaISO))
                const marcada = escolhida === b.id && !retirar
                return (
                  <label
                    key={b.id}
                    className={`flex items-start gap-2 p-2.5 rounded-xl border-2 cursor-pointer transition-all ${
                      marcada ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                              : 'border-zinc-200 dark:border-zinc-700 hover:border-blue-300'}`}
                  >
                    <input
                      type="radio"
                      checked={marcada}
                      onChange={() => { setEscolhida(b.id); setRetirar(false) }}
                      className="mt-0.5 h-4 w-4"
                    />
                    <div className="min-w-0">
                      <div className="font-mono font-black text-sm text-zinc-900 dark:text-zinc-100">
                        {formatarHora(b.ocorrido_em)}
                        {delta && <span className="text-amber-600 dark:text-amber-400 text-[10px] ml-1">{delta}</span>}
                        {typeof b.distanciaMin === 'number' && (
                          <span className="ml-2 text-[10px] font-bold text-zinc-400">
                            {b.distanciaMin} min do previsto
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 leading-snug" title={formatarDataHora(b.ocorrido_em)}>
                        {b.usadaEm
                          ? <>hoje é a <strong>{ROTULO[b.usadaEm.passo]}</strong> de {b.usadaEm.rotuloLinha}</>
                          : 'sem passo atribuído'}
                      </div>
                      {lugar.outraUnidade && (
                        <div className="text-[10px] font-bold text-red-600 dark:text-red-400 leading-snug">
                          bateu em {lugar.rotulo}
                        </div>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          )}
          {/* A batida que hoje ocupa outro passo aparece na lista de propósito: é justamente o
              caso da rajada, em que o alinhamento pôs a batida certa no passo errado. Escondê-la
              — como a tela fazia, tratando-a como "horário já utilizado" — deixava sem saída o
              erro mais comum. */}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
            Motivo da correção <span className="text-red-500">*</span>
          </label>
          <textarea
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            rows={3}
            placeholder="Ex.: a batida das 18:21 foi a chegada antecipada para o plantão noturno; a servidora não cumpriu o plantão MT."
            className="w-full px-3 py-2 rounded-xl border-2 border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        {!podeDigitar && (
          <p className="text-[11px] text-zinc-400 leading-snug">
            Precisa lançar um horário que <strong>não foi batido</strong> neste passo? Isso
            substitui o registro do servidor pelo do gestor e é ato exclusivo do Administrador.
          </p>
        )}

        {erro && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border-2 border-red-300 dark:border-red-800">
            <p className="text-xs font-bold text-red-700 dark:text-red-400">{erro}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando}
            className="px-4 py-2 rounded-xl text-sm font-black text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Aplicar correção
          </button>
        </div>
      </form>
    </Modal>
  )
}
