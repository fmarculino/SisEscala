import { createClient } from '@/utils/supabase/server'
import { Building2, Plus, MapPin } from 'lucide-react'
import Link from 'next/link'

export default async function UnidadesPage() {
  const supabase = await createClient()
  const { data: unidades, error } = await supabase
    .from('unidades')
    .select('*')
    .order('nome')

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Unidades</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Gerencie as unidades de saúde e laboratórios.
          </p>
        </div>
        <Link
          href="/unidades/nova"
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-all"
        >
          <Plus className="mr-2 h-4 w-4" />
          Nova Unidade
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {unidades?.map((unidade) => (
          <div
            key={unidade.id}
            className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center space-x-4">
              <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20 text-blue-600">
                <Building2 className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">{unidade.nome}</h3>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex items-center text-sm text-zinc-500 dark:text-zinc-400">
                <MapPin className="mr-2 h-4 w-4" />
                {unidade.endereco || 'Endereço não informado'}
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <Link
                href={`/unidades/${unidade.id}`}
                className="text-sm font-medium text-blue-600 hover:text-blue-500"
              >
                Editar
              </Link>
            </div>
          </div>
        ))}

        {(!unidades || unidades.length === 0) && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-200 p-12 dark:border-zinc-800">
            <Building2 className="h-12 w-12 text-zinc-300" />
            <p className="mt-4 text-zinc-500">Nenhuma unidade cadastrada ainda.</p>
          </div>
        )}
      </div>
    </div>
  )
}
