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

  const parseStaffingField = (val: any) => {
    if (val === null || val === undefined || val === '') return null
    const p = parseInt(val, 10)
    return isNaN(p) ? null : p
  }

  const servidores_manha_min = parseStaffingField(formData.get('servidores_manha_min'))
  const servidores_manha_ideal = parseStaffingField(formData.get('servidores_manha_ideal'))
  const servidores_manha_max = parseStaffingField(formData.get('servidores_manha_max'))

  const servidores_tarde_min = parseStaffingField(formData.get('servidores_tarde_min'))
  const servidores_tarde_ideal = parseStaffingField(formData.get('servidores_tarde_ideal'))
  const servidores_tarde_max = parseStaffingField(formData.get('servidores_tarde_max'))

  const servidores_noite_min = parseStaffingField(formData.get('servidores_noite_min'))
  const servidores_noite_ideal = parseStaffingField(formData.get('servidores_noite_ideal'))
  const servidores_noite_max = parseStaffingField(formData.get('servidores_noite_max'))

  const dimensionamento_fds_feriados = formData.get('dimensionamento_fds_feriados') === 'true'

  const latitude = formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : null
  const longitude = formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : null
  const raio_geofence = (latitude !== null && longitude !== null && formData.get('raio_geofence')) ? parseInt(formData.get('raio_geofence') as string) : null

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
    logo_url,
    servidores_manha_min,
    servidores_manha_ideal,
    servidores_manha_max,
    servidores_tarde_min,
    servidores_tarde_ideal,
    servidores_tarde_max,
    servidores_noite_min,
    servidores_noite_ideal,
    servidores_noite_max,
    dimensionamento_fds_feriados,
    latitude,
    longitude,
    raio_geofence
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

  const parseStaffingField = (val: any) => {
    if (val === null || val === undefined || val === '') return null
    const p = parseInt(val, 10)
    return isNaN(p) ? null : p
  }

  const servidores_manha_min = parseStaffingField(formData.get('servidores_manha_min'))
  const servidores_manha_ideal = parseStaffingField(formData.get('servidores_manha_ideal'))
  const servidores_manha_max = parseStaffingField(formData.get('servidores_manha_max'))

  const servidores_tarde_min = parseStaffingField(formData.get('servidores_tarde_min'))
  const servidores_tarde_ideal = parseStaffingField(formData.get('servidores_tarde_ideal'))
  const servidores_tarde_max = parseStaffingField(formData.get('servidores_tarde_max'))

  const servidores_noite_min = parseStaffingField(formData.get('servidores_noite_min'))
  const servidores_noite_ideal = parseStaffingField(formData.get('servidores_noite_ideal'))
  const servidores_noite_max = parseStaffingField(formData.get('servidores_noite_max'))

  const dimensionamento_fds_feriados = formData.get('dimensionamento_fds_feriados') === 'true'

  const latitude = formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : null
  const longitude = formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : null
  const raio_geofence = (latitude !== null && longitude !== null && formData.get('raio_geofence')) ? parseInt(formData.get('raio_geofence') as string) : null

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
    servidores_manha_min,
    servidores_manha_ideal,
    servidores_manha_max,
    servidores_tarde_min,
    servidores_tarde_ideal,
    servidores_tarde_max,
    servidores_noite_min,
    servidores_noite_ideal,
    servidores_noite_max,
    dimensionamento_fds_feriados,
    latitude,
    longitude,
    raio_geofence
  }

  const removeLogo = formData.get('remove_logo') === 'true'
  if (removeLogo) {
    updateData.logo_url = null
  } else {
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


