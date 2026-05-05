import { createClient } from '@/utils/supabase/server'
import { createSetor } from '../actions'
import { ArrowLeft, Save, Layers } from 'lucide-react'
import Link from 'next/link'

export default async function NovoSetorPage() {
  const supabase = await createClient()

  const { data: unidades } = await supabase
    .from('unidades')
    .select('id, nome')
    .order('nome')

  const { data: setoresPai } = await supabase
    .from('setores')
    .select('id, nome')
    .order('nome')

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <Link
          href="/setores"
          className="flex items-center text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Link>
      </div>

      <div className="rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center space-x-4 mb-6">
          <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20 text-blue-600">
            <Layers className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold">Novo Setor ou Serviço</h1>
        </div>
        
        <form action={createSetor} className="space-y-6">
          <div className="space-y-4">
            <div>
              <label htmlFor="nome" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Nome do Setor (ex: Enfermagem, Centro Cirúrgico, Recepção)
              </label>
              <input
                type="text"
                name="nome"
                id="nome"
                required
                placeholder="Ex: Pronto Socorro"
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="unidade_id" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Unidade de Saúde
              </label>
              <select
                id="unidade_id"
                name="unidade_id"
                required
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Selecione uma unidade...</option>
                {unidades?.map((u) => (
                  <option key={u.id} value={u.id}>{u.nome}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="parent_id" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Vincular a um Setor Pai? (Opcional)
              </label>
              <select
                id="parent_id"
                name="parent_id"
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Nenhum (Este é um setor principal)</option>
                {setoresPai?.map((s) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-zinc-500 italic">
                Use isso para criar subdivisões. Ex: "Pronto Socorro" vinculado a "Enfermagem".
              </p>
            </div>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              className="flex w-full justify-center items-center rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 transition-all"
            >
              <Save className="mr-2 h-4 w-4" />
              Cadastrar Setor
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
