'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function createUnidade(formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const endereco = formData.get('endereco') as string
  const latitude = formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : null
  const longitude = formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : null
  const raio_geofence = formData.get('raio_geofence') ? parseInt(formData.get('raio_geofence') as string) : 100

  const id = crypto.randomUUID()
  const logoFile = formData.get('logo') as File | null
  let logo_url = null

  if (logoFile && logoFile.size > 0) {
    const fileExt = logoFile.name.split('.').pop()
    const fileName = `unidade_${id}.${fileExt}`
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

  const { error } = await supabase.from('unidades').insert({
    id,
    nome,
    endereco,
    latitude,
    longitude,
    raio_geofence,
    logo_url
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/unidades')
  redirect('/unidades')
}

export async function updateUnidade(id: string, formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const endereco = formData.get('endereco') as string
  const latitude = formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : null
  const longitude = formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : null
  const raio_geofence = formData.get('raio_geofence') ? parseInt(formData.get('raio_geofence') as string) : 100

  const updateData: any = {
    nome,
    endereco,
    latitude,
    longitude,
    raio_geofence
  }

  const logoFile = formData.get('logo') as File | null
  if (logoFile && logoFile.size > 0) {
    const fileExt = logoFile.name.split('.').pop()
    const fileName = `unidade_${id}.${fileExt}`
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
    .from('unidades')
    .update(updateData)
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/unidades')
  redirect('/unidades')
}

export async function toggleStatusUnidade(id: string, currentStatus: boolean) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('unidades')
    .update({ ativo: !currentStatus })
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/unidades')
  redirect('/unidades')
}
