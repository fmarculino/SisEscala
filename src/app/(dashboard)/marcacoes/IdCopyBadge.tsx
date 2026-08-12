'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

/**
 * Mostra um UUID (terminal_id / dispositivo_id) com botão de copiar. Existe porque o
 * config.yaml do coletor-rep precisa desse id, e antes disso a única forma de descobri-lo era
 * pedir pra alguém consultar o banco direto — nada na tela mostrava o valor.
 */
export function IdCopyBadge({ id }: { id: string }) {
  const [copiado, setCopiado] = useState(false)

  function copiar() {
    navigator.clipboard.writeText(id)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={copiar}
      title="Copiar id (para o config.yaml do coletor-rep)"
      className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
    >
      {id}
      {copiado ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}
