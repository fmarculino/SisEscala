import { createClient } from '@/utils/supabase/server'
import { updateUnidade, deleteUnidade } from '../actions'
import { DeleteButton } from '@/components/ui/DeleteButton'
import { ArrowLeft, Save, Building2 } from 'lucide-react'
import Link from 'next/link'
import { GeoLocationPicker } from '@/components/GeoLocationPicker'

export default async function EditUnidadePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: unidade } = await supabase
    .from('unidades')
    .select('*')
    .eq('id', id)
    .single()

  if (!unidade) {
    return <div>Unidade não encontrada</div>
  }

  const updateWithId = async (formData: FormData) => {
    'use server'
    await updateUnidade(id, formData)
  }
  const deleteWithId = async () => {
    'use server'
    await deleteUnidade(id)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <Link
          href="/unidades"
          className="flex items-center text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 transition-colors"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Link>
        <DeleteButton 
          action={deleteWithId} 
          label="Excluir Unidade" 
          confirmMessage="Deseja realmente excluir esta unidade? Isso pode afetar servidores vinculados."
        />
      </div>

      <div className="rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center space-x-4 mb-6">
          <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20 text-blue-600">
            <Building2 className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold">Editar Unidade: {unidade.nome}</h1>
        </div>
        
        <form action={updateWithId} className="space-y-6">
          <div className="space-y-4">
            <div>
              <label htmlFor="nome" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Nome da Unidade
              </label>
              <input
                type="text"
                name="nome"
                id="nome"
                defaultValue={unidade.nome}
                required
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="endereco" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Endereço
              </label>
              <input
                type="text"
                name="endereco"
                id="endereco"
                defaultValue={unidade.endereco}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <GeoLocationPicker 
              defaultLat={unidade.latitude} 
              defaultLong={unidade.longitude} 
              defaultRaio={unidade.raio_geofence} 
            />
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
