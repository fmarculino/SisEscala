import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import ConsultarEscalaClient from './ConsultarEscalaClient'
import { createClient, createAdminClient } from '@/utils/supabase/server'
import { PORTAL_COOKIE, validarSessaoPortal } from '@/utils/portalSession'

export default async function ConsultarEscalaPage() {
  const cookieStore = await cookies()
  // ⚠️ Sessao ASSINADA. Antes esta linha lia `portal_servidor_id`, um UUID cru — bastava mandar
  // o cookie com o id de outra pessoa para a pagina renderizar o portal dela.
  const servidorId = validarSessaoPortal(cookieStore.get(PORTAL_COOKIE)?.value)

  let servidorData = null
  if (servidorId) {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from('servidores')
      .select('id, nome, cargo, matricula, unidade_id, setor_id')
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
