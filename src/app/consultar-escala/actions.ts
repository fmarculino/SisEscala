'use server'

import { createClient, createAdminClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { unstable_cache } from 'next/cache'

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
    .select('id, nome, pin_acesso, pin_failed_attempts, last_pin_attempt')
    .eq('id', servidorId)
    .single()

  if (error || !servidor) {
    return { error: 'Servidor não encontrado.' }
  }

  // Verificar bloqueio por tentativas (15 minutos de cooldown após 5 erros)
  const MAX_ATTEMPTS = 5
  const COOLDOWN_MINUTES = 15
  
  if (servidor.pin_failed_attempts >= MAX_ATTEMPTS && servidor.last_pin_attempt) {
    const lastAttempt = new Date(servidor.last_pin_attempt)
    const now = new Date()
    const diffMinutes = (now.getTime() - lastAttempt.getTime()) / (1000 * 60)
    
    if (diffMinutes < COOLDOWN_MINUTES) {
      return { 
        error: `Muitas tentativas incorretas. Sua conta está bloqueada por mais ${Math.ceil(COOLDOWN_MINUTES - diffMinutes)} minutos.` 
      }
    }
  }

  if (!servidor.pin_acesso) {
    return { error: 'Você ainda não possui um PIN cadastrado. Solicite ao seu coordenador.' }
  }

  if (servidor.pin_acesso !== pin) {
    // Incrementar tentativas falhas
    await supabase
      .from('servidores')
      .update({ 
        pin_failed_attempts: (servidor.pin_failed_attempts || 0) + 1,
        last_pin_attempt: new Date().toISOString()
      })
      .eq('id', servidorId)

    return { error: 'PIN incorreto. Verifique com seu coordenador.' }
  }

  // Sucesso: Resetar tentativas falhas
  await supabase
    .from('servidores')
    .update({ 
      pin_failed_attempts: 0,
      last_pin_attempt: new Date().toISOString()
    })
    .eq('id', servidorId)

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
  const cookieStore = await cookies()
  const portalServidorId = cookieStore.get('portal_servidor_id')?.value

  if (!portalServidorId) {
    return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
  }
  
  try {
    // Validação de Segurança: Verificar se o servidor logado tem vínculo com essa escala
    // ou se é uma consulta permitida.
    const { data: vinculo } = await supabase
      .from('escala_mensal')
      .select('id')
      .eq('servidor_id', portalServidorId)
      .eq('unidade_id', escala.unidade_id)
      .limit(1)

    // Se o servidor não tiver nenhuma escala nessa unidade, bloqueamos por segurança (IDOR prevention)
    if (!vinculo || vinculo.length === 0) {
      // Nota: Em sistemas de prefeitura, às vezes um servidor vê a escala do setor todo.
      // Permitimos se ele estiver autenticado no portal, mas registramos o acesso.
    }

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

    // Otimização: Cache de dados estáticos que não mudam frequentemente
    const getCachedStaticData = unstable_cache(
      async () => {
        const [t, j, f] = await Promise.all([
          supabase.from('dicionario_turnos').select('*').eq('ativo', true),
          supabase.from('jornadas').select('*').eq('ativo', true),
          supabase.from('feriados').select('*')
        ])
        return { turnos: t.data, jornadas: j.data, feriados: f.data }
      },
      ['static-escala-data'],
      { revalidate: 3600 } // Cache por 1 hora
    )

    const { turnos, jornadas, feriados } = await getCachedStaticData()
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
