'use server'

import { createClient, createAdminClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'

export async function findServidorByMatricula(matricula: string) {
  const supabase = await createAdminClient()

  const { data, error } = await supabase
    .from('servidores')
    .select('id, nome')
    .eq('matricula', matricula)
    .eq('status', 'Ativo')
    .single()

  if (error || !data) {
    return { error: 'Servidor não encontrado com esta matrícula.' }
  }

  return { servidor: data }
}

export async function validatePin(servidorId: string, pin: string) {
  const supabase = await createAdminClient()

  const { data: servidor, error } = await supabase
    .from('servidores')
    .select('id, nome, pin_acesso')
    .eq('id', servidorId)
    .single()

  if (error || !servidor) {
    return { error: 'Servidor não encontrado.' }
  }

  if (!servidor.pin_acesso) {
    return { error: 'Você ainda não possui um PIN cadastrado. Solicite ao seu coordenador.' }
  }

  if (servidor.pin_acesso !== pin) {
    return { error: 'PIN incorreto. Verifique com seu coordenador.' }
  }

  // Create a temporary session cookie (valid for 4 hours)
  const cookieStore = await cookies()
  cookieStore.set('portal_servidor_id', servidor.id, {
    maxAge: 60 * 60 * 4, // 4 hours
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })

  return { success: true, nome: servidor.nome }
}

export async function getServidorEscalas(servidorId: string) {
  const supabase = await createAdminClient()

  const { data: escalas, error } = await supabase
    .from('escala_mensal')
    .select(`
      id,
      mes,
      ano,
      unidades (nome),
      setores (nome),
      unidade_id,
      setor_id
    `)
    .eq('servidor_id', servidorId)
    .eq('ativo', true)
    .order('ano', { ascending: false })
    .order('mes', { ascending: false })

  if (error) {
    return { error: error.message }
  }

  return { escalas }
}

export async function getEscalaDetails(escala: any) {
  const supabase = await createAdminClient()
  
  try {
    const { data: escalaMensalRecords } = await supabase
      .from('escala_mensal')
      .select('*, servidores(*)')
      .eq('unidade_id', escala.unidade_id)
      .eq('setor_id', escala.setor_id)
      .eq('mes', escala.mes)
      .eq('ano', escala.ano)
      .eq('ativo', true)

    if (!escalaMensalRecords) throw new Error('Escala não encontrada')

    const emIds = escalaMensalRecords.map(em => em.id)

    const { data: escalaDiaria } = await supabase
      .from('escala_diaria')
      .select('*')
      .in('escala_mensal_id', emIds)

    const { data: turnos } = await supabase.from('dicionario_turnos').select('*').eq('ativo', true)
    const { data: jornadas } = await supabase.from('jornadas').select('*').eq('ativo', true)
    const { data: feriados } = await supabase.from('feriados').select('*')
    const { data: unidade } = await supabase.from('unidades').select('*').eq('id', escala.unidade_id).single()
    const { data: setor } = await supabase.from('setores').select('*').eq('id', escala.setor_id).single()

    return {
      data: {
        escalaMensal: escalaMensalRecords,
        escalaDiaria: escalaDiaria || [],
        turnos: turnos || [],
        jornadas: jornadas || [],
        feriados: feriados || [],
        unidade,
        setor,
        mes: escala.mes,
        ano: escala.ano
      }
    }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function logoutPortal() {
  const cookieStore = await cookies()
  cookieStore.delete('portal_servidor_id')
}
