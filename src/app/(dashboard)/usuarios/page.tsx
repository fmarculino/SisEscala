import { createClient, createAdminClient } from '@/utils/supabase/server'
import { Shield } from 'lucide-react'
import UserManagementClient from './UserManagementClient'

export default async function UsuariosPage() {
  const supabase = await createClient()
  const supabaseAdmin = await createAdminClient()

  // 1. Check permissions (only super_admin and admin)
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user?.id)
    .single()

  const isAuthorized = profile?.role === 'super_admin' || profile?.role === 'admin'

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

  // 2. Fetch profiles with new multi-assignment structure
  const { data: profiles } = await supabase
    .from('profiles')
    .select(`
      *,
      profile_unidades(unidade_id, unidades(nome)),
      profile_setores(setor_id, setores(dicionario_setores(nome)))
    `)
    .order('full_name')

  // 3. Fetch auth users to get emails
  const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers()

  // 4. Merge profiles with auth data based on Auth Users (to catch orphaned accounts)
  const profilesWithEmail = authUsers.map(u => {
    const p = profiles?.find(profile => profile.id === u.id)
    return {
      id: u.id,
      email: u.email || '',
      full_name: p?.full_name || u.user_metadata?.full_name || 'Usuário Órfão (Sem Perfil)',
      role: p?.role || 'comum',
      acesso_todas_unidades: p?.acesso_todas_unidades || false,
      acesso_todos_setores: p?.acesso_todos_setores || false,
      permitted_unidades: p?.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
      permitted_setores: p?.profile_setores?.map((ps: any) => ps.setor_id) || [],
      unidades_nomes: p?.profile_unidades?.map((pu: any) => pu.unidades?.nome).filter(Boolean) || [],
      setores_nomes: p?.profile_setores?.map((ps: any) => (ps.setores as any)?.dicionario_setores?.nome).filter(Boolean) || [],
      isOrphaned: !p,
      ativo: p ? (p.ativo !== false) : false
    }
  }).sort((a, b) => a.full_name.localeCompare(b.full_name))

  // 5. Fetch units for dropdown
  const { data: unidades } = await supabase
    .from('unidades')
    .select('id, nome')
    .order('nome')

  const { data: sectorsRaw } = await supabase
    .from('setores')
    .select('id, unidade_id, parent_id, dicionario_setores(nome)')
  
  const setores = sectorsRaw?.map(s => ({
    ...s,
    nome: (s as any).dicionario_setores?.nome || 'SETOR SEM NOME'
  })) || []

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

      <UserManagementClient 
        initialProfiles={profilesWithEmail}
        unidades={unidades || []}
        setores={setores || []}
        currentUserRole={profile.role}
      />
    </div>
  )
}
