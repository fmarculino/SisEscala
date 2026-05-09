'use server'

import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

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

export async function createUser(formData: FormData) {
  const email = formData.get('email') as string
  const fullName = formData.get('full_name') as string
  const role = formData.get('role') as string
  const password = formData.get('password') as string || 'sisEscala2026'
  
  // Multiple assignments
  const unidadeIds = formData.getAll('unidade_ids') as string[]
  const setorIds = formData.getAll('setor_ids') as string[]
  const acessoTodasUnidades = formData.get('acesso_todas_unidades') === 'true'
  const acessoTodosSetores = formData.get('acesso_todos_setores') === 'true'

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Chave SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' }
  }

  const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

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
  
  // Multiple assignments
  const unidadeIds = formData.getAll('unidade_ids') as string[]
  const setorIds = formData.getAll('setor_ids') as string[]
  const acessoTodasUnidades = formData.get('acesso_todas_unidades') === 'true'
  const acessoTodosSetores = formData.get('acesso_todos_setores') === 'true'

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Chave SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' }
  }

  const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

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
      acesso_todos_setores: acessoTodosSetores
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

  revalidatePath('/usuarios')
  return { success: true }
}
