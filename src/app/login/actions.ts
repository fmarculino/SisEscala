'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { translateAuthError } from '@/utils/auth-errors'

export async function login(formData: FormData) {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: translateAuthError(error.message) }
  }

  // Log successful login
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const headerList = await headers()
    const ip = headerList.get('x-forwarded-for') || '127.0.0.1'

    await supabase.from('logs_sistema').insert({
      user_id: user.id,
      acao: 'LOGIN',
      detalhes: { 
        info: 'Login efetuado com sucesso',
        ip: ip.split(',')[0] // Get first IP if through proxy
      }
    })
  }

  redirect('/home')
}

export async function logout() {
  const supabase = await createClient()
  
  // Log logout before signing out
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const headerList = await headers()
    const ip = headerList.get('x-forwarded-for') || '127.0.0.1'

    await supabase.from('logs_sistema').insert({
      user_id: user.id,
      acao: 'LOGOUT',
      detalhes: { 
        info: 'Sessão encerrada pelo usuário',
        ip: ip.split(',')[0]
      }
    })
  }

  await supabase.auth.signOut()
  redirect('/login')
}
