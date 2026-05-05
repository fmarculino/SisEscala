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

  const { error } = await supabase.from('unidades').insert({
    nome,
    endereco,
    latitude,
    longitude,
    raio_geofence
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

  const { error } = await supabase
    .from('unidades')
    .update({
      nome,
      endereco,
      latitude,
      longitude,
      raio_geofence
    })
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/unidades')
  redirect('/unidades')
}

export async function deleteUnidade(id: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('unidades')
    .delete()
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/unidades')
  redirect('/unidades')
}
