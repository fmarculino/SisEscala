import { Sidebar } from '@/components/layout/sidebar'
import { NotificationListener } from '@/components/NotificationListener'
import { createClient } from '@/utils/supabase/server'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  let profile = null
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
      .eq('id', user.id)
      .single()
    
    // Transform permissions for easier access
    if (data) {
      profile = {
        ...data,
        permitted_unidades: data.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
        permitted_setores: data.profile_setores?.map((ps: any) => ps.setor_id) || []
      }
    }
  }

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950">
      <NotificationListener />
      <Sidebar user={profile} />
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  )
}
