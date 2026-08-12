'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

/**
 * Mostra um UUID (terminal_id / dispositivo_id) com botão de copiar. Existe porque o
 * config.yaml do coletor-rep precisa desse id, e antes disso a única forma de descobri-lo era
 * pedir pra alguém consultar o banco direto — nada na tela mostrava o valor. O botão "Baixar
 * aplicativo" já preenche isso sozinho; este id só importa pra quem for editar um config.yaml
 * na mão (diagnóstico, ou uma instalação feita antes desse botão existir).
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
      title="Identificador técnico deste registro no banco de dados — só necessário se você for editar o config.yaml do coletor-rep manualmente. O botão 'Baixar aplicativo' já preenche isso sozinho."
      className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
    >
      <span className="uppercase tracking-wide text-zinc-400">ID técnico:</span>
      {id}
      {copiado ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}
