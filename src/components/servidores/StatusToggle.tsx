'use client'

import { useState } from 'react'
import { UserX, UserCheck, Clock, Loader2, AlertCircle } from 'lucide-react'
import { toggleServidorStatus } from '@/app/(dashboard)/servidores/actions'
import { useRouter } from 'next/navigation'
import { useDialog } from '@/components/ui/DialogProvider'

type Status = 'Ativo' | 'Afastado' | 'Inativo'

interface StatusToggleProps {
  servidorId: string
  currentStatus: Status
  nome: string
}

const OPCOES: { valor: Status; label: string }[] = [
  { valor: 'Ativo', label: 'Ativo' },
  { valor: 'Afastado', label: 'Afastado' },
  { valor: 'Inativo', label: 'Inativo' },
]

export function StatusToggle({ servidorId, currentStatus, nome }: StatusToggleProps) {
  const dialog = useDialog()
  const [loading, setLoading] = useState(false)
  const [pendente, setPendente] = useState<Status | null>(null)
  const [motivo, setMotivo] = useState('')
  const router = useRouter()

  async function aplicar(novoStatus: Status, motivoInformado?: string) {
    setLoading(true)
    try {
      const result = await toggleServidorStatus(servidorId, novoStatus, motivoInformado)
      if (result?.error) {
        void dialog.alert('Erro: ' + result.error)
      } else {
        setPendente(null)
        setMotivo('')
        router.refresh()
      }
    } catch (error: any) {
      void dialog.alert('Erro inesperado: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  function handleSelect(novoStatus: Status) {
    if (novoStatus === currentStatus || loading) return
    // Sair de Ativo (pra Afastado ou Inativo) sempre pede motivo — licença médica, cedência,
    // desligamento etc. Voltar pra Ativo não pede: reativar é o caminho de menor atrito.
    if (novoStatus === 'Ativo') {
      void aplicar(novoStatus)
    } else {
      setPendente(novoStatus)
    }
  }

  const corAtual: Record<Status, string> = {
    Ativo: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
    Afastado: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    Inativo: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 border-red-200 dark:border-red-800',
  }

  return (
    <>
      <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-1">
        {OPCOES.map(op => (
          <button
            key={op.valor}
            type="button"
            onClick={() => handleSelect(op.valor)}
            disabled={loading}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-bold transition-all disabled:opacity-50 ${
              currentStatus === op.valor
                ? corAtual[op.valor]
                : 'text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {loading && currentStatus === op.valor ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : op.valor === 'Ativo' ? (
              <UserCheck className="h-3.5 w-3.5" />
            ) : op.valor === 'Afastado' ? (
              <Clock className="h-3.5 w-3.5" />
            ) : (
              <UserX className="h-3.5 w-3.5" />
            )}
            {op.label}
          </button>
        ))}
      </div>

      {/* Modal de motivo — para qualquer transição que sai de Ativo */}
      {pendente && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-zinc-200 dark:border-zinc-800 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
                <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-full">
                  <AlertCircle className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold">
                  {pendente === 'Inativo' ? 'Inativar Servidor' : 'Marcar como Afastado'}
                </h3>
              </div>

              <div className="space-y-2">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {pendente === 'Inativo'
                    ? <>Deseja realmente inativar <strong>{nome}</strong>? Ele não aparecerá mais nas novas escalas.</>
                    : <>Deseja marcar <strong>{nome}</strong> como afastado? Ele sai das novas escalas até voltar para Ativo.</>}
                </p>
                <label className="block text-sm font-bold text-zinc-700 dark:text-zinc-300">
                  Motivo:
                </label>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder={pendente === 'Inativo' ? 'Ex: Desligamento, Exoneração...' : 'Ex: Licença médica, Cedência a outro órgão...'}
                  className="w-full h-24 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-amber-500 outline-none resize-none"
                  autoFocus
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setPendente(null); setMotivo('') }}
                  disabled={loading}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => aplicar(pendente, motivo)}
                  disabled={loading || !motivo.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 text-white font-bold hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
