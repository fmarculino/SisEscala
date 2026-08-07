'use client'

import { useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { useDialog } from './DialogProvider'

interface DeleteButtonProps {
  action: string | ((formData: FormData) => void | Promise<void>) | undefined
  label?: string
  confirmMessage?: string
}

export function DeleteButton({
  action,
  label = 'Excluir',
  confirmMessage = 'Deseja realmente excluir este item?'
}: DeleteButtonProps) {
  const dialog = useDialog()
  const formRef = useRef<HTMLFormElement>(null)

  // O modal é assíncrono, então não dá para barrar o submit no próprio clique como o
  // confirm() nativo fazia. Cancelamos sempre e reenviamos o form se o usuário confirmar.
  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    const confirmado = await dialog.confirm({
      title: 'Confirmar exclusão',
      message: confirmMessage,
      type: 'danger',
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
        className="inline-flex items-center rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 shadow-sm hover:bg-red-100 transition-all"
        onClick={handleClick}
      >
        <Trash2 className="mr-2 h-4 w-4" />
        {label}
      </button>
    </form>
  )
}
