import { createClient } from '@/utils/supabase/server'
import UnidadesClient from './UnidadesClient'
import { AcessoNegado } from '@/components/AcessoNegado'

export default async function UnidadesPage() {
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

  return <UnidadesClient userProfile={userProfile} />
}
