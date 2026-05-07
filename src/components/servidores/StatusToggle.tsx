'use client'

import { useState } from 'react'
import { UserX, UserCheck, Loader2, AlertCircle } from 'lucide-react'
import { toggleServidorStatus } from '@/app/(dashboard)/servidores/actions'
import { useRouter } from 'next/navigation'

interface StatusToggleProps {
  servidorId: string
  currentStatus: 'Ativo' | 'Inativo'
  nome: string
}

export function StatusToggle({ servidorId, currentStatus, nome }: StatusToggleProps) {
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [motivo, setMotivo] = useState('')
  const router = useRouter()

  const handleToggle = async () => {
    if (currentStatus === 'Ativo' && !showModal) {
      setShowModal(true)
      return
    }

    setLoading(true)
    try {
      const newStatus = currentStatus === 'Ativo' ? 'Inativo' : 'Ativo'
      const result = await toggleServidorStatus(servidorId, newStatus, motivo)
      
      if (result?.error) {
        alert('Erro: ' + result.error)
      } else {
        setShowModal(false)
        setMotivo('')
        router.refresh()
      }
    } catch (error: any) {
      alert('Erro inesperado: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={handleToggle}
        disabled={loading}
        className={`inline-flex items-center rounded-lg px-4 py-2 text-sm font-bold shadow-sm transition-all ${
          currentStatus === 'Ativo'
            ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400'
            : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400'
        }`}
      >
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : currentStatus === 'Ativo' ? (
          <UserX className="mr-2 h-4 w-4" />
        ) : (
          <UserCheck className="mr-2 h-4 w-4" />
        )}
        {currentStatus === 'Ativo' ? 'Inativar Servidor' : 'Reativar Servidor'}
      </button>

      {/* Modal para motivo de inativação */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-zinc-200 dark:border-zinc-800 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
                <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded-full">
                  <AlertCircle className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold">Inativar Servidor</h3>
              </div>

              <div className="space-y-2">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Deseja realmente inativar <strong>{nome}</strong>? Ele não aparecerá mais nas novas escalas.
                </p>
                <label className="block text-sm font-bold text-zinc-700 dark:text-zinc-300">
                  Motivo da Inativação:
                </label>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ex: Desligamento, Licença Médica, Transferência..."
                  className="w-full h-24 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-red-500 outline-none resize-none"
                  autoFocus
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowModal(false)}
                  disabled={loading}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleToggle}
                  disabled={loading || !motivo.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar Inativação'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
