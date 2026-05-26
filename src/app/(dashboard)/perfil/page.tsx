import { createClient } from '@/utils/supabase/server'
import { User, Shield } from 'lucide-react'
import { getRoleLabel } from '@/utils/roles'
import PerfilForm from './PerfilForm'

export default async function PerfilPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Meu Perfil</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Gerencie suas informações pessoais e credenciais de acesso.
        </p>
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-800/50">
          <h2 className="text-lg font-semibold flex items-center">
            <User className="mr-2 h-5 w-5 text-blue-600" />
            Dados da Conta
          </h2>
          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10 dark:bg-blue-900/20 dark:text-blue-400 dark:ring-blue-900/30">
            <Shield className="mr-1 h-3 w-3" />
            Nível: {getRoleLabel(profile?.role).toUpperCase()}
          </span>
        </div>

        <div className="p-6">
          <PerfilForm 
            initialFullName={profile?.full_name || ''} 
            initialEmail={user.email || ''} 
          />
        </div>
      </div>
    </div>
  )
}
