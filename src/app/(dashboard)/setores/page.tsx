import { createClient } from '@/utils/supabase/server'
import { Layers, Plus, Building2, ChevronRight } from 'lucide-react'
import Link from 'next/link'

export default async function SetoresPage() {
  const supabase = await createClient()
  
  // Fetch sectors with unit and parent info
  const { data: setores, error } = await supabase
    .from('setores')
    .select('*, unidades(nome), parent:setores!parent_id(nome)')
    .order('nome')

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Setores e Serviços</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Gerencie a estrutura organizacional das unidades para as escalas.
          </p>
        </div>
        <Link
          href="/setores/novo"
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-all"
        >
          <Plus className="mr-2 h-4 w-4" />
          Novo Setor
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Setor / Serviço</th>
              <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Unidade</th>
              <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Vínculo Pai</th>
              <th className="relative px-6 py-3"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
            {setores?.map((setor) => (
              <tr key={setor.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="h-8 w-8 rounded bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 mr-3">
                      <Layers className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-bold text-zinc-900 dark:text-white">{setor.nome}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-600 dark:text-zinc-400">
                  <div className="flex items-center">
                    <Building2 className="h-4 w-4 mr-2 opacity-50" />
                    {setor.unidades?.nome}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                  {setor.parent ? (
                    <div className="flex items-center">
                      <ChevronRight className="h-3 w-3 mr-1" />
                      {setor.parent.nome}
                    </div>
                  ) : (
                    <span className="text-xs italic opacity-50">Setor Principal</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <Link href={`/setores/${setor.id}`} className="text-blue-600 hover:text-blue-900">Configurar</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {(!setores || setores.length === 0) && (
          <div className="flex flex-col items-center justify-center p-12 text-zinc-500 dark:text-zinc-400">
            <Layers className="h-12 w-12 opacity-20" />
            <p className="mt-4">Nenhum setor cadastrado.</p>
          </div>
        )}
      </div>
    </div>
  )
}
