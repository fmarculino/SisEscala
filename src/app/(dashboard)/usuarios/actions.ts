'use server'

import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

export async function createUser(formData: FormData) {
  const email = formData.get('email') as string
  const fullName = formData.get('full_name') as string
  const role = formData.get('role') as string
  const unidadeId = formData.get('unidade_id') as string
  // Default password for new users
  const password = formData.get('password') as string || 'sisEscala2026'

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Chave SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' }
  }

  // Note: To use admin features, we need the service_role key
  const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // 1. Create user in Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Auto-confirm for internally created users
    user_metadata: {
      full_name: fullName,
    }
  })

  if (authError) {
    return { error: authError.message }
  }

  // 2. The trigger should handle profile creation, but we update role/unidade
  if (authData.user) {
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({
        role: role,
        unidade_id: unidadeId || null
      })
      .eq('id', authData.user.id)

    if (profileError) {
      return { error: profileError.message }
    }
  }

  revalidatePath('/usuarios')
  return { success: true }
}
