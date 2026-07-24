'use client'

import { Modal } from '@/components/ui/Modal'
import { User, Camera, X } from 'lucide-react'

interface PhotoPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  photoUrl?: string | null
  servidorNome: string
  matricula?: string
  cargo?: string
  onOpenWebcam?: () => void
}

export function PhotoPreviewModal({
  isOpen,
  onClose,
  photoUrl,
  servidorNome,
  matricula,
  cargo,
  onOpenWebcam
}: PhotoPreviewModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Foto do Servidor"
    >
      <div className="space-y-5 text-center">
        {/* Large Photo Display Box */}
        <div className="relative aspect-square w-full max-w-md mx-auto bg-zinc-100 dark:bg-zinc-800 rounded-2xl overflow-hidden border-2 border-zinc-200 dark:border-zinc-700 shadow-xl flex items-center justify-center">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={servidorNome}
              className="w-full h-full object-cover animate-in zoom-in-95 duration-200"
            />
          ) : (
            <div className="p-8 text-center text-zinc-400">
              <User className="h-24 w-24 mx-auto text-zinc-300 dark:text-zinc-600 mb-2" />
              <p className="text-sm font-semibold">Nenhuma foto cadastrada para este servidor.</p>
            </div>
          )}
        </div>

        {/* Servidor Info Box */}
        <div className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700/60 text-center">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-tight">{servidorNome}</h3>
          <div className="flex items-center justify-center gap-2 mt-1 flex-wrap text-xs text-zinc-500 dark:text-zinc-400 font-medium">
            {matricula && (
              <span className="px-2.5 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 font-mono font-bold text-zinc-800 dark:text-zinc-200">
                Matrícula: {matricula}
              </span>
            )}
            {cargo && <span className="uppercase font-semibold">• {cargo}</span>}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex justify-between items-center gap-3 pt-2">
          {onOpenWebcam && (
            <button
              type="button"
              onClick={() => {
                onClose()
                onOpenWebcam()
              }}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center gap-2"
            >
              <Camera className="h-4 w-4" />
              {photoUrl ? 'Alterar Foto (Webcam)' : 'Capturar Foto (Webcam)'}
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-bold rounded-xl transition-all ml-auto"
          >
            Fechar
          </button>
        </div>
      </div>
    </Modal>
  )
}
