'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

export async function login(formData: FormData) {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: error.message }
  }

  // Log successful login
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await supabase.from('logs_sistema').insert({
      user_id: user.id,
      acao: 'LOGIN',
      detalhes: { info: 'Login efetuado com sucesso' }
    })
  }

  redirect('/home')
}
