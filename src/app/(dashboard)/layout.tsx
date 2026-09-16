import { Sidebar } from '@/components/layout/sidebar'
import { AvisoVersaoDesatualizada } from '@/components/AvisoVersaoDesatualizada'
import { NotificationListener } from '@/components/NotificationListener'
import { PlanningDeadlineAlert } from '@/components/PlanningDeadlineAlert'
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
      .select('*, profile_unidades(unidade_id), setores_no_escopo')
      .eq('id', user.id)
      .single()
    
    // Transform permissions for easier access
    if (data) {
      profile = {
        ...data,
        permitted_unidades: data.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
        permitted_setores: data.setores_no_escopo || []
      }
    }
  }

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950">
      <NotificationListener />
      <PlanningDeadlineAlert userRole={profile?.role} />
      <Sidebar user={profile} />
      <main className="flex-1 overflow-y-auto">
        {/* Fica DENTRO do main, que e o elemento que rola: uma tarja `sticky` num pai sem
            scroll nao gruda em lugar nenhum e sai da tela na primeira rolagem. */}
        <AvisoVersaoDesatualizada />
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  )
}

