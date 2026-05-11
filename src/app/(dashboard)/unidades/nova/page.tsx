'use client'

import { createUnidade } from '../actions'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save } from 'lucide-react'
import { GeoLocationPicker } from '@/components/GeoLocationPicker'

export default function NovaUnidadePage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    const result = await createUnidade(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center space-x-4">
        <Link
          href="/unidades"
          className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Nova Unidade</h1>
      </div>

      <form action={handleSubmit} className="space-y-6 bg-white dark:bg-zinc-900 p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <div className="space-y-4">
          <div>
            <label htmlFor="nome" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Nome da Unidade
            </label>
            <input
              id="nome"
              name="nome"
              type="text"
              required
              placeholder="Ex: HMM - Hospital Municipal"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div>
            <label htmlFor="endereco" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Endereço Completo
            </label>
            <input
              id="endereco"
              name="endereco"
              type="text"
              placeholder="Rua, Número, Bairro, Cidade"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <GeoLocationPicker />
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center rounded-md bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 transition-all"
          >
            <Save className="mr-2 h-4 w-4" />
            {loading ? 'Salvando...' : 'Salvar Unidade'}
          </button>
        </div>
      </form>
    </div>
  )
}
