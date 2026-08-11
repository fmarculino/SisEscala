'use client'

import { useState } from 'react'
import { ArrowRightLeft, Info, CheckCircle2, XCircle, Loader2, User, Calendar } from 'lucide-react'
import { avaliarSolicitacaoTransferencia } from '../actions'

interface SolicitacaoTransferencia {
  id: string
  servidorId: string
  servidorNome: string
  servidorMatricula: string | null
  unidadeOrigemNome: string
  setorOrigemNome: string
  unidadeDestinoNome: string
  setorDestinoNome: string
  dataTransferenciaSugerida: string
  motivo: string
  solicitadoPorNome: string
  solicitadoEm: string
}

interface SolicitacoesTransferenciaSectionProps {
  solicitacoes: SolicitacaoTransferencia[]
  erro: string | null
  isSuperAdmin: boolean
}

export function SolicitacoesTransferenciaSection({ solicitacoes, erro, isSuperAdmin }: SolicitacoesTransferenciaSectionProps) {
  const [resolvidas, setResolvidas] = useState<Set<string>>(new Set())
  const visiveis = solicitacoes.filter(s => !resolvidas.has(s.id))

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <h2 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-blue-500" /> Solicitações de Transferência
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          {isSuperAdmin
            ? 'Só o administrador geral efetiva transferência de unidade/setor. Aprovar aqui aplica de verdade; rejeitar não muda nada.'
            : 'Pedidos de transferência aguardando avaliação do Administrador Geral. Você vê aqui os que estão no seu escopo.'}
        </p>
      </div>

      <div className="p-5">
        {erro ? (
          <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Não foi possível carregar esta seção ({erro}).</span>
          </div>
        ) : visiveis.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 py-6 justify-center">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nenhuma solicitação pendente.
          </div>
        ) : (
          <div className="space-y-3">
            {visiveis.map(s => (
              <LinhaSolicitacao
                key={s.id}
                solicitacao={s}
                isSuperAdmin={isSuperAdmin}
                onResolvida={() => setResolvidas(prev => new Set(prev).add(s.id))}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function LinhaSolicitacao({ solicitacao, isSuperAdmin, onResolvida }: {
  solicitacao: SolicitacaoTransferencia
  isSuperAdmin: boolean
  onResolvida: () => void
}) {
  const [mostrarRejeicao, setMostrarRejeicao] = useState(false)
  const [parecer, setParecer] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function aprovar() {
    setSalvando(true)
    setErro(null)
    const res = await avaliarSolicitacaoTransferencia({ solicitacaoId: solicitacao.id, acao: 'aprovar' })
    setSalvando(false)
    if (res?.error) { setErro(res.error); return }
    onResolvida()
  }

  async function rejeitar() {
    if (parecer.trim().length < 5) {
      setErro('Informe o motivo da rejeição (mínimo 5 caracteres).')
      return
    }
    setSalvando(true)
    setErro(null)
    const res = await avaliarSolicitacaoTransferencia({ solicitacaoId: solicitacao.id, acao: 'rejeitar', parecer })
    setSalvando(false)
    if (res?.error) { setErro(res.error); return }
    onResolvida()
  }

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">
            {solicitacao.servidorNome}
            {solicitacao.servidorMatricula && <span className="text-zinc-400 font-normal"> · matrícula {solicitacao.servidorMatricula}</span>}
          </p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
            <span className="text-zinc-500">{solicitacao.unidadeOrigemNome} / {solicitacao.setorOrigemNome}</span>
            {' → '}
            <span className="font-semibold text-blue-600 dark:text-blue-400">{solicitacao.unidadeDestinoNome} / {solicitacao.setorDestinoNome}</span>
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{solicitacao.motivo}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-zinc-400">
            <span className="inline-flex items-center gap-1"><User className="h-3 w-3" /> {solicitacao.solicitadoPorNome}</span>
            <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> efetivação pretendida {new Date(solicitacao.dataTransferenciaSugerida + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
          </div>
        </div>

        {isSuperAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={aprovar}
              disabled={salvando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Aprovar
            </button>
            <button
              onClick={() => setMostrarRejeicao(v => !v)}
              disabled={salvando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" />
              Rejeitar
            </button>
          </div>
        )}
      </div>

      {mostrarRejeicao && (
        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
          <textarea
            value={parecer}
            onChange={e => setParecer(e.target.value)}
            placeholder="Motivo da rejeição..."
            rows={2}
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white"
          />
          <div className="flex justify-end">
            <button
              onClick={rejeitar}
              disabled={salvando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirmar rejeição'}
            </button>
          </div>
        </div>
      )}

      {erro && <p className="text-xs text-red-600 dark:text-red-400">{erro}</p>}
    </div>
  )
}
