import { createClient } from '@/utils/supabase/server'
import { updateServidor, deleteServidor } from '../actions'
import { DeleteButton } from '@/components/ui/DeleteButton'
import { ArrowLeft, Save, User, Layers } from 'lucide-react'
import Link from 'next/link'

export default async function EditServidorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: servidor } = await supabase
    .from('servidores')
    .select('*')
    .eq('id', id)
    .single()

  const { data: unidades } = await supabase
    .from('unidades')
    .select('id, nome')
    .order('nome')

  const { data: setores } = await supabase
    .from('setores')
    .select('id, nome, unidades(nome)')
    .order('nome')

  if (!servidor) {
    return <div>Servidor não encontrado</div>
  }

  const updateWithId = async (formData: FormData) => {
    'use server'
    await updateServidor(id, formData)
  }
  const deleteWithId = async () => {
    'use server'
    await deleteServidor(id)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <Link
          href="/servidores"
          className="flex items-center text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 transition-colors"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Link>
        <DeleteButton 
          action={deleteWithId} 
          label="Excluir Servidor" 
          confirmMessage="Deseja realmente excluir este servidor? Ele será removido de todas as escalas."
        />
      </div>

      <div className="rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center space-x-4 mb-6">
          <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20 text-blue-600">
            <User className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold">Editar Servidor: {servidor.nome}</h1>
        </div>
        
        <form action={updateWithId} className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="nome" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Nome Completo
              </label>
              <input
                type="text"
                name="nome"
                id="nome"
                defaultValue={servidor.nome}
                required
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="matricula" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Matrícula
              </label>
              <input
                type="text"
                name="matricula"
                id="matricula"
                defaultValue={servidor.matricula}
                required
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="cargo" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Cargo
              </label>
              <input
                type="text"
                name="cargo"
                id="cargo"
                defaultValue={servidor.cargo}
                required
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="vinculo" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Vínculo
              </label>
              <select
                id="vinculo"
                name="vinculo"
                defaultValue={servidor.vinculo}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="Efetiva">Efetiva</option>
                <option value="Concursada">Concursada</option>
                <option value="Contratada">Contratada</option>
                <option value="Comissionada">Comissionada</option>
              </select>
            </div>

            <div>
              <label htmlFor="unidade_id" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Unidade de Lotação
              </label>
              <select
                id="unidade_id"
                name="unidade_id"
                defaultValue={servidor.unidade_id || ''}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Sem Unidade</option>
                {unidades?.map((u) => (
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
                defaultValue={servidor.setor_id || ''}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Sem Setor</option>
                {setores?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome} ({(s.unidades as any)?.nome || 'Sem unidade'})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                A escala será gerada com base no setor selecionado aqui.
              </p>
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
