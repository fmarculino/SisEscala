import { createClient } from '@/utils/supabase/server'
import { ServidoresClient } from './ServidoresClient'
import { AcessoNegado } from '@/components/AcessoNegado'

import { applyAccessFilters } from '@/utils/permissions'

export default async function ServidoresPage() {
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
  
  // Fetch servers with unit and sector info - Filtered
  let serversQuery = supabase
    .from('servidores')
    .select('*, unidades(nome), setores(nome)')
    .order('nome')
  serversQuery = applyAccessFilters(serversQuery, userProfile)
  const { data: servidores } = await serversQuery

  // Fetch units and sectors for filters - Filtered
  let unitsQuery = supabase.from('unidades').select('id, nome').order('nome')
  unitsQuery = applyAccessFilters(unitsQuery, userProfile, { unidadeField: 'id' })
  const { data: unidades } = await unitsQuery

  let sectorsQuery = supabase.from('setores').select('id, nome, unidade_id').order('nome')
  sectorsQuery = applyAccessFilters(sectorsQuery, userProfile, { setorField: 'id' })
  const { data: setores } = await sectorsQuery

  return (
    <ServidoresClient 
      initialServidores={servidores || []} 
      unidades={unidades || []} 
      setores={setores || []} 
    />
  )
}
