'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

const AUTH_ERRORS_PT: Record<string, string> = {
  'User already registered': 'Este e-mail já está cadastrado no sistema.',
  'Password should be at least 6 characters': 'A senha deve ter pelo menos 6 caracteres.',
  'Invalid email': 'E-mail inválido.',
}

function translateError(error: string): string {
  return AUTH_ERRORS_PT[error] || error
}

export async function createSetor(formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const unidade_id = formData.get('unidade_id') as string
  const parent_id = formData.get('parent_id') as string

  // 1. Garantir que o nome existe no dicionário
  const { data: dictEntry, error: dictError } = await supabase
    .from('dicionario_setores')
    .upsert({ nome }, { onConflict: 'nome' })
    .select('id')
    .single()

  if (dictError) {
    return { error: 'Erro ao processar dicionário de setores: ' + dictError.message }
  }

  const id = crypto.randomUUID()
  const logoFile = formData.get('logo') as File | null
  let logo_url = null

  if (logoFile && logoFile.size > 0) {
    const fileExt = logoFile.name.split('.').pop()
    const fileName = `setor_${id}.${fileExt}`
    const buffer = Buffer.from(await logoFile.arrayBuffer())

    const { error: uploadError } = await supabase.storage
      .from('logos')
      .upload(fileName, buffer, {
        contentType: logoFile.type,
        upsert: true
      })

    if (uploadError) {
      return { error: 'Erro ao fazer upload do logo: ' + uploadError.message }
    }

    const { data: { publicUrl } } = supabase.storage
      .from('logos')
      .getPublicUrl(fileName)

    logo_url = publicUrl
  }

  // 2. Inserir o setor vinculado ao dicionário
  const { error } = await supabase.from('setores').insert({
    id,
    unidade_id,
    dicionario_setor_id: dictEntry.id,
    parent_id: parent_id || null,
    logo_url
  })

  if (error) {
    return { error: translateError(error.message) }
  }

  revalidatePath('/setores')
  redirect('/setores')
}

export async function updateSetor(id: string, formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const unidade_id = formData.get('unidade_id') as string
  const parent_id = formData.get('parent_id') as string

  // 1. Garantir que o nome existe no dicionário
  const { data: dictEntry, error: dictError } = await supabase
    .from('dicionario_setores')
    .upsert({ nome }, { onConflict: 'nome' })
    .select('id')
    .single()

  if (dictError) {
    return { error: 'Erro ao processar dicionário de setores: ' + dictError.message }
  }

  const updateData: any = {
    unidade_id,
    dicionario_setor_id: dictEntry.id,
    parent_id: parent_id || null,
  }

  const logoFile = formData.get('logo') as File | null
  if (logoFile && logoFile.size > 0) {
    const fileExt = logoFile.name.split('.').pop()
    const fileName = `setor_${id}.${fileExt}`
    const buffer = Buffer.from(await logoFile.arrayBuffer())

    const { error: uploadError } = await supabase.storage
      .from('logos')
      .upload(fileName, buffer, {
        contentType: logoFile.type,
        upsert: true
      })

    if (uploadError) {
      return { error: 'Erro ao fazer upload do logo: ' + uploadError.message }
    }

    const { data: { publicUrl } } = supabase.storage
      .from('logos')
      .getPublicUrl(fileName)

    updateData.logo_url = publicUrl
  }

  const { error } = await supabase
    .from('setores')
    .update(updateData)
    .eq('id', id)

  if (error) {
    return { error: translateError(error.message) }
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
    return { error: translateError(error.message) }
  }

  revalidatePath('/setores')
  redirect('/setores')
}


