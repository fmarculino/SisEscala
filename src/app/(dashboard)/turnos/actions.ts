'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function createTurno(formData: FormData) {
  const supabase = await createClient()

  const codigo = formData.get('codigo') as string
  const descricao = formData.get('descricao') as string
  const horas_computadas = parseFloat(formData.get('horas_computadas') as string)
  const tipoOptions = formData.getAll('tipo_options') as string[]
  const tipo = tipoOptions.join(',') || 'Normal'

  // Vazio = nao regulamentado -> vale o piso legal de fn_intervalo_minimo_legal (CLT Art. 71).
  // NUNCA gravar 0 no lugar de NULL: 0 e "sem intervalo, decidido", e o GREATEST do banco trata
  // os dois igual hoje, mas a distincao e o que permite o piso subir sem reescrever cadastro.
  const intervaloBruto = (formData.get('intervalo_minutos') as string | null)?.trim()
  const intervalo_minutos = intervaloBruto ? parseInt(intervaloBruto, 10) : null

  const { error } = await supabase.from('dicionario_turnos').insert({
    codigo,
    descricao,
    horas_computadas,
    tipo,
    intervalo_minutos,
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
  const tipoOptions = formData.getAll('tipo_options') as string[]
  const tipo = tipoOptions.join(',') || 'Normal'

  // Vazio = nao regulamentado -> vale o piso legal de fn_intervalo_minimo_legal (CLT Art. 71).
  // NUNCA gravar 0 no lugar de NULL: 0 e "sem intervalo, decidido", e o GREATEST do banco trata
  // os dois igual hoje, mas a distincao e o que permite o piso subir sem reescrever cadastro.
  const intervaloBruto = (formData.get('intervalo_minutos') as string | null)?.trim()
  const intervalo_minutos = intervaloBruto ? parseInt(intervaloBruto, 10) : null

  const { error } = await supabase
    .from('dicionario_turnos')
    .update({
      codigo,
      descricao,
      horas_computadas,
      tipo,
      intervalo_minutos,
    })
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/turnos')
  redirect('/turnos')
}

export async function toggleStatusTurno(id: string, currentStatus: boolean) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('dicionario_turnos')
    .update({ ativo: !currentStatus })
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/turnos')
  redirect('/turnos')
}
