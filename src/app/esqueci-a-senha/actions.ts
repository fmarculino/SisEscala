'use server'

import { createClient } from '@/utils/supabase/server'
import { headers } from 'next/headers'

export async function resetPassword(formData: FormData) {
  const email = formData.get('email') as string
  if (!email) {
    return { error: 'Por favor, informe o email.' }
  }

  const supabase = await createClient()
  const headersList = await headers()
  const origin = headersList.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/resetar-senha`,
  })

  if (error) {
    return { error: error.message }
  }

  return { success: true }
}
