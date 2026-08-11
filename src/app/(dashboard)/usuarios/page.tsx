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

  const isAuthorized = profile?.role === 'super_admin'

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

  // 6. Fetch active servers to link (with cargo and lotacao info)
  const { data: servidoresRaw } = await supabase
    .from('servidores')
    .select(`
      id, nome, email, matricula, cpf, cargo, vinculo, unidade_id, setor_id,
      unidades(nome),
      setores(dicionario_setores(nome))
    `)
    .eq('status', 'Ativo')
    .order('nome')

  const servidores = servidoresRaw?.map((s: any) => ({
    id: s.id,
    nome: s.nome,
    email: s.email,
    matricula: s.matricula,
    cpf: s.cpf,
    cargo: s.cargo,
    vinculo: s.vinculo,
    unidade_nome: s.unidades?.nome || null,
    setor_nome: (s.setores as any)?.dicionario_setores?.nome || null,
  })) || []

  // 4. Merge profiles with auth data and link server details (cargo, vinculo, lotacao)
  const profilesWithEmail = authUsers.map(u => {
    const p = profiles?.find(profile => profile.id === u.id)
    const emailStr = (u.email || '').toLowerCase().trim()
    const nameStr = (p?.full_name || u.user_metadata?.full_name || '').toLowerCase().trim()
    
    const matchedServidor = servidores.find((s: any) => {
      if (s.email && emailStr && s.email.toLowerCase().trim() === emailStr) return true
      if (s.nome && nameStr && s.nome.toLowerCase().trim() === nameStr) return true
      return false
    })

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
      ativo: p ? (p.ativo !== false) : false,
      cargo: matchedServidor?.cargo || null,
      vinculo: matchedServidor?.vinculo || null,
      lotacao_unidade: matchedServidor?.unidade_nome || null,
      lotacao_setor: matchedServidor?.setor_nome || null,
      servidor_id: matchedServidor?.id || null,
    }
  }).sort((a, b) => a.full_name.localeCompare(b.full_name))

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
        servidores={servidores || []}
      />
    </div>
  )
}
