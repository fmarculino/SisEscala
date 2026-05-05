'use client'

import { Trash2 } from 'lucide-react'

interface DeleteButtonProps {
  action: (formData: FormData) => void
}

export function DeleteTurnoButton({ action }: DeleteButtonProps) {
  return (
    <form action={action}>
      <button
        type="submit"
        className="inline-flex items-center rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 shadow-sm hover:bg-red-100 transition-all"
        onClick={(e) => {
          if (!confirm('Deseja realmente excluir este turno?')) {
            e.preventDefault()
          }
        }}
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Excluir Turno
      </button>
    </form>
  )
}
