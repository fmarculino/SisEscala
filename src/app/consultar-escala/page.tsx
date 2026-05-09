import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import ConsultarEscalaClient from './ConsultarEscalaClient'
import { createClient, createAdminClient } from '@/utils/supabase/server'

export default async function ConsultarEscalaPage() {
  const cookieStore = await cookies()
  const servidorId = cookieStore.get('portal_servidor_id')?.value

  let servidorData = null
  if (servidorId) {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from('servidores')
      .select('id, nome, cargo, matricula')
      .eq('id', servidorId)
      .single()
    
    if (data) {
      servidorData = data
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <ConsultarEscalaClient initialServidor={servidorData} />
    </div>
  )
}
