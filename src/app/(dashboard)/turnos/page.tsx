import { createClient } from '@/utils/supabase/server'
import { Clock, Plus, Edit2, Info } from 'lucide-react'
import Link from 'next/link'

export default async function TurnosPage() {
  const supabase = await createClient()
  const { data: turnos, error } = await supabase
    .from('dicionario_turnos')
    .select('*')
    .order('codigo')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Dicionário de Turnos</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Gerencie os códigos de escala e suas respectivas cargas horárias.
          </p>
        </div>
        <Link
          href="/turnos/novo"
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-all"
        >
          <Plus className="mr-2 h-4 w-4" />
          Novo Turno
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Código</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Descrição</th>
              <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">CH</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Tipo</th>
              <th className="relative px-4 py-3"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
            {turnos?.map((turno) => (
              <tr key={turno.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors text-sm">
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded">
                    {turno.codigo}
                  </span>
                </td>
                <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">
                  {turno.descricao}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-center font-bold">
                  {turno.horas_computadas}h
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className={`inline-flex rounded-full px-2 text-[10px] font-bold leading-5 uppercase ${
                    turno.tipo === 'Plantão' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' : 
                    turno.tipo === 'Sobreaviso' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' : 
                    'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                  }`}>
                    {turno.tipo}
                  </span>
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-right text-zinc-400">
                  <Link 
                    href={`/turnos/${turno.id}`}
                    className="hover:text-blue-600 transition-colors inline-flex items-center"
                  >
                    <Edit2 className="h-4 w-4 mr-1" />
                    <span className="text-xs">Configurar</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {(!turnos || turnos.length === 0) && (
          <div className="flex flex-col items-center justify-center p-12 text-zinc-400">
            <Clock className="h-12 w-12 opacity-20" />
            <p className="mt-4">Nenhum turno cadastrado.</p>
          </div>
        )}
      </div>
      
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-4 rounded-lg flex items-start">
        <Info className="h-5 w-5 text-blue-600 mr-3 mt-0.5" />
        <div className="text-xs text-blue-800 dark:text-blue-300">
          <strong>Dica:</strong> Os códigos de turnos são usados no grid de escalas para preenchimento rápido. 
          A carga horária (CH) é usada para o cálculo automático mensal do servidor.
        </div>
      </div>
    </div>
  )
}
