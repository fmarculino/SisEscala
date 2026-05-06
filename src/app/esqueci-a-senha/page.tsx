'use client'

import { useState } from 'react'
import Link from 'next/link'
import { resetPassword } from './actions'

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<boolean>(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await resetPassword(formData)
    if (result?.error) {
      setError(result.error)
    } else if (result?.success) {
      setSuccess(true)
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <div className="text-center">
          <h2 className="mt-6 text-3xl font-extrabold tracking-tight text-foreground">
            Recuperar Senha
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Digite seu email para receber um link de recuperação
          </p>
        </div>

        {success ? (
          <div className="rounded-md bg-green-50 p-4 dark:bg-green-900/20 text-center">
            <p className="text-sm font-medium text-green-800 dark:text-green-400">
              Verifique sua caixa de entrada e clique no link para redefinir sua senha.
            </p>
            <Link href="/login" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400">
              Voltar ao Login
            </Link>
          </div>
        ) : (
          <form className="mt-8 space-y-6" action={handleSubmit}>
            <div className="space-y-4 rounded-md shadow-sm">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
                  placeholder="email@municipio.gov.br"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex flex-col space-y-4">
              <button
                type="submit"
                disabled={loading}
                className="group relative flex w-full justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 transition-all duration-200"
              >
                {loading ? 'Enviando...' : 'Enviar link de recuperação'}
              </button>
              <Link href="/login" className="text-center text-sm font-medium text-zinc-600 hover:text-zinc-500 dark:text-zinc-400">
                Voltar ao Login
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
