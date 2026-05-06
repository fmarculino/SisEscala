import { createClient } from '@/utils/supabase/server'
import { User, Mail, Lock, Shield } from 'lucide-react'
import { updateProfile } from './actions'

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
            Nível: {profile?.role?.toUpperCase()}
          </span>
        </div>

        <div className="p-6">
          <form action={updateProfile} className="space-y-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="full_name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Nome Completo
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-4 w-4 text-zinc-400" />
                  </div>
                  <input
                    type="text"
                    name="full_name"
                    id="full_name"
                    defaultValue={profile?.full_name || ''}
                    className="block w-full pl-10 rounded-md border border-zinc-300 bg-zinc-50 py-2 px-3 text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Email
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-4 w-4 text-zinc-400" />
                  </div>
                  <input
                    type="email"
                    name="email"
                    id="email"
                    defaultValue={user.email || ''}
                    className="block w-full pl-10 rounded-md border border-zinc-300 bg-zinc-50 py-2 px-3 text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
                <p className="mt-1 text-xs text-zinc-500">Obrigatório verificar caso seja alterado.</p>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Nova Senha (opcional)
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-zinc-400" />
                  </div>
                  <input
                    type="password"
                    name="password"
                    id="password"
                    minLength={6}
                    placeholder="••••••••"
                    className="block w-full pl-10 rounded-md border border-zinc-300 bg-zinc-50 py-2 px-3 text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
                <p className="mt-1 text-xs text-zinc-500">Deixe em branco para manter a atual.</p>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-zinc-200 dark:border-zinc-800">
              <button
                type="submit"
                className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
              >
                Salvar Alterações
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
