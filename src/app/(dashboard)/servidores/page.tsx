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
    .select('*, unidades(nome), setores(dicionario_setores(nome))')
    .order('nome')
  
  serversQuery = applyAccessFilters(serversQuery, userProfile)
  const { data: serversRaw } = await serversQuery
  
  const servidores = serversRaw?.map(s => {
    // Handle potential array return for sector and its dictionary name
    const sectorData = Array.isArray(s.setores) ? s.setores[0] : s.setores
    const dictData = sectorData ? (Array.isArray(sectorData.dicionario_setores) 
      ? sectorData.dicionario_setores[0] 
      : sectorData.dicionario_setores) : null
      
    return {
      ...s,
      setores: sectorData ? {
        nome: dictData?.nome || 'SETOR SEM NOME'
      } : null
    }
  }) || []

  // Fetch units and sectors for filters - Filtered
  let unitsQuery = supabase.from('unidades').select('id, nome').order('nome')
  unitsQuery = applyAccessFilters(unitsQuery, userProfile, { unidadeField: 'id' })
  const { data: unidades } = await unitsQuery

  let sectorsQuery = supabase
    .from('setores')
    .select('id, unidade_id, dicionario_setores(nome)')
  
  sectorsQuery = applyAccessFilters(sectorsQuery, userProfile, { setorField: 'id' })
  const { data: sectorsRaw } = await sectorsQuery
  
  const setores = sectorsRaw?.map(s => {
    // Handle potential array return for dictionary name
    const dictData = Array.isArray(s.dicionario_setores) 
      ? s.dicionario_setores[0] 
      : s.dicionario_setores
      
    return {
      ...s,
      nome: dictData?.nome || 'SETOR SEM NOME'
    }
  }) || []

  return (
    <ServidoresClient 
      initialServidores={servidores || []} 
      unidades={unidades || []} 
      setores={setores || []} 
    />
  )
}
