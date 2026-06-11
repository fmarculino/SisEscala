import { createClient } from '@/utils/supabase/server'
import { StatusToggle } from '@/components/servidores/StatusToggle'
import { EditServidorForm } from './EditServidorForm'
import { ArrowLeft, Info } from 'lucide-react'
import Link from 'next/link'
import { applyAccessFilters } from '@/utils/permissions'

export default async function EditServidorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  // Fetch profile with permissions
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
    .eq('id', user?.id)
    .single()

  const userProfile = profile ? {
    ...profile,
    permitted_unidades: profile.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: profile.profile_setores?.map((ps: any) => ps.setor_id) || []
  } : null

  const { data: servidor } = await supabase
    .from('servidores')
    .select('*')
    .eq('id', id)
    .single()

  // Fetch Units with access filter
  let unitsQuery = supabase
    .from('unidades')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome')
  
  unitsQuery = applyAccessFilters(unitsQuery, userProfile, { unidadeField: 'id' })
  const { data: unidades } = await unitsQuery

  // Fetch Sectors with access filter
  let sectorsQuery = supabase
    .from('setores')
    .select('id, unidade_id, dicionario_setores(nome)')
    .eq('ativo', true)

  sectorsQuery = applyAccessFilters(sectorsQuery, userProfile)
  const { data: sectorsRaw } = await sectorsQuery
  const setores = (sectorsRaw as any[])?.map(s => {
    const dictData = Array.isArray(s.dicionario_setores) 
      ? s.dicionario_setores[0] 
      : s.dicionario_setores
      
    return {
      ...s,
      nome: dictData?.nome || 'SETOR SEM NOME'
    }
  }) || []

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
          isSuperAdmin={userProfile?.role === 'super_admin'}
        />
      </div>
    </div>
  )
}
