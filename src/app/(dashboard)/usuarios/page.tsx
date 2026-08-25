import { createClient, createAdminClient } from '@/utils/supabase/server'
import { Shield } from 'lucide-react'
import UserManagementClient from './UserManagementClient'
import { listarTodosUsuariosAuth } from '@/utils/authAdmin'
import {
  alcancaUsuario,
  ehPapelGestor,
  podeExcluirUsuarios,
  type Gestor,
} from '@/utils/gestaoUsuarios'

export default async function UsuariosPage() {
  const supabase = await createClient()
  const supabaseAdmin = await createAdminClient()

  // 1. Quem abre a tela: Administrador Geral, RH Geral e RH da Unidade (22/08/2026). Diretor,
  // Coordenador e Ass. Administrativo continuam de fora — decisão do usuário.
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user?.id)
    .single()

  const isAuthorized = !!user && ehPapelGestor(profile?.role)

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

  // 2. Escopo de quem está gerenciando. Só o RH da Unidade é limitado por unidade — para
  // Administrador Geral e RH Geral a lista fica vazia porque o alcance deles não é por unidade.
  const gestor: Gestor = { id: user.id, role: profile!.role, unidades: [] }

  if (gestor.role === 'rh_unidade') {
    const { data: vinculos } = await supabase
      .from('profile_unidades')
      .select('unidade_id')
      .eq('profile_id', user.id)
    gestor.unidades = (vinculos || []).map(v => v.unidade_id)
  }

  const escopadoPorUnidade = gestor.role === 'rh_unidade'
  // RH da Unidade sem nenhuma unidade vinculada não pode cair em "sem filtro": o `.in()` precisa
  // de uma lista, e lista vazia no PostgREST não filtra nada.
  const unidadesDoGestor = gestor.unidades.length > 0
    ? gestor.unidades
    : ['00000000-0000-0000-0000-000000000000']

  // 3. Perfis — pelo client ADMIN de propósito: a policy "Users can view own profile" só deixa o
  // super_admin ler a tabela inteira, então com a sessão do RH esta consulta devolveria uma linha
  // só (a dele). Quem restringe a lista é o filtro de escopo do passo 8, não a RLS.
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select(`
      *,
      profile_unidades(unidade_id, unidades(nome)),
      profile_setores(setor_id, setores(dicionario_setores(nome)))
    `)
    .order('full_name')

  // 3b. Contas do Auth (de onde vêm os e-mails). Paginado: `listUsers()` cru para em 50 e não
  // avisa — com 63 contas, 13 pessoas simplesmente não apareciam nesta tela.
  const authUsers = await listarTodosUsuariosAuth(supabaseAdmin)

  // 5. Unidades e setores oferecidos no formulário. O RH da Unidade só enxerga os dele — e o mapa
  // setor→unidade sai daqui, então setor de fora fica desconhecido e é tratado como fora de
  // escopo (a dúvida fecha, não abre).
  let unidadesQuery = supabase.from('unidades').select('id, nome').order('nome')
  if (escopadoPorUnidade) unidadesQuery = unidadesQuery.in('id', unidadesDoGestor)
  const { data: unidades } = await unidadesQuery

  let setoresQuery = supabase
    .from('setores')
    .select('id, unidade_id, parent_id, dicionario_setores(nome)')
  if (escopadoPorUnidade) setoresQuery = setoresQuery.in('unidade_id', unidadesDoGestor)
  const { data: sectorsRaw } = await setoresQuery

  const setores = sectorsRaw?.map(s => ({
    ...s,
    nome: (s as any).dicionario_setores?.nome || 'SETOR SEM NOME'
  })) || []

  const mapaSetorUnidade = new Map<string, string>(setores.map(s => [s.id, s.unidade_id]))

  // 6. Fetch active servers to link (with cargo and lotacao info) in chunks
  const servidoresRaw: any[] = []
  for (let from = 0; ; from += 1000) {
    let servidoresQuery = supabase
      .from('servidores')
      .select(`
        id, nome, email, matricula, cpf, cargo, vinculo, unidade_id, setor_id,
        unidades(nome),
        setores(dicionario_setores(nome))
      `)
      .eq('status', 'Ativo')
      .order('nome')
      .range(from, from + 999)
    if (escopadoPorUnidade) servidoresQuery = servidoresQuery.in('unidade_id', unidadesDoGestor)
    const { data, error } = await servidoresQuery
    if (error) {
      console.error('Erro ao carregar servidores para usuários:', error)
      break
    }
    servidoresRaw.push(...(data || []))
    if (!data || data.length < 1000) break
  }

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

  const servidoresPorId = new Map<string, any>(servidores.map(s => [s.id, s]))

  // O dropdown só oferece servidor Ativo, mas um vínculo já existente tem que ser resolvido mesmo
  // que a pessoa tenha sido inativada — senão a tela devolveria `servidor_id: null` e o próximo
  // "Salvar" do formulário de edição DESVINCULARIA sozinho, sem ninguém ter pedido.
  const idsVinculados = (profiles || []).map((p: any) => p.servidor_id).filter(Boolean)
  const idsFaltando = idsVinculados.filter((sid: string) => !servidoresPorId.has(sid))

  if (idsFaltando.length > 0) {
    const { data: extrasRaw } = await supabaseAdmin
      .from('servidores')
      .select(`
        id, nome, email, matricula, cpf, cargo, vinculo, unidade_id, setor_id,
        unidades(nome),
        setores(dicionario_setores(nome))
      `)
      .in('id', idsFaltando)

    ;(extrasRaw || []).forEach((s: any) => {
      servidoresPorId.set(s.id, {
        id: s.id,
        nome: s.nome,
        email: s.email,
        matricula: s.matricula,
        cpf: s.cpf,
        cargo: s.cargo,
        vinculo: s.vinculo,
        unidade_nome: s.unidades?.nome || null,
        setor_nome: (s.setores as any)?.dicionario_setores?.nome || null,
      })
    })
  }

  // 4. Merge profiles with auth data and link server details (cargo, vinculo, lotacao)
  //
  // A fonte do vínculo é `profiles.servidor_id` (migration 20260822100000). O casamento por e-mail
  // ou por nome iguais que existia aqui era a ÚNICA ponte, e era ele que quebrava quando alguém
  // corrigia o e-mail no cadastro do servidor — a linha perdia cargo e lotação sem nenhum aviso.
  // Ele sobrevive apenas como palpite de exibição para conta ainda não vinculada (`vinculoSugerido`),
  // nunca como vínculo: quem decide é o campo, e o campo se edita na tela.
  const profilesWithEmail = authUsers.map(u => {
    const p = profiles?.find(profile => profile.id === u.id)
    const emailStr = (u.email || '').toLowerCase().trim()
    const nameStr = (p?.full_name || u.user_metadata?.full_name || '').toLowerCase().trim()

    const servidorVinculado = p?.servidor_id ? servidoresPorId.get(p.servidor_id) : undefined

    const servidorSugerido = servidorVinculado ? undefined : servidores.find((s: any) => {
      if (s.email && emailStr && s.email.toLowerCase().trim() === emailStr) return true
      if (s.nome && nameStr && s.nome.toLowerCase().trim() === nameStr) return true
      return false
    })

    const matchedServidor = servidorVinculado || servidorSugerido

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
      // Só o vínculo de verdade volta em `servidor_id` — mandar o palpite aqui faria o formulário
      // de edição gravar como escolha do usuário algo que ninguém escolheu.
      servidor_id: p?.servidor_id || null,
      servidor_nome: matchedServidor?.nome || null,
      servidor_email: matchedServidor?.email || null,
      vinculo_sugerido_id: servidorSugerido?.id || null,
      vinculo_sugerido_nome: servidorSugerido?.nome || null,
    }
  }).sort((a, b) => a.full_name.localeCompare(b.full_name))

  // 8. O que este gestor enxerga — e, por consequência, administra: Administrador Geral nunca
  // aparece para o RH, e o RH da Unidade só alcança conta cujo escopo cabe inteiro dentro das
  // unidades dele. `alcancaUsuario` é a MESMA função que as server actions aplicam; esconder aqui
  // é conveniência de tela, a defesa está lá (action é chamável direto).
  const profilesVisiveis = profilesWithEmail.filter(p => alcancaUsuario(gestor, {
    role: p.role,
    acesso_todas_unidades: p.acesso_todas_unidades,
    permitted_unidades: p.permitted_unidades,
    permitted_setores: p.permitted_setores,
  }, mapaSetorUnidade))

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
        initialProfiles={profilesVisiveis}
        unidades={unidades || []}
        setores={setores || []}
        currentUserRole={profile!.role}
        servidores={servidores || []}
        podeExcluir={podeExcluirUsuarios(profile!.role)}
      />
    </div>
  )
}
