import { Shield } from 'lucide-react'

export function AcessoNegado() {
  return (
    <div className="flex h-[50vh] items-center justify-center">
      <div className="text-center">
        <Shield className="mx-auto h-12 w-12 text-zinc-400" />
        <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-white">Acesso Negado</h2>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">Você não tem permissão para acessar esta área.</p>
      </div>
    </div>
  )
}
