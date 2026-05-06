'use client'

import { createServidor } from '../actions'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save, Layers } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

export default function NovoServidorPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unidades, setUnidades] = useState<any[]>([])
  const [setores, setSetores] = useState<any[]>([])
  const [selectedUnidade, setSelectedUnidade] = useState('')
  useEffect(() => {
    async function loadData() {
      const supabase = createClient()
      const { data: units } = await supabase.from('unidades').select('id, nome').order('nome')
      if (units) setUnidades(units)

      const { data: sectors } = await supabase.from('setores').select('id, nome, unidade_id').order('nome')
      if (sectors) setSetores(sectors)
    }
    loadData()
  }, [])

  const filteredSetores = selectedUnidade 
    ? setores.filter(s => s.unidade_id === selectedUnidade)
    : setores

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    const result = await createServidor(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center space-x-4">
        <Link
          href="/servidores"
          className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Novo Servidor</h1>
      </div>

      <form action={handleSubmit} className="space-y-6 bg-white dark:bg-zinc-900 p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="nome" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Nome Completo
            </label>
            <input
              id="nome"
              name="nome"
              type="text"
              required
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div>
            <label htmlFor="matricula" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Matrícula
            </label>
            <input
              id="matricula"
              name="matricula"
              type="text"
              required
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div>
            <label htmlFor="cargo" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Cargo
            </label>
            <input
              id="cargo"
              name="cargo"
              type="text"
              placeholder="Ex: ASG, Motorista"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div>
            <label htmlFor="vinculo" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Vínculo
            </label>
            <select
              id="vinculo"
              name="vinculo"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            >
              <option value="Efetiva">Efetiva</option>
              <option value="Contratada">Contratada</option>
              <option value="Concursada">Concursada</option>
              <option value="Comissionada">Comissionada</option>
            </select>
          </div>

          <div>
            <label htmlFor="unidade_id" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Unidade
            </label>
            <select
              id="unidade_id"
              name="unidade_id"
              value={selectedUnidade}
              onChange={(e) => setSelectedUnidade(e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            >
              <option value="">Selecione uma unidade</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="setor_id" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center">
              <Layers className="h-4 w-4 mr-1 text-blue-500" />
              Setor / Serviço
            </label>
            <select
              id="setor_id"
              name="setor_id"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            >
              <option value="">Selecione o setor...</option>
              {filteredSetores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome} {!selectedUnidade && `(${unidades.find(u => u.id === s.unidade_id)?.nome})`}
                </option>
              ))}
            </select>
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
            {loading ? 'Salvando...' : 'Salvar Servidor'}
          </button>
        </div>
      </form>
    </div>
  )
}
