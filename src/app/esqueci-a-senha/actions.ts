'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

export async function resetPassword(formData: FormData) {
  const email = formData.get('email') as string
  const supabase = await createClient()

  // No redirect in resetPasswordForEmail natively that returns an error cleanly without try catch if relying on return
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/resetar-senha`,
  })

  if (error) {
    return { error: error.message }
  }

  return { success: true }
}
