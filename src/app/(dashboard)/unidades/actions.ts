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
  const permite_marca_intervalo = formData.get('permite_marca_intervalo') === 'true'
  const tipo_intervalo = (formData.get('tipo_intervalo') as string) || 'flexivel'
  const tolerancia_intervalo_minutos = formData.get('tolerancia_intervalo_minutos') ? parseInt(formData.get('tolerancia_intervalo_minutos') as string) : 5

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
    logo_url,
    permite_marca_intervalo,
    tipo_intervalo,
    tolerancia_intervalo_minutos
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
  const permite_marca_intervalo = formData.get('permite_marca_intervalo') === 'true'
  const tipo_intervalo = (formData.get('tipo_intervalo') as string) || 'flexivel'
  const tolerancia_intervalo_minutos = formData.get('tolerancia_intervalo_minutos') ? parseInt(formData.get('tolerancia_intervalo_minutos') as string) : 5

  const updateData: any = {
    nome,
    endereco,
    latitude,
    longitude,
    raio_geofence,
    permite_marca_intervalo,
    tipo_intervalo,
    tolerancia_intervalo_minutos
  }

  const removeLogo = formData.get('remove_logo') === 'true'
  if (removeLogo) {
    updateData.logo_url = null
  } else {
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
  }

  const { error } = await supabase
    .from('unidades')
    .update(updateData)
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  // Processar e salvar as configurações de comunicação da unidade (se enviadas)
  const comunicacaoRaw = formData.get('configuracoes_comunicacao') as string
  if (comunicacaoRaw) {
    try {
      const parsedConfig = JSON.parse(comunicacaoRaw)
      
      // 1. Tentar salvar na coluna da tabela unidades (se a coluna existir no schema)
      try {
        await supabase.from('unidades').update({ configuracoes_comunicacao: parsedConfig }).eq('id', id)
      } catch (errCol) {
        // Ignora silenciosamente caso a coluna ainda não exista
      }

      // 2. Salvar na chave global de contingência
      await supabase.from('configuracoes_globais').upsert({
        chave: `unidade_comunicacao_${id}`,
        valor: parsedConfig,
        updated_at: new Date().toISOString()
      }, { onConflict: 'chave' })
    } catch (e) {
      console.warn('Erro ao salvar configuracoes_comunicacao da unidade:', e)
    }
  }

  revalidatePath('/unidades')
  revalidatePath(`/unidades/${id}`)
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
