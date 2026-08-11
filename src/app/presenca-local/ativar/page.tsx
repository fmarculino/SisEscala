'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, ShieldCheck, XCircle } from 'lucide-react'

/**
 * Página que o app coletor-rep abre no navegador do terminal (`terminal abrir`), com
 * `terminal_id` e `token` na query string. Ativa uma única vez — envia os dois por POST para
 * `/api/presenca-local/ativar`, que devolve um cookie httpOnly assinado, e então troca a URL
 * por `/presenca-local` (o token nunca fica navegável de volta pelo histórico).
 *
 * Não existe formulário aqui: sem `terminal_id`/`token` válidos na URL, ou se a API recusar,
 * a tela apenas explica o erro — reabrir pelo app local é o único caminho, de propósito
 * (decisão do usuário: este terminal não tem fallback de login por email/senha).
 */
export default function AtivarTerminalLocalPage() {
  return (
    <Suspense fallback={null}>
      <AtivarTerminalLocalConteudo />
    </Suspense>
  )
}

function AtivarTerminalLocalConteudo() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    const terminalId = searchParams.get('terminal_id')
    const token = searchParams.get('token')

    if (!terminalId || !token) {
      setErro('Link de ativação incompleto. Reabra pelo aplicativo local do terminal.')
      return
    }

    let vivo = true
    async function ativar() {
      try {
        const r = await fetch('/api/presenca-local/ativar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ terminal_id: terminalId, token }),
        })

        if (!vivo) return

        if (!r.ok) {
          const body = await r.json().catch(() => null)
          setErro(body?.error || 'Não foi possível ativar este terminal.')
          return
        }

        router.replace('/presenca-local')
      } catch {
        if (vivo) setErro('Falha de rede ao ativar o terminal. Confira a conexão e tente novamente.')
      }
    }

    ativar()
    return () => { vivo = false }
  }, [searchParams, router])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <div className="w-full max-w-md space-y-6 bg-white dark:bg-zinc-900 p-10 rounded-3xl shadow-2xl border border-zinc-200 dark:border-zinc-800 text-center">
        {erro ? (
          <>
            <div className="mx-auto w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-2xl flex items-center justify-center">
              <XCircle className="h-8 w-8" />
            </div>
            <h1 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">
              Não foi possível ativar
            </h1>
            <p className="text-zinc-500 text-sm">{erro}</p>
          </>
        ) : (
          <>
            <div className="mx-auto w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-2xl flex items-center justify-center">
              <ShieldCheck className="h-8 w-8" />
            </div>
            <h1 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">
              Ativando terminal…
            </h1>
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-zinc-400" />
          </>
        )}
      </div>
    </div>
  )
}
