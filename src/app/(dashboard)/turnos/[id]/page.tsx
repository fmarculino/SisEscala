import { createClient } from '@/utils/supabase/server'
import { updateTurno, toggleStatusTurno } from '../actions'
import { StatusToggleButton } from '@/components/ui/StatusToggleButton'
import { ArrowLeft, Save } from 'lucide-react'
import Link from 'next/link'

export default async function EditTurnoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: turno } = await supabase
    .from('dicionario_turnos')
    .select('*')
    .eq('id', id)
    .single()

  if (!turno) {
    return <div>Turno não encontrado</div>
  }

  const updateWithId = async (formData: FormData) => {
    'use server'
    await updateTurno(id, formData)
  }
  
  const isAtivo = turno.ativo !== false

  const toggleAction = async () => {
    'use server'
    await toggleStatusTurno(id, isAtivo)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <Link
          href="/turnos"
          className="flex items-center text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 transition-colors"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Link>
        
        <StatusToggleButton 
          action={toggleAction}
          isActive={isAtivo}
          label={isAtivo ? 'Desativar Turno' : 'Reativar Turno'}
          confirmMessage={isAtivo 
            ? 'Deseja realmente desativar este turno? Ele não aparecerá mais como opção na grade de escala.' 
            : 'Deseja reativar este turno?'}
        />
      </div>

      <div className="rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <h1 className="text-2xl font-bold mb-6">Configurar Turno: {turno.codigo}</h1>
        
        <form action={updateWithId} className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="sm:col-span-1">
              <label htmlFor="codigo" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Código (ex: M, MT, S12)
              </label>
              <input
                type="text"
                name="codigo"
                id="codigo"
                defaultValue={turno.codigo}
                required
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="sm:col-span-1">
              <label htmlFor="tipo" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Tipo de Turno
              </label>
              <select
                id="tipo"
                name="tipo"
                defaultValue={turno.tipo}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="Normal">Normal</option>
                <option value="Plantão">Plantão</option>
                <option value="Sobreaviso">Sobreaviso</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="descricao" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Descrição Completa
              </label>
              <input
                type="text"
                name="descricao"
                id="descricao"
                defaultValue={turno.descricao}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="sm:col-span-1">
              <label htmlFor="horas_computadas" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Carga Horária (horas)
              </label>
              <input
                type="number"
                step="0.5"
                name="horas_computadas"
                id="horas_computadas"
                defaultValue={turno.horas_computadas}
                required
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
              />
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
