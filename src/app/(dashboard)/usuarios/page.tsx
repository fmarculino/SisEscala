import { createClient } from '@/utils/supabase/server'
import { Users, Plus, Shield, Mail, Building2 } from 'lucide-react'
import { createUser } from './actions'

export default async function UsuariosPage() {
  const supabase = await createClient()

  // 1. Check permissions (only super_admin and admin)
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user?.id)
    .single()

  const isAuthorized = profile?.role === 'super_admin' || profile?.role === 'admin'

  // 2. Fetch users
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*, unidades(nome)')
    .order('full_name')

  // 3. Fetch units for dropdown
  const { data: unidades } = await supabase
    .from('unidades')
    .select('id, nome')
    .order('nome')

  if (!isAuthorized) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-center">
          <Shield className="mx-auto h-12 w-12 text-zinc-400" />
          <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-white">Acesso Negado</h2>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">Você não tem permissão para gerenciar usuários.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Gerenciamento de Usuários</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Crie novos acessos e defina os níveis de permissão do sistema.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Formulário de Criação */}
        <div className="lg:col-span-1">
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden sticky top-8">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
              <h2 className="text-lg font-semibold flex items-center">
                <Plus className="mr-2 h-5 w-5 text-blue-600" />
                Novo Usuário
              </h2>
            </div>
            
            <form action={createUser} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Nome Completo</label>
                <input required type="text" name="full_name" className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 py-2 px-3 text-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800" />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
                <input required type="email" name="email" className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 py-2 px-3 text-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800" />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Senha Padrão</label>
                <input required type="text" name="password" defaultValue="sisEscala2026" className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 py-2 px-3 text-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800" />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Nível de Acesso</label>
                <select required name="role" className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 py-2 px-3 text-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800">
                  <option value="comum">Comum (Apenas visualização)</option>
                  <option value="coordenador">Coordenador (Gerencia escalas do seu setor)</option>
                  <option value="admin">Administrador (Gerencia unidades e usuários)</option>
                  {profile.role === 'super_admin' && <option value="super_admin">Super Usuário (Acesso total)</option>}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Unidade Vinculada</label>
                <select name="unidade_id" className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 py-2 px-3 text-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800">
                  <option value="">Todas (Geral)</option>
                  {unidades?.map(u => (
                    <option key={u.id} value={u.id}>{u.nome}</option>
                  ))}
                </select>
              </div>

              <button type="submit" className="w-full mt-4 flex justify-center rounded-md bg-blue-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
                Cadastrar Usuário
              </button>
            </form>
          </div>
        </div>

        {/* Lista de Usuários */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
              <h2 className="text-lg font-semibold flex items-center">
                <Users className="mr-2 h-5 w-5 text-blue-600" />
                Usuários Cadastrados
              </h2>
            </div>
            
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {profiles?.map((p) => (
                <div key={p.id} className="p-6 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-bold">
                      {p.full_name?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-zinc-900 dark:text-white">{p.full_name || 'Sem nome'}</h3>
                      <div className="flex items-center text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        <Shield className="mr-1 h-3 w-3" />
                        <span className="uppercase">{p.role || 'comum'}</span>
                        {p.unidades?.nome && (
                          <>
                            <span className="mx-2">•</span>
                            <Building2 className="mr-1 h-3 w-3" />
                            {p.unidades.nome}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
