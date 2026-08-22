'use server'

import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { registrarLog, calcularAlteracoes } from '@/utils/auditoria'

const AUTH_ERRORS_PT: Record<string, string> = {
  'User already registered': 'Este e-mail já está cadastrado no sistema.',
  'Password should be at least 6 characters': 'A senha deve ter pelo menos 6 caracteres.',
  'Invalid email': 'E-mail inválido.',
  'Email not confirmed': 'E-mail ainda não confirmado.',
  'New password should be different from the old password': 'A nova senha deve ser diferente da senha atual.',
  'To lookup a user by their email, the service role key is required': 'Erro de permissão no servidor.',
  'User not found': 'Usuário não encontrado.',
}

function translateError(error: string): string {
  return AUTH_ERRORS_PT[error] || error
}

// Um servidor tem no maximo um usuario do sistema (indice uq_profiles_servidor_id, migration
// 20260822100000). A UI ja evita oferecer um servidor ocupado, mas a action e chamavel direto —
// mesma licao da armadilha 12 do CLAUDE.md: tela filtrada nao protege a RPC/action.
async function validarServidorLivre(
  supabaseAdmin: any,
  servidorId: string,
  ignorarProfileId: string | null
): Promise<string | null> {
  let q = supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .eq('servidor_id', servidorId)

  if (ignorarProfileId) q = q.neq('id', ignorarProfileId)

  const { data: ocupado } = await q.maybeSingle()

  if (ocupado) {
    return `Este servidor ja esta vinculado ao usuario "${ocupado.full_name || 'sem nome'}". ` +
      'Desvincule-o daquele usuario antes de vincular a este.'
  }
  return null
}

export async function createUser(formData: FormData) {
  const email = formData.get('email') as string
  const fullName = formData.get('full_name') as string
  const role = formData.get('role') as string
  const password = formData.get('password') as string || 'sisEscala2026'
  // Vinculo com o cadastro de servidor. Ate 22/08/2026 este campo chegava no FormData e nenhuma
  // action o lia: escolher o servidor so autopreenchia nome/e-mail na tela e nada era gravado.
  // Sem ele, a unica ponte entre usuario e servidor era casar por e-mail ou por nome iguais — e
  // era isso que quebrava quando o e-mail do cadastro do servidor era corrigido depois.
  const servidorId = (formData.get('servidor_id') as string) || null
  
  // Multiple assignments
  const unidadeIds = formData.getAll('unidade_ids') as string[]
  const setorIds = formData.getAll('setor_ids') as string[]
  const acessoTodasUnidades = formData.get('acesso_todas_unidades') === 'true'
  // RH da Unidade sempre enxerga todos os setores das unidades vinculadas — nunca setor por
  // setor (é a diferença dele pro RH Geral: unidade sim, setor não). Forçado aqui, não só no
  // client, porque a action é chamável direto. Ver src/utils/permissions.ts (applyAccessFilters)
  // e a migration 20260812070000 — as duas camadas dependem dessa flag pra esse papel.
  const acessoTodosSetores = role === 'rh_unidade' ? true : formData.get('acesso_todos_setores') === 'true'

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Chave SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' }
  }

  const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Conferir ANTES de criar no Auth: o profile so e atualizado no passo 2, e falhar la deixaria
  // um usuario de autenticacao orfao (sem perfil) para tras.
  if (servidorId) {
    const erroVinculo = await validarServidorLivre(supabaseAdmin, servidorId, null)
    if (erroVinculo) return { error: erroVinculo }
  }

  // 1. Create user in Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName }
  })

  if (authError) return { error: translateError(authError.message) }

  if (authData.user) {
    // 2. Update profile basic info and flags
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({
        role: role,
        acesso_todas_unidades: acessoTodasUnidades,
        acesso_todos_setores: acessoTodosSetores,
        servidor_id: servidorId,
        ativo: true
      })
      .eq('id', authData.user.id)

    if (profileError) return { error: translateError(profileError.message) }

    // 3. Insert multiple unit assignments
    if (!acessoTodasUnidades && unidadeIds.length > 0) {
      const unitInserts = unidadeIds.map(uId => ({ profile_id: authData.user.id, unidade_id: uId }))
      await supabaseAdmin.from('profile_unidades').insert(unitInserts)
    }

    // 4. Insert multiple sector assignments
    if (!acessoTodosSetores && setorIds.length > 0) {
      const sectorInserts = setorIds.map(sId => ({ profile_id: authData.user.id, setor_id: sId }))
      await supabaseAdmin.from('profile_setores').insert(sectorInserts)
    }
  }

  revalidatePath('/usuarios')
  return { success: true }
}

