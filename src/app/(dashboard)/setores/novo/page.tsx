import { createClient } from '@/utils/supabase/server'
import { ArrowLeft, Layers } from 'lucide-react'
import Link from 'next/link'
import { applyAccessFilters } from '@/utils/permissions'
import NovoSetorForm from './NovoSetorForm'

export default async function NovoSetorPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  // Fetch profile with permissions
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
    .eq('id', user?.id)
    .single()

  // Transform permissions
  const userProfile = profile ? {
    ...profile,
    permitted_unidades: profile.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: profile.profile_setores?.map((ps: any) => ps.setor_id) || []
  } : null

  // Fetch Units with access filter
  let unitsQuery = supabase
    .from('unidades')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome')
  
  unitsQuery = applyAccessFilters(unitsQuery, userProfile, { unidadeField: 'id' })
  const { data: unidades } = await unitsQuery

  // Fetch ALL sectors for suggestions and parent selection
  let allSectorsQuery = supabase
    .from('setores')
    .select('id, unidade_id, parent_id, dicionario_setores(nome)')
    .eq('ativo', true)

  allSectorsQuery = applyAccessFilters(allSectorsQuery, userProfile)
  const { data: allSectorsRaw } = await allSectorsQuery
  const setoresExistentes = allSectorsRaw?.map(s => {
    const dictData = Array.isArray(s.dicionario_setores) 
      ? s.dicionario_setores[0] 
      : s.dicionario_setores
      
    return {
      ...s,
      nome: dictData?.nome || 'SETOR SEM NOME'
    }
  }) || []

  // Fetch dictionary sectors for normalization
  const { data: dicionario } = await supabase
    .from('dicionario_setores')
    .select('id, nome')
    .order('nome')

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <Link
          href="/setores"
          className="flex items-center text-sm font-bold uppercase tracking-widest text-zinc-500 hover:text-blue-600 transition-all group"
        >
          <ArrowLeft className="mr-2 h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Voltar para Lista
        </Link>
      </div>

      <div className="rounded-[2.5rem] bg-white p-10 shadow-2xl dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/50">
        <div className="flex items-center space-x-5 mb-10">
          <div className="rounded-2xl bg-blue-600 p-4 text-white shadow-lg shadow-blue-600/30">
            <Layers className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter text-zinc-900 dark:text-white">Novo Setor</h1>
            <p className="text-sm font-medium text-zinc-500 italic">Cadastre subdivisões ou serviços especializados.</p>
          </div>
        </div>
        
        <NovoSetorForm 
          unidades={unidades || []} 
          setoresExistentes={setoresExistentes || []} 
          dicionario={dicionario || []}
        />
      </div>
    </div>
  )
}
