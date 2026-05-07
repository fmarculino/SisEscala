'use client'

import { Eye, EyeOff } from 'lucide-react'

interface StatusToggleButtonProps {
  action: () => Promise<void>
  isActive: boolean
  label: string
  confirmMessage: string
}

export function StatusToggleButton({ action, isActive, label, confirmMessage }: StatusToggleButtonProps) {
  return (
    <form action={action}>
      <button
        type="submit"
        className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-black uppercase tracking-tighter transition-all shadow-sm ${
          isActive 
            ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30' 
            : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/30'
        }`}
        onClick={(e) => {
          if (!confirm(confirmMessage)) {
            e.preventDefault()
          }
        }}
      >
        {isActive ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
        {label}
      </button>
    </form>
  )
}
