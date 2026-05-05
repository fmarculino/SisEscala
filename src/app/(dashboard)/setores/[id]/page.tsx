import { createClient } from '@/utils/supabase/server'
import { updateSetor, deleteSetor } from '../actions'
import { DeleteButton } from '@/components/ui/DeleteButton'
import { ArrowLeft, Save, Layers } from 'lucide-react'
import Link from 'next/link'

export default async function EditSetorPage({
  params,
}: {
  params: { id: string }
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: setor } = await supabase
    .from('setores')
    .select('*')
    .eq('id', id)
    .single()

  const { data: unidades } = await supabase
    .from('unidades')
    .select('id, nome')
    .order('nome')

  const { data: setoresPai } = await supabase
    .from('setores')
    .select('id, nome')
    .neq('id', id) // Can't be parent of itself
    .order('nome')

  if (!setor) {
    return <div>Setor não encontrado</div>
  }

  const updateWithId = updateSetor.bind(null, id)
  const deleteWithId = deleteSetor.bind(null, id)

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
        <DeleteButton 
          action={deleteWithId} 
          label="Excluir Setor" 
          confirmMessage="Deseja realmente excluir este setor? Isso afetará escalas vinculadas."
        />
      </div>

      <div className="rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center space-x-4 mb-6">
          <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20 text-blue-600">
            <Layers className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold">Configurar Setor: {setor.nome}</h1>
        </div>
        
        <form action={updateWithId} className="space-y-6">
          <div className="space-y-4">
            <div>
              <label htmlFor="nome" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Nome do Setor
              </label>
              <input
                type="text"
                name="nome"
                id="nome"
                defaultValue={setor.nome}
                required
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
                defaultValue={setor.unidade_id}
                required
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              >
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
                defaultValue={setor.parent_id || ''}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Nenhum (Este é um setor principal)</option>
                {setoresPai?.map((s) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              className="flex w-full justify-center items-center rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 transition-all"
            >
              <Save className="mr-2 h-4 w-4" />
              Salvar Alterações
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
