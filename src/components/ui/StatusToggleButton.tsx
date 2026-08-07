'use client'

import { useRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useDialog } from './DialogProvider'

interface StatusToggleButtonProps {
  action: () => Promise<void>
  isActive: boolean
  label: string
  confirmMessage: string
}

export function StatusToggleButton({ action, isActive, label, confirmMessage }: StatusToggleButtonProps) {
  const dialog = useDialog()
  const formRef = useRef<HTMLFormElement>(null)

  // Ver DeleteButton: o modal é assíncrono, então cancelamos o submit e reenviamos o form
  // depois da confirmação, em vez de barrar no clique como o confirm() nativo fazia.
  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    const confirmado = await dialog.confirm({
      title: isActive ? 'Desativar registro' : 'Ativar registro',
      message: confirmMessage,
      type: isActive ? 'danger' : 'default',
      confirmLabel: label,
    })
    if (confirmado) {
      formRef.current?.requestSubmit()
    }
  }

  return (
    <form action={action} ref={formRef}>
      <button
        type="submit"
        className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-black uppercase tracking-tighter transition-all shadow-sm ${
          isActive
            ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30'
            : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/30'
        }`}
        onClick={handleClick}
      >
        {isActive ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
        {label}
      </button>
    </form>
  )
}
