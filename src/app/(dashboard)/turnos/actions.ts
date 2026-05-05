'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function createTurno(formData: FormData) {
  const supabase = await createClient()

  const codigo = formData.get('codigo') as string
  const descricao = formData.get('descricao') as string
  const horas_computadas = parseFloat(formData.get('horas_computadas') as string)
  const tipo = formData.get('tipo') as any

  const { error } = await supabase.from('dicionario_turnos').insert({
    codigo,
    descricao,
    horas_computadas,
    tipo,
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/turnos')
  redirect('/turnos')
}

export async function updateTurno(id: string, formData: FormData) {
  const supabase = await createClient()

  const codigo = formData.get('codigo') as string
  const descricao = formData.get('descricao') as string
  const horas_computadas = parseFloat(formData.get('horas_computadas') as string)
  const tipo = formData.get('tipo') as any

  const { error } = await supabase
    .from('dicionario_turnos')
    .update({
      codigo,
      descricao,
      horas_computadas,
      tipo,
    })
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/turnos')
  redirect('/turnos')
}

export async function deleteTurno(id: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('dicionario_turnos')
    .delete()
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/turnos')
  redirect('/turnos')
}
