import { createClient } from '@/utils/supabase/server'
import { StatusToggle } from '@/components/servidores/StatusToggle'
import { EditServidorForm } from './EditServidorForm'
import { ArrowLeft, Info } from 'lucide-react'
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
    .eq('ativo', true)
    .order('nome')

  const { data: setores } = await supabase
    .from('setores')
    .select('id, nome, unidade_id')
    .eq('ativo', true)
    .order('nome')

  const { data: cargos } = await supabase
    .from('cargos')
    .select('*')
    .order('nome')

  if (!servidor) {
    return <div>Servidor não encontrado</div>
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <Link
          href="/servidores"
          className="flex items-center text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 transition-colors"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Link>
        <StatusToggle 
          servidorId={id} 
          currentStatus={servidor.status} 
          nome={servidor.nome} 
        />
      </div>

      <div className="space-y-6">
        {servidor.status === 'Inativo' && (
          <div className="bg-red-50 border border-red-200 dark:bg-red-900/10 dark:border-red-800 p-4 rounded-xl flex gap-3">
            <Info className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
            <div>
              <p className="text-sm font-bold text-red-800 dark:text-red-300">Servidor Inativo</p>
              <p className="text-xs text-red-700 dark:text-red-400">
                <strong>Motivo:</strong> {servidor.motivo_inativacao || 'Não informado'}
              </p>
            </div>
          </div>
        )}

        <EditServidorForm 
          id={id}
          servidor={servidor}
          unidades={unidades || []}
          setores={setores || []}
          cargos={cargos || []}
        />
      </div>
    </div>
  )
}
