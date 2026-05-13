'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowRightLeft, Check, X, Clock, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { getSwapRequestsByUnit, approveSwapRequest, rejectSwapRequest } from '@/app/(dashboard)/escalas/unidade/[unidadeId]/swapActions'

interface SwapRequestPanelProps {
  unidadeId: string
  setorId: string
  mes: number
  ano: number
  isClosed: boolean
}

const STATUS_STYLES: Record<string, string> = {
  'Pendente': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  'Aprovada': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Rejeitada': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  'Cancelada': 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
}

export function SwapRequestPanel({ unidadeId, setorId, mes, ano, isClosed }: SwapRequestPanelProps) {
  const [solicitacoes, setSolicitacoes] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const pendingCount = solicitacoes.filter(s => s.status === 'Pendente').length

  const fetchSolicitacoes = useCallback(async () => {
    setLoading(true)
    const result = await getSwapRequestsByUnit(unidadeId, setorId, mes, ano)
    if (result.solicitacoes) {
      setSolicitacoes(result.solicitacoes)
    }
    setLoading(false)
  }, [unidadeId, setorId, mes, ano])

  useEffect(() => {
    fetchSolicitacoes()
  }, [fetchSolicitacoes])

  // Auto-hide feedback after 4 seconds
  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [feedback])

  const handleApprove = async (id: string) => {
    setActionLoading(true)
    setFeedback(null)
    const result = await approveSwapRequest(id)
    if (result.success) {
      setFeedback({ type: 'success', message: 'Solicitação aprovada com sucesso!' })
      await fetchSolicitacoes()
    } else {
      setFeedback({ type: 'error', message: result.error || 'Erro ao aprovar solicitação.' })
    }
    setActionLoading(false)
  }

  const handleReject = async (id: string) => {
    if (!rejectReason.trim()) return
    setActionLoading(true)
    setFeedback(null)
    const result = await rejectSwapRequest(id, rejectReason)
    if (result.success) {
      setRejectingId(null)
      setRejectReason('')
      setFeedback({ type: 'success', message: 'Solicitação rejeitada.' })
      await fetchSolicitacoes()
    } else {
      setFeedback({ type: 'error', message: result.error || 'Erro ao rejeitar solicitação.' })
    }
    setActionLoading(false)
  }

  if (solicitacoes.length === 0 && !loading) return null

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2 flex items-center justify-between bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-700 dark:text-zinc-300">
          <ArrowRightLeft className="h-4 w-4 text-purple-500" />
          Solicitações de Troca
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-purple-500 text-white text-[10px] font-black animate-pulse">
              {pendingCount}
            </span>
          )}
        </div>
        {isExpanded ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
      </button>

      {isExpanded && (
        <div className="max-h-[280px] overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
          {feedback && (
            <div className={`px-4 py-2 text-xs font-bold ${
              feedback.type === 'success' 
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' 
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
            }`}>
              {feedback.type === 'success' ? '✓' : '✕'} {feedback.message}
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-6 text-zinc-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          ) : (
            solicitacoes.map(sol => (
              <div key={sol.id} className="px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-xs text-zinc-900 dark:text-white truncate">
                        {sol.solicitante?.nome}
                      </span>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${STATUS_STYLES[sol.status] || ''}`}>
                        {sol.status}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                      Dia <strong>{sol.dia_origem}</strong> — Turno: <strong>{sol.turno?.codigo}</strong> ({sol.turno?.descricao})
                      {sol.categoria_origem && sol.categoria_origem !== 'Regular' && (
                        <span className={`ml-1 font-bold ${
                          sol.categoria_origem === 'Plantão' ? 'text-red-500' : 'text-blue-500'
                        }`}>• {sol.categoria_origem}</span>
                      )}
                      {sol.destinatario && <> → Trocar com <strong>{sol.destinatario.nome}</strong></>}
                    </p>
                    <p className="text-[10px] text-zinc-600 dark:text-zinc-400 mt-1 italic">
                      &ldquo;{sol.justificativa}&rdquo;
                    </p>
                    {sol.motivo_rejeicao && (
                      <p className="text-[10px] text-red-500 mt-1">
                        Motivo: {sol.motivo_rejeicao}
                      </p>
                    )}
                    <p className="text-[9px] text-zinc-400 mt-1">
                      {new Date(sol.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>

                  {sol.status === 'Pendente' && !isClosed && (
                    <div className="flex gap-1.5 shrink-0">
                      {rejectingId === sol.id ? (
                        <div className="flex flex-col gap-1">
                          <input
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Motivo..."
                            className="text-[10px] border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 w-36 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white outline-none focus:ring-1 focus:ring-red-500"
                            autoFocus
                          />
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleReject(sol.id)}
                              disabled={actionLoading || !rejectReason.trim()}
                              className="flex-1 text-[9px] px-2 py-1 bg-red-600 text-white rounded font-bold disabled:opacity-50"
                            >
                              {actionLoading ? '...' : 'Confirmar'}
                            </button>
                            <button
                              onClick={() => { setRejectingId(null); setRejectReason('') }}
                              className="text-[9px] px-2 py-1 bg-zinc-200 dark:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-300"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => handleApprove(sol.id)}
                            disabled={actionLoading}
                            className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors disabled:opacity-50"
                            title="Aprovar Troca"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setRejectingId(sol.id)}
                            disabled={actionLoading}
                            className="p-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
                            title="Rejeitar Troca"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
