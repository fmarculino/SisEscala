'use client'

import { createTurno } from '../actions'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save } from 'lucide-react'

export default function NovoTurnoPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    const result = await createTurno(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center space-x-4">
        <Link
          href="/turnos"
          className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Novo Turno</h1>
      </div>

      <form action={handleSubmit} className="space-y-6 bg-white dark:bg-zinc-900 p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="codigo" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Código (Ex: M8, P12)
            </label>
            <input
              id="codigo"
              name="codigo"
              type="text"
              required
              placeholder="M8"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              Tipo de Turno (Selecione um ou mais)
            </label>
            <div className="mt-2 flex flex-wrap gap-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg">
              {['Normal', 'Plantão', 'Sobreaviso', 'Extra'].map(tipoOption => (
                <label key={tipoOption} className="inline-flex items-center cursor-pointer select-none">
                  <input
                    type="checkbox"
                    name="tipo_options"
                    value={tipoOption}
                    defaultChecked={tipoOption === 'Normal'}
                    className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500 bg-white dark:bg-zinc-900 dark:border-zinc-700 h-4 w-4"
                  />
                  <span className="ml-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">{tipoOption}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="descricao" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Descrição
            </label>
            <input
              id="descricao"
              name="descricao"
              type="text"
              placeholder="Ex: 8h Manhã - Administrativo"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div>
            <label htmlFor="horas_computadas" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Carga Horária (h)
            </label>
            <input
              id="horas_computadas"
              name="horas_computadas"
              type="number"
              step="0.5"
              required
              placeholder="8"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>
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
            {loading ? 'Salvando...' : 'Salvar Turno'}
          </button>
        </div>
      </form>
    </div>
  )
}
