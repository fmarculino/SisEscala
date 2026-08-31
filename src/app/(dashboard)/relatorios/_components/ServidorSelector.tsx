'use client'

import { User } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SelectComBusca } from '@/components/ui/SelectComBusca'

interface Props {
  servidores: any[]
  initialServidorId?: string
}

export function ServidorSelector({ servidores, initialServidorId }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleChange = (id: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (id) params.set('servidorId', id)
    else params.delete('servidorId')
    
    router.push(`?${params.toString()}`)
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl shadow-sm print:hidden">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1 relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <SelectComBusca
            value={initialServidorId || ''}
            onChange={handleChange}
            placeholder="Selecione um Servidor..."
            opcoes={servidores.map((s: any) => ({
              value: s.id,
              label: s.nome,
              detalhe: s.matricula ? `Matrícula ${s.matricula}` : 'Sem matrícula',
            }))}
            className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all appearance-none font-medium"
          />
        </div>
      </div>
    </div>
  )
}
