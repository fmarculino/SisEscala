import { createClient } from '@/utils/supabase/server'
import SetoresClient from './SetoresClient'
import { AcessoNegado } from '@/components/AcessoNegado'

export default async function SetoresPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  // Fetch profile with permissions
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), setores_no_escopo')
    .eq('id', user?.id)
    .single()

  // Transform permissions
  const userProfile = profile ? {
    ...profile,
    permitted_unidades: profile.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: profile.setores_no_escopo || []
  } : null

  return <SetoresClient userProfile={userProfile} />
}
