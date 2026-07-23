'use client'

import { ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  type?: 'default' | 'danger' | 'warning' | 'success'
  zIndexClass?: string
}

export function Modal({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  footer,
  type = 'default',
  zIndexClass = 'z-[100]'
}: ModalProps) {
  if (!isOpen) return null

  const typeColors = {
    default: 'text-blue-600 dark:text-blue-400',
    danger: 'text-red-600 dark:text-red-400',
    warning: 'text-amber-600 dark:text-amber-400',
    success: 'text-emerald-600 dark:text-emerald-400'
  }

  return (
    <div className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200`}>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-zinc-200 dark:border-zinc-800 animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <h3 className={`text-lg font-bold ${typeColors[type]}`}>{title}</h3>
          <button 
            onClick={onClose}
            className="p-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="p-6">
          {children}
        </div>

        {footer && (
          <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-100 dark:border-zinc-800 flex gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
