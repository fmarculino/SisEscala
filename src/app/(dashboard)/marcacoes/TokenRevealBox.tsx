'use client'

import { useState } from 'react'
import { Copy, Check, AlertTriangle } from 'lucide-react'

/**
 * Exibe uma credencial de dispositivo (token de terminal local ou de REP) em texto claro,
 * uma única vez — o banco só guarda o sha256. Não existe outro precedente exato no projeto
 * para "segredo exibido uma vez"; reaproveita a caixa font-mono + botão copiar com feedback
 * de `AssinaturaDigitalModal.tsx` (o único copy-to-clipboard com ícone Check no repositório).
 */
export function TokenRevealBox({ token }: { token: string }) {
  const [copiado, setCopiado] = useState(false)

  function copiar() {
    navigator.clipboard.writeText(token)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div className="space-y-3">
      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
          Copie agora e configure no aplicativo local. Este valor não pode ser recuperado depois —
          gerar um novo token invalida o anterior.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-zinc-100 dark:bg-zinc-800 p-3 rounded-xl break-all text-[11px] font-mono text-zinc-800 dark:text-zinc-200">
          {token}
        </div>
        <button
          type="button"
          onClick={copiar}
          title="Copiar token"
          className="p-3 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition-opacity shrink-0"
        >
          {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
