import { createClient } from '@/utils/supabase/server'
import { Calendar, Plus, ChevronRight, Layers } from 'lucide-react'
import Link from 'next/link'

export default async function EscalasPage() {
  const supabase = await createClient()
  
  // Fetch monthly scales summary - including sector info
  const { data: escalas, error } = await supabase
    .from('escala_mensal')
    .select('*, servidores(nome), unidades(nome), setores(nome)')
    .order('ano', { ascending: false })
    .order('mes', { ascending: false })

  // Group by mes/ano/unidade/setor for a cleaner list
  // Use a pipe as separator to avoid UUID hyphen issues
  const groupedKeys = Array.from(new Set(escalas?.map(e => `${e.unidade_id}|${e.setor_id}|${e.mes}|${e.ano}`)))
  
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Escalas de Serviço</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Visualize e gerencie as escalas mensais por unidade e setor.
          </p>
        </div>
        <Link
          href="/escalas/nova"
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-all"
        >
          <Plus className="mr-2 h-4 w-4" />
          Gerar Nova Escala
        </Link>
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-800/50">
          <h2 className="text-lg font-semibold flex items-center">
            <Calendar className="mr-2 h-5 w-5 text-blue-600" />
            Escalas Ativas
          </h2>
        </div>
        
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {groupedKeys.map((key) => {
            const [uId, sId, mes, ano] = key.split('|')
            const item = escalas?.find(e => 
              e.unidade_id === uId && 
              e.setor_id === sId && 
              e.mes === parseInt(mes) && 
              e.ano === parseInt(ano)
            )

            if (!item) return null

            return (
              <Link
                key={key}
                href={`/escalas/unidade/${uId}?setor=${sId}&mes=${mes}&ano=${ano}`}
                className="flex items-center justify-between p-6 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group"
              >
                <div className="flex items-center space-x-6">
                  <div className="text-center w-16">
                    <span className="block text-2xl font-bold text-blue-600 uppercase">
                      {new Date(parseInt(ano), parseInt(mes) - 1).toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}
                    </span>
                    <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 uppercase tracking-tighter">
                      {ano}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center">
                      {item.unidades?.nome}
                      <span className="mx-2 text-zinc-500 dark:text-zinc-300">•</span>
                      <span className="text-blue-600 flex items-center">
                        <Layers className="mr-1 h-4 w-4" />
                        {item.setores?.nome}
                      </span>
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Clique para gerenciar a grade de servidores e turnos
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    item.status === 'Fechada' 
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600' 
                      : 'bg-green-100 text-green-700'
                  }`}>
                    {item.status}
                  </span>
                  <ChevronRight className="h-5 w-5 text-zinc-500 dark:text-zinc-300 group-hover:text-blue-500 transition-colors" />
                </div>
              </Link>
            )
          })}

          {groupedKeys.length === 0 && (
            <div className="p-12 text-center text-zinc-500 dark:text-zinc-400">
              <Calendar className="mx-auto h-12 w-12 opacity-20 mb-4" />
              <p>Nenhuma escala gerada para os critérios selecionados.</p>
              <Link href="/escalas/nova" className="mt-4 text-sm text-blue-600 hover:underline inline-block">
                Gerar a primeira escala agora
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
