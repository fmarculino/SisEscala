'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function createServidor(formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const matricula = formData.get('matricula') as string
  const cpf = formData.get('cpf') as string
  const cargo = formData.get('cargo') as string
  const vinculo = formData.get('vinculo') as any
  const unidade_id = formData.get('unidade_id') as string
  const setor_id = formData.get('setor_id') as string
  const email = formData.get('email') as string
  const telefone = formData.get('telefone') as string
  const pin_acesso = formData.get('pin_acesso') as string

  let matriculaFinal = matricula?.trim() || ''

  if (!matriculaFinal) {
    const yearSuffix = new Date().getFullYear().toString().slice(-2)
    const prefix = `T${yearSuffix}`
    
    const { data, error: fetchError } = await supabase
      .from('servidores')
      .select('matricula')
      .like('matricula', `${prefix}%`)
      .order('matricula', { ascending: false })
      .limit(1)

    if (fetchError) {
      return { error: `Erro ao gerar matrícula temporária: ${fetchError.message}` }
    }

    let nextSeq = 1
    if (data && data.length > 0 && data[0].matricula) {
      const currentSeqStr = data[0].matricula.slice(prefix.length)
      const currentSeq = parseInt(currentSeqStr, 10)
      if (!isNaN(currentSeq)) {
        nextSeq = currentSeq + 1
      }
    }
    matriculaFinal = `${prefix}${String(nextSeq).padStart(5, '0')}`
  } else {
    // Validar unicidade de matrícula definitiva
    const { data: existing, error: checkError } = await supabase
      .from('servidores')
      .select('id')
      .eq('matricula', matriculaFinal)
      .maybeSingle()

    if (checkError) {
      return { error: `Erro ao validar matrícula: ${checkError.message}` }
    }
    if (existing) {
      return { error: 'Esta matrícula já está cadastrada para outro servidor.' }
    }
  }

  const ignora_janela_presenca = formData.has('ignora_janela_presenca') ? formData.get('ignora_janela_presenca') === 'true' : false

  const { error } = await supabase.from('servidores').insert({
    nome,
    matricula: matriculaFinal,
    cpf: cpf || null,
    cargo,
    vinculo,
    unidade_id: unidade_id || null,
    setor_id: setor_id || null,
    email: email || null,
    telefone: telefone || null,
    pin_acesso: pin_acesso || null,
    ignora_janela_presenca,
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/servidores')
  redirect('/servidores')
}

export async function importServidores(csvText: string) {
  const supabase = await createClient()
  
  // Fetch units and sectors for resolution
  const { data: unidades } = await supabase.from('unidades').select('id, nome')
  const { data: sectorsRaw } = await supabase.from('setores').select('id, unidade_id, dicionario_setores(nome)')
  const setores = sectorsRaw?.map(s => ({
    ...s,
    nome: (s as any).dicionario_setores?.nome || ''
  })) || []

  // Obter o sequencial máximo da matrícula temporária atual para evitar colisões
  const yearSuffix = new Date().getFullYear().toString().slice(-2)
  const prefix = `T${yearSuffix}`
  const { data: lastRecord } = await supabase
    .from('servidores')
    .select('matricula')
    .like('matricula', `${prefix}%`)
    .order('matricula', { ascending: false })
    .limit(1)

  let nextSeq = 1
  if (lastRecord && lastRecord.length > 0 && lastRecord[0].matricula) {
    const currentSeqStr = lastRecord[0].matricula.slice(prefix.length)
    const currentSeq = parseInt(currentSeqStr, 10)
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1
    }
  }

  // CSV parser (expected headers: nome, matricula, cargo, vinculo, email, telefone, unidade, setor)
  const lines = csvText.split('\n').filter(line => line.trim() !== '')
  const servers = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',')
    if (values.length < 2) continue

    const nome = values[0]?.trim()
    let matricula = values[1]?.trim() || ''

    if (!nome) continue

    // Se a matrícula for nula/vazia, gerar código temporário sequencial
    if (!matricula) {
      matricula = `${prefix}${String(nextSeq).padStart(5, '0')}`
      nextSeq++
    }

    const unidadeNome = values[6]?.trim()
    const setorNome = values[7]?.trim()

    const unidadeId = unidades?.find(u => u.nome.toLowerCase() === unidadeNome?.toLowerCase())?.id || null
    const setorId = setores?.find(s => s.nome.toLowerCase() === setorNome?.toLowerCase() && (unidadeId ? s.unidade_id === unidadeId : true))?.id || null

    servers.push({
      nome,
      matricula,
      cargo: values[2]?.trim(),
      vinculo: values[3]?.trim() || 'Efetiva',
      email: values[4]?.trim() || null,
      telefone: values[5]?.trim() || null,
      unidade_id: unidadeId,
      setor_id: setorId,
      status: 'Ativo'
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
  const cpf = formData.get('cpf') as string
  const cargo = formData.get('cargo') as string
  const vinculo = formData.get('vinculo') as any
  const unidade_id = formData.get('unidade_id') as string
  const setor_id = formData.get('setor_id') as string
  const email = formData.get('email') as string
  const telefone = formData.get('telefone') as string
  const pin_acesso = formData.get('pin_acesso') as string

  let matriculaFinal = matricula?.trim() || ''

  if (!matriculaFinal) {
    const yearSuffix = new Date().getFullYear().toString().slice(-2)
    const prefix = `T${yearSuffix}`
    
    const { data, error: fetchError } = await supabase
      .from('servidores')
      .select('matricula')
      .like('matricula', `${prefix}%`)
      .order('matricula', { ascending: false })
      .limit(1)

    if (fetchError) {
      return { error: `Erro ao gerar matrícula temporária: ${fetchError.message}` }
    }

    let nextSeq = 1
    if (data && data.length > 0 && data[0].matricula) {
      const currentSeqStr = data[0].matricula.slice(prefix.length)
      const currentSeq = parseInt(currentSeqStr, 10)
      if (!isNaN(currentSeq)) {
        nextSeq = currentSeq + 1
      }
    }
    matriculaFinal = `${prefix}${String(nextSeq).padStart(5, '0')}`
  } else {
    // Validar unicidade da matrícula (ignorando o registro do próprio servidor atual)
    const { data: existing, error: checkError } = await supabase
      .from('servidores')
      .select('id')
      .eq('matricula', matriculaFinal)
      .neq('id', id)
      .maybeSingle()

    if (checkError) {
      return { error: `Erro ao validar matrícula: ${checkError.message}` }
    }
    if (existing) {
      return { error: 'Esta matrícula já está cadastrada para outro servidor.' }
    }
  }

  const updateData: any = {
    nome,
    matricula: matriculaFinal,
    cpf: cpf || null,
    cargo,
    vinculo,
    unidade_id: unidade_id || null,
    setor_id: setor_id || null,
    email: email || null,
    telefone: telefone || null,
  }

  if (pin_acesso !== '****') {
    updateData.pin_acesso = pin_acesso || null
  }

  if (formData.has('ignora_janela_presenca')) {
    updateData.ignora_janela_presenca = formData.get('ignora_janela_presenca') === 'true'
  }

  const { error } = await supabase
    .from('servidores')
    .update(updateData)
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
