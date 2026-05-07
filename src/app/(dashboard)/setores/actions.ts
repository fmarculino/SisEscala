'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function createSetor(formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const unidade_id = formData.get('unidade_id') as string
  const parent_id = formData.get('parent_id') as string

  const { error } = await supabase.from('setores').insert({
    nome,
    unidade_id,
    parent_id: parent_id || null,
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/setores')
  redirect('/setores')
}

export async function updateSetor(id: string, formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const unidade_id = formData.get('unidade_id') as string
  const parent_id = formData.get('parent_id') as string

  const { error } = await supabase
    .from('setores')
    .update({
      nome,
      unidade_id,
      parent_id: parent_id || null,
    })
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/setores')
  redirect('/setores')
}

export async function toggleStatusSetor(id: string, currentStatus: boolean) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('setores')
    .update({ ativo: !currentStatus })
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/setores')
  redirect('/setores')
}
