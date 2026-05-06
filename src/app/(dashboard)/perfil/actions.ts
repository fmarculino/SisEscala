'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateProfile(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('full_name') as string
  
  const supabase = await createClient()

  // Update Auth Data
  const updateData: { email?: string; password?: string } = {}
  if (email) updateData.email = email
  if (password) updateData.password = password

  if (Object.keys(updateData).length > 0) {
    const { error: authError } = await supabase.auth.updateUser(updateData)
    if (authError) {
      return { error: authError.message }
    }
  }

  // Update Profile Data
  if (fullName) {
    const { data: userData } = await supabase.auth.getUser()
    if (userData.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ full_name: fullName })
        .eq('id', userData.user.id)
      
      if (profileError) {
        return { error: profileError.message }
      }
    }
  }

  revalidatePath('/perfil')
  return { success: true }
}
