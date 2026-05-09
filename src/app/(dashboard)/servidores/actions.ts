'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function createServidor(formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const matricula = formData.get('matricula') as string
  const cargo = formData.get('cargo') as string
  const vinculo = formData.get('vinculo') as any
  const unidade_id = formData.get('unidade_id') as string
  const setor_id = formData.get('setor_id') as string
  const email = formData.get('email') as string
  const telefone = formData.get('telefone') as string
  const pin_acesso = formData.get('pin_acesso') as string

  const { error } = await supabase.from('servidores').insert({
    nome,
    matricula,
    cargo,
    vinculo,
    unidade_id: unidade_id || null,
    setor_id: setor_id || null,
    email: email || null,
    telefone: telefone || null,
    pin_acesso: pin_acesso || null,
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/servidores')
  redirect('/servidores')
}

export async function importServidores(csvText: string) {
  const supabase = await createClient()
  
  // Simple CSV parser (assuming headers: nome, matricula, cargo, vinculo, unidade_nome)
  const lines = csvText.split('\n')
  const headers = lines[0].split(',')
  const servers = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',')
    if (values.length < 2) continue

    servers.push({
      nome: values[0]?.trim(),
      matricula: values[1]?.trim(),
      cargo: values[2]?.trim(),
      vinculo: values[3]?.trim() || 'Efetiva',
    })
  }

  const { error } = await supabase.from('servidores').insert(servers)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/servidores')
  return { success: true }
}

export async function updateServidor(id: string, formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const matricula = formData.get('matricula') as string
  const cargo = formData.get('cargo') as string
  const vinculo = formData.get('vinculo') as any
  const unidade_id = formData.get('unidade_id') as string
  const setor_id = formData.get('setor_id') as string
  const email = formData.get('email') as string
  const telefone = formData.get('telefone') as string
  const pin_acesso = formData.get('pin_acesso') as string

  const { error } = await supabase
    .from('servidores')
    .update({
      nome,
      matricula,
      cargo,
      vinculo,
      unidade_id: unidade_id || null,
      setor_id: setor_id || null,
      email: email || null,
      telefone: telefone || null,
      pin_acesso: pin_acesso || null,
    })
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/servidores')
  redirect('/servidores')
}

export async function toggleServidorStatus(id: string, status: 'Ativo' | 'Inativo', motivo?: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('servidores')
    .update({ 
      status,
      motivo_inativacao: status === 'Inativo' ? motivo : null
    })
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/servidores')
  return { success: true }
}
