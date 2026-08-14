import { createClient } from '@/utils/supabase/server'
import { JustificativasClient } from './JustificativasClient'
import { AcessoNegado } from '@/components/AcessoNegado'
import { applyAccessFilters } from '@/utils/permissions'

export default async function JustificativasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return <AcessoNegado />
  }

  // Fetch profile with permissions
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), setores_no_escopo')
    .eq('id', user.id)
    .single()

  const userProfile = profile ? {
    ...profile,
    permitted_unidades: profile.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: profile.setores_no_escopo || []
  } : null

  // Fetch units filtered by permissions
  let unitsQuery = supabase.from('unidades').select('id, nome').order('nome')
  unitsQuery = applyAccessFilters(unitsQuery, userProfile, { unidadeField: 'id' })
  const { data: unidades } = await unitsQuery

  // Fetch sectors filtered by permissions
  let sectorsQuery = supabase
    .from('setores')
    .select('id, unidade_id, dicionario_setores(nome)')
  
  sectorsQuery = applyAccessFilters(sectorsQuery, userProfile, { setorField: 'id' })
  const { data: sectorsRaw } = await sectorsQuery

  const setores = sectorsRaw?.map(s => {
    const dictData = Array.isArray(s.dicionario_setores) 
      ? s.dicionario_setores[0] 
      : s.dicionario_setores
    return {
      ...s,
      nome: dictData?.nome || 'SETOR SEM NOME'
    }
  }) || []

  // Fetch servers filtered by permissions
  let serversQuery = supabase
    .from('servidores')
    .select('id, nome, matricula, unidade_id, setor_id')
    .order('nome')
  serversQuery = applyAccessFilters(serversQuery, userProfile, { unidadeField: 'unidade_id', setorField: 'setor_id' })
  const { data: servidores } = await serversQuery

  return (
    <JustificativasClient 
      unidades={unidades || []} 
      setores={setores || []} 
      servidores={servidores || []}
      userProfile={userProfile} 
    />
  )
}
