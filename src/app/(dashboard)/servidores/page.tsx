import { createClient } from '@/utils/supabase/server'
import { Users, Plus, UserCircle, Building2 } from 'lucide-react'
import Link from 'next/link'

export default async function ServidoresPage() {
  const supabase = await createClient()
  
  // Fetch servers with unit info
  const { data: servidores, error } = await supabase
    .from('servidores')
    .select('*, unidades(nome)')
    .order('nome')

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Servidores</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Gerencie o quadro de funcionários e seus vínculos.
          </p>
        </div>
        <div className="flex space-x-4">
          <Link
            href="/servidores/importar"
            className="inline-flex items-center rounded-md bg-zinc-100 dark:bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-900 dark:text-white shadow-sm hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
          >
            Importar CSV
          </Link>
          <Link
            href="/servidores/novo"
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-all"
          >
            <Plus className="mr-2 h-4 w-4" />
            Novo Servidor
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Servidor</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Matrícula</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Cargo</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Vínculo</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Unidade</th>
              <th className="relative px-6 py-3"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
            {servidores?.map((servidor) => (
              <tr key={servidor.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="h-10 w-10 flex-shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                      <UserCircle className="h-8 w-8" />
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-zinc-900 dark:text-white">{servidor.nome}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                  {servidor.matricula}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                  {servidor.cargo}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                    servidor.vinculo === 'Efetiva' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {servidor.vinculo}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                  <div className="flex items-center">
                    <Building2 className="mr-2 h-4 w-4" />
                    {servidor.unidades?.nome || 'Sem Unidade'}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <Link href={`/servidores/${servidor.id}`} className="text-blue-600 hover:text-blue-900">Editar</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {(!servidores || servidores.length === 0) && (
          <div className="flex flex-col items-center justify-center p-12 text-zinc-500 dark:text-zinc-400">
            <Users className="h-12 w-12 opacity-20" />
            <p className="mt-4">Nenhum servidor cadastrado.</p>
          </div>
        )}
      </div>
    </div>
  )
}