export async function updateUser(formData: FormData) {
  const userId = formData.get('userId') as string
  const fullName = formData.get('full_name') as string
  const role = formData.get('role') as string
  // Vincular na EDICAO tambem, nao so na criacao: sem isso as contas que ja existiam (e as
  // criadas antes de 22/08/2026, quando nada era gravado) ficariam para sempre sem vinculo, e
  // justamente elas sao as que precisam dele. Campo ausente no FormData = nao mexer no vinculo.
  const temCampoServidor = formData.has('servidor_id')
  const servidorId = (formData.get('servidor_id') as string) || null
  
  // Multiple assignments
  const unidadeIds = formData.getAll('unidade_ids') as string[]
  const setorIds = formData.getAll('setor_ids') as string[]
  const acessoTodasUnidades = formData.get('acesso_todas_unidades') === 'true'
  // RH da Unidade sempre enxerga todos os setores das unidades vinculadas — ver mesmo comentário
  // em createUser.
  const acessoTodosSetores = role === 'rh_unidade' ? true : formData.get('acesso_todos_setores') === 'true'

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Chave SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' }
  }

  const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Estado ANTES da alteração. Conceder `acesso_todas_unidades` amplia o alcance de uma pessoa
  // sobre os dados de 183 servidores — e até aqui isso não deixava rastro nenhum. É o item mais
  // clássico de qualquer auditoria de sistema, e o único que responde "quem deu esse acesso".
  const { data: perfilAntes } = await supabaseAdmin
    .from('profiles')
    .select('full_name, role, acesso_todas_unidades, acesso_todos_setores, servidor_id')
    .eq('id', userId)
    .maybeSingle()

  const { data: unidadesAntes } = await supabaseAdmin
    .from('profile_unidades').select('unidade_id').eq('profile_id', userId)
  const { data: setoresAntes } = await supabaseAdmin
    .from('profile_setores').select('setor_id').eq('profile_id', userId)

  if (temCampoServidor && servidorId && servidorId !== perfilAntes?.servidor_id) {
    const erroVinculo = await validarServidorLivre(supabaseAdmin, servidorId, userId)
    if (erroVinculo) return { error: erroVinculo }
  }

  // 1. Update Auth user metadata
  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: { full_name: fullName }
  })

  if (authError) return { error: translateError(authError.message) }

  // 2. Update profile basic info
  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({
      full_name: fullName,
      role: role,
      acesso_todas_unidades: acessoTodasUnidades,
      acesso_todos_setores: acessoTodosSetores,
      ...(temCampoServidor ? { servidor_id: servidorId } : {}),
    })
    .eq('id', userId)

  if (profileError) return { error: translateError(profileError.message) }

  // 3. Sync Units (Delete old, Insert new)
  await supabaseAdmin.from('profile_unidades').delete().eq('profile_id', userId)
  if (!acessoTodasUnidades && unidadeIds.length > 0) {
    const unitInserts = unidadeIds.map(uId => ({ profile_id: userId, unidade_id: uId }))
    await supabaseAdmin.from('profile_unidades').insert(unitInserts)
  }

  // 4. Sync Sectors (Delete old, Insert new)
  await supabaseAdmin.from('profile_setores').delete().eq('profile_id', userId)
  if (!acessoTodosSetores && setorIds.length > 0) {
    const sectorInserts = setorIds.map((sId: string) => ({ profile_id: userId, setor_id: sId }))
    await supabaseAdmin.from('profile_setores').insert(sectorInserts)
  }

  // Mudança de papel ganha ação própria: um coordenador virando admin não é a mesma coisa que
  // corrigir a grafia de um nome, e numa lista cronológica as duas ficariam indistinguíveis.
  const antes = {
    ...perfilAntes,
    servidor_id: perfilAntes?.servidor_id ?? null,
    unidades: (unidadesAntes || []).map(u => u.unidade_id).sort(),
    setores: (setoresAntes || []).map(s => s.setor_id).sort(),
  }
  const depois = {
    full_name: fullName,
    role,
    servidor_id: temCampoServidor ? servidorId : (perfilAntes?.servidor_id ?? null),
    acesso_todas_unidades: acessoTodasUnidades,
    acesso_todos_setores: acessoTodosSetores,
    unidades: acessoTodasUnidades ? [] : [...unidadeIds].sort(),
    setores: acessoTodosSetores ? [] : [...setorIds].sort(),
  }
  const alteracoes = calcularAlteracoes(antes, depois)

  if (Object.keys(alteracoes).length > 0) {
    const mudouPapel = 'role' in alteracoes
    const mudouEscopo = ['acesso_todas_unidades', 'acesso_todos_setores', 'unidades', 'setores']
      .some(c => c in alteracoes)
    await registrarLog({
      acao: mudouPapel ? 'USUARIO_PAPEL_ALTERADO'
          : mudouEscopo ? 'USUARIO_PERMISSOES_ALTERADAS'
          : 'USUARIO_EDITADO',
      entidade: 'profile',
      entidadeId: userId,
      userId: (await (await createClient()).auth.getUser()).data.user?.id || null,
      alteracoes,
      detalhes: { alvo: fullName },
    })
  }

  revalidatePath('/usuarios')
  return { success: true }
}

export async function resetPassword(userId: string, newPassword: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Chave SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' }
  }

  const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword
  })

  if (error) {
    return { error: translateError(error.message) }
  }

  // Registra QUE a senha mudou, jamais qual. O log precisa provar a troca e não pode contê-la.
  await registrarLog({
    acao: 'USUARIO_SENHA_REDEFINIDA',
    entidade: 'profile',
    entidadeId: userId,
    userId: (await (await createClient()).auth.getUser()).data.user?.id || null,
    alteracoes: { senha: { de: '(omitido)', para: '(omitido)' } },
  })

  return { success: true }
}

export async function deleteUser(userId: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Chave SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' }
  }

  const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Auth delete will trigger profile delete if FK is set to cascade, 
  // but we should delete user from Auth first.
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)

  if (error) {
    return { error: translateError(error.message) }
  }

  revalidatePath('/usuarios')
  return { success: true }
}

export async function toggleUserStatus(userId: string, currentStatus: boolean) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Chave SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' }
  }

  const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ ativo: !currentStatus })
    .eq('id', userId)

  if (error) {
    return { error: translateError(error.message) }
  }

  // Inativar um usuário retira o acesso dele ao sistema inteiro. Reativar devolve.
  await registrarLog({
    acao: 'USUARIO_STATUS_ALTERADO',
    entidade: 'profile',
    entidadeId: userId,
    userId: (await (await createClient()).auth.getUser()).data.user?.id || null,
    alteracoes: { ativo: { de: currentStatus, para: !currentStatus } },
  })

  revalidatePath('/usuarios')
  return { success: true }
}
