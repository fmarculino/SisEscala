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

  // Validar o PIN de forma segura usando bcrypt no PostgreSQL
  const { data: isPinValid, error: rpcError } = await supabase.rpc('verify_pin', {
    p_servidor_id: servidorId,
    p_pin: pin
  })

  if (rpcError || !isPinValid) {
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
      setores (dicionario_setores(nome)),
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

  const escalasMapped = escalas?.map(e => {
    const sectorData = Array.isArray(e.setores) ? e.setores[0] : e.setores
    const dictData = sectorData ? (Array.isArray(sectorData.dicionario_setores) 
      ? sectorData.dicionario_setores[0] 
      : sectorData.dicionario_setores) : null
      
    return {
      ...e,
      setores: sectorData ? {
        nome: dictData?.nome || 'SETOR SEM NOME'
      } : null
    }
  })

  return { escalas: escalasMapped }
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
      return { error: 'Acesso negado. Você não possui escalas ativas vinculadas a esta unidade.' }
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
        const [t, j, f, c] = await Promise.all([
          supabase.from('dicionario_turnos').select('*').eq('ativo', true),
          supabase.from('jornadas').select('*').eq('ativo', true),
          supabase.from('feriados').select('*'),
          supabase.from('configuracoes_globais').select('*')
        ])
        return { turnos: t.data, jornadas: j.data, feriados: f.data, configsGlobais: c.data }
      },
      ['static-escala-data'],
      { revalidate: 3600 } // Cache por 1 hora
    )

    const { turnos, jornadas, feriados, configsGlobais } = await getCachedStaticData()
    const { data: unidade } = await supabase.from('unidades').select('*').eq('id', escala.unidade_id).single()
    const { data: setorRaw } = await supabase.from('setores').select('*, dicionario_setores(nome)').eq('id', escala.setor_id).single()
    
    // Fetch event details for the servers in the monthly scale
    const serverIds = escalaMensalRecords.map(em => em.servidor_id)
    const startStr = `${escala.ano}-${escala.mes.toString().padStart(2, '0')}-01`
    const daysInMonth = new Date(escala.ano, escala.mes, 0).getDate()
    const endStr = `${escala.ano}-${escala.mes.toString().padStart(2, '0')}-${daysInMonth}`

    const { data: servidoresEventos } = await supabase
      .from('servidores_eventos')
      .select('*, tipos_eventos(*)')
      .in('servidor_id', serverIds)
      .or(`data_inicio.lte.${endStr},data_fim.gte.${startStr}`)

    const sectorData = setorRaw ? { 
      ...setorRaw, 
      nome: (Array.isArray(setorRaw.dicionario_setores) 
        ? setorRaw.dicionario_setores[0]?.nome 
        : (setorRaw as any).dicionario_setores?.nome) || 'SETOR SEM NOME' 
    } : null

    return {
      data: {
        escalaMensal: escalaMensalRecords,
        escalaDiaria: escalaDiaria || [],
        turnos: turnos || [],
        jornadas: jornadas || [],
        feriados: feriados || [],
        unidade,
        setor: sectorData,
        mes: escala.mes,
        ano: escala.ano,
        servidoresEventos: servidoresEventos || [],
        configsGlobais: configsGlobais || []
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

// ============================================================
// Portal de Solicitação de Trocas — SisEscala v0.6.0
// ============================================================

export async function createSwapRequest(params: {
  escalaMensalId: string
  diaOrigem: number
  categoriaOrigem: string
  turnoOrigemId: string
  justificativa: string
  destinatarioId?: string
}) {
  const supabase = await createAdminClient()
  const cookieStore = await cookies()
  const portalServidorId = cookieStore.get('portal_servidor_id')?.value

  if (!portalServidorId) {
    return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
  }

  // Validar que a justificativa não está vazia
  if (!params.justificativa || params.justificativa.trim().length < 5) {
    return { error: 'A justificativa deve ter pelo menos 5 caracteres.' }
  }

  // Verificar limite de solicitações pendentes (anti-spam: max 3)
  const { data: pendentes } = await supabase
    .from('solicitacoes_troca')
    .select('id')
    .eq('solicitante_id', portalServidorId)
    .eq('status', 'Pendente')

  if (pendentes && pendentes.length >= 3) {
    return { error: 'Você já possui 3 solicitações pendentes. Aguarde a análise antes de criar novas.' }
  }

  // Verificar que a escala pertence ao servidor logado
  const { data: escala } = await supabase
    .from('escala_mensal')
    .select('id, status, servidor_id, mes, ano')
    .eq('id', params.escalaMensalId)
    .eq('servidor_id', portalServidorId)
    .single()

  if (!escala) {
    return { error: 'Escala não encontrada ou não pertence a você.' }
  }

  if (escala.status === 'Fechada') {
    return { error: 'Não é possível solicitar troca em uma escala já fechada.' }
  }

  // Validar que o dia solicitado não é passado
  const hoje = new Date()
  const diaEscala = new Date(escala.ano, escala.mes - 1, params.diaOrigem)
  if (diaEscala <= hoje) {
    return { error: 'Não é possível solicitar troca para um dia que já passou.' }
  }

  // Verificar que o dia tem turno atribuído
  const { data: diaria } = await supabase
    .from('escala_diaria')
    .select('id, dicionario_turnos_id')
    .eq('escala_mensal_id', params.escalaMensalId)
    .eq('dia', params.diaOrigem)
    .eq('categoria', params.categoriaOrigem)
    .single()

  if (!diaria || !diaria.dicionario_turnos_id) {
    return { error: 'Não há turno atribuído neste dia para solicitar troca.' }
  }

  // Criar a solicitação
  const { data: solicitacao, error } = await supabase
    .from('solicitacoes_troca')
    .insert({
      solicitante_id: portalServidorId,
      escala_mensal_solicitante_id: params.escalaMensalId,
      dia_origem: params.diaOrigem,
      categoria_origem: params.categoriaOrigem,
      turno_origem_id: diaria.dicionario_turnos_id,
      destinatario_id: params.destinatarioId || null,
      justificativa: params.justificativa.trim()
    })
    .select()
    .single()

  if (error) {
    return { error: 'Erro ao criar solicitação: ' + error.message }
  }

  return { success: true, solicitacao }
}

export async function getSwapRequests(servidorId?: string) {
  const supabase = await createAdminClient()
  const cookieStore = await cookies()
  const portalServidorId = servidorId || cookieStore.get('portal_servidor_id')?.value

  if (!portalServidorId) {
    return { error: 'Sessão expirada.' }
  }

  const { data, error } = await supabase
    .from('solicitacoes_troca')
    .select(`
      *,
      solicitante:servidores!solicitacoes_troca_solicitante_id_fkey(nome, matricula),
      destinatario:servidores!solicitacoes_troca_destinatario_id_fkey(nome),
      turno:dicionario_turnos!solicitacoes_troca_turno_origem_id_fkey(codigo, descricao),
      escala:escala_mensal!solicitacoes_troca_escala_mensal_solicitante_id_fkey(mes, ano, unidade_id, setor_id)
    `)
    .eq('solicitante_id', portalServidorId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return { error: error.message }
  }

  return { solicitacoes: data || [] }
}

export async function cancelSwapRequest(solicitacaoId: string) {
  const supabase = await createAdminClient()
  const cookieStore = await cookies()
  const portalServidorId = cookieStore.get('portal_servidor_id')?.value

  if (!portalServidorId) {
    return { error: 'Sessão expirada.' }
  }

  // Verificar que a solicitação pertence ao servidor e está pendente
  const { data: sol } = await supabase
    .from('solicitacoes_troca')
    .select('id, solicitante_id, status')
    .eq('id', solicitacaoId)
    .eq('solicitante_id', portalServidorId)
    .eq('status', 'Pendente')
    .single()

  if (!sol) {
    return { error: 'Solicitação não encontrada ou não pode ser cancelada.' }
  }

  const { error } = await supabase
    .from('solicitacoes_troca')
    .update({ status: 'Cancelada', updated_at: new Date().toISOString() })
    .eq('id', solicitacaoId)

  if (error) {
    return { error: 'Erro ao cancelar: ' + error.message }
  }

  return { success: true }
}
