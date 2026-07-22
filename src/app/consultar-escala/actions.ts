'use server'

import { createClient, createAdminClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { unstable_cache, revalidatePath } from 'next/cache'
import { autoCloseExpiredScalesAndTimesheets, isCompetencyClosed } from '@/utils/autoClose'


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

  if (servidor.last_pin_attempt) {
    const lastAttempt = new Date(servidor.last_pin_attempt)
    const now = new Date()
    const diffMinutes = (now.getTime() - lastAttempt.getTime()) / (1000 * 60)

    if (diffMinutes >= COOLDOWN_MINUTES) {
      // Cooldown expirado: resetar contador para dar nova chance
      await supabase
        .from('servidores')
        .update({ pin_failed_attempts: 0 })
        .eq('id', servidorId)
      servidor.pin_failed_attempts = 0
    } else if (servidor.pin_failed_attempts >= MAX_ATTEMPTS) {
      // Bloqueado
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
    const newAttempts = (servidor.pin_failed_attempts || 0) + 1

    // Incrementar tentativas falhas
    await supabase
      .from('servidores')
      .update({
        pin_failed_attempts: newAttempts,
        last_pin_attempt: new Date().toISOString()
      })
      .eq('id', servidorId)

    const attemptsLeft = MAX_ATTEMPTS - newAttempts
    if (attemptsLeft > 0) {
      return { error: `PIN incorreto. Você tem mais ${attemptsLeft} tentativa(s) antes do bloqueio.` }
    } else {
      return { error: `Muitas tentativas incorretas. Sua conta está bloqueada por 15 minutos.` }
    }
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
  try {
    await autoCloseExpiredScalesAndTimesheets()
  } catch (err) {
    console.error('Erro ao executar fechamento automático:', err)
  }

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

    const { data: pontosFacultativos } = await supabase
      .from('pontos_facultativos')
      .select('id, data, descricao, inicio_liberacao_em, fim_liberacao_em')
      .gte('data', startStr)
      .lte('data', endStr)

    const pfMapped = (pontosFacultativos || []).map((pf: any) => ({
      id: pf.id,
      data: pf.data,
      descricao: `Ponto Facultativo: ${pf.descricao}` + (
        pf.inicio_liberacao_em ? ` (a partir das ${pf.inicio_liberacao_em.substring(0, 5)})` :
        pf.fim_liberacao_em ? ` (até as ${pf.fim_liberacao_em.substring(0, 5)})` : ''
      ),
      isPontoFacultativo: true
    }))

    const combinedFeriados = [...(feriados || []), ...pfMapped]

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
        feriados: combinedFeriados,
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

function getExtraHoursFromShift(extraShift: any): number {
  if (!extraShift || !extraShift.dicionario_turnos) return 0
  const dt = extraShift.dicionario_turnos
  const dtObj = Array.isArray(dt) ? dt[0] : dt
  if (dtObj?.horas_computadas && Number(dtObj.horas_computadas) > 0) {
    return Number(dtObj.horas_computadas)
  }
  if (dtObj?.codigo) {
    const val = parseFloat(String(dtObj.codigo).replace(',', '.'))
    if (!isNaN(val) && val > 0) return val
  }
  return 0
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

export async function getFolhaPontoServidor(servidorId: string, mes: number, ano: number, escalaMensalId?: string) {
  const supabase = await createAdminClient()
  const cookieStore = await cookies()
  const portalServidorId = cookieStore.get('portal_servidor_id')?.value

  if (!portalServidorId) {
    return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
  }

  if (portalServidorId !== servidorId) {
    return { error: 'Acesso negado.' }
  }

  let query = supabase
    .from('folha_ponto')
    .select('*, servidores(*)')
    .eq('servidor_id', servidorId)

  if (escalaMensalId) {
    query = query.eq('escala_mensal_id', escalaMensalId)
  } else {
    query = query.eq('mes', mes).eq('ano', ano)
  }

  let { data: folha, error } = await query.maybeSingle()

  if (error) {
    return { error: error.message }
  }

  if (!folha) {
    return { folha: null }
  }

  const { data: escala } = await supabase
    .from('escala_mensal')
    .select('*, unidades(*), setores(*, dicionario_setores(nome)), jornadas(*)')
    .eq('id', folha.escala_mensal_id)
    .single()

  if (escala && await checkIfFolhaHasPendingPastTimes(folha, escala)) {
    await sincronizarFolhaPontoServidor(folha.id)
    const { data: updatedFolha } = await query.maybeSingle()
    if (updatedFolha) {
      folha = updatedFolha
    }
  }

  const sectorData = escala ? (Array.isArray(escala.setores) ? escala.setores[0] : escala.setores) : null
  const dictData = sectorData ? (Array.isArray(sectorData.dicionario_setores)
    ? sectorData.dicionario_setores[0]
    : sectorData.dicionario_setores) : null

  const resolvedSetor = sectorData ? {
    ...sectorData,
    nome: dictData?.nome || 'SETOR SEM NOME'
  } : null

  return {
    folha: {
      ...folha,
      escala: escala ? {
        ...escala,
        setores: resolvedSetor
      } : null
    }
  }
}

// ============================================================
// Portal do Servidor - Folha de Ponto (Phase 8 Additions)
// ============================================================

// Helpers for calculations
function parseJornadaNome(nome: string): { startHour: number; startMin: number; endHour: number; endMin: number } {
  const defaultVal = { startHour: 8, startMin: 0, endHour: 17, endMin: 0 }
  if (!nome) return defaultVal

  const match = nome.match(/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i)
  if (!match) return defaultVal

  const startHour = parseInt(match[1], 10)
  const startMin = match[2] ? parseInt(match[2], 10) : 0
  const endHour = parseInt(match[3], 10)
  const endMin = match[4] ? parseInt(match[4], 10) : 0

  return { startHour, startMin, endHour, endMin }
}

function getDeterministicOffset(seedStr: string, maxOffset: number = 15): number {
  let hash = 0
  for (let i = 0; i < seedStr.length; i++) {
    hash = seedStr.charCodeAt(i) + ((hash << 5) - hash)
  }
  const absOffset = (Math.abs(hash) % (maxOffset - 1)) + 1
  const sign = hash % 2 === 0 ? 1 : -1
  return sign * absOffset
}

function formatMinutesToTimeStr(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function generateFingerprint(records: any[]): string {
  const simplified = records.map(r => ({
    dia: r.dia,
    turno: r.dicionario_turnos_id
  }))
  simplified.sort((a, b) => a.dia - b.dia)
  const str = JSON.stringify(simplified)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash).toString(16)
}

function getTurnoCodigo(dicionarioTurnos: any): string | null {
  if (!dicionarioTurnos) return null
  if (Array.isArray(dicionarioTurnos)) {
    return dicionarioTurnos[0]?.codigo || null
  }
  return dicionarioTurnos.codigo || null
}

function getAfastamentoNome(tiposEventos: any): string | null {
  if (!tiposEventos) return null
  if (Array.isArray(tiposEventos)) {
    return tiposEventos[0]?.nome || null
  }
  return tiposEventos.nome || null
}

function getAfastamentoObservacao(af: any): string {
  const baseName = getAfastamentoNome(af.tipos_eventos) || af.observacao || 'Afastado'
  if (af.slots && af.slots.length > 0) {
    return `${baseName} (${af.slots.join(', ')})`
  }
  return baseName
}

function isShiftOverlappingAfastamento(afastamento: any, shift: any): boolean {
  if (!afastamento) return false
  if (!afastamento.slots || afastamento.slots.length === 0) return true
  if (!shift || !shift.dicionario_turnos) return false
  const shiftSlots = (shift.dicionario_turnos as any).slots || []
  return shiftSlots.some((s: string) => afastamento.slots.includes(s))
}

export async function checkIfFolhaHasPendingPastTimes(folha: any, escala: any, timezone: string = 'America/Sao_Paulo'): Promise<boolean> {
  if (!folha || !folha.registros || folha.status === 'Revisada') return false

  const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }))
  const currentYear = nowLocal.getFullYear()
  const currentMonth = nowLocal.getMonth() + 1
  const currentDay = nowLocal.getDate()

  const hasInterval = (escala?.jornadas?.intervalo_minutos ?? 60) > 0

  for (const r of folha.registros) {
    if (r.turno_codigo && !r.feriado && !r.afastamento) {
      const isFullDayPF = r.ponto_facultativo && 
        !(r.observacao || '').includes('PARTIR') && 
        !(r.observacao || '').includes('ATÉ')
      
      if (isFullDayPF) continue

      let isPastDay = false
      if (folha.ano < currentYear) {
        isPastDay = true
      } else if (folha.ano === currentYear) {
        if (folha.mes < currentMonth) {
          isPastDay = true
        } else if (folha.mes === currentMonth) {
          if (r.dia < currentDay) {
            isPastDay = true
          }
        }
      }

      if (isPastDay) {
        const hasEmptyFicticioTimes = 
          (r.entrada === '' && r.origem_entrada !== 'manual') ||
          (r.saida === '' && r.origem_saida !== 'manual') ||
          (hasInterval && r.saida_intervalo === '' && r.origem_saida_intervalo !== 'manual') ||
          (hasInterval && r.retorno_intervalo === '' && r.origem_retorno_intervalo !== 'manual')

        if (hasEmptyFicticioTimes) {
          return true
        }
      }
    }
  }

  return false
}

// Server Action: Save employee's timesheet from the portal
export async function salvarFolhaPontoServidor(folhaId: string, registros: any[]) {
  try {
    const supabase = await createAdminClient()
    const cookieStore = await cookies()
    const portalServidorId = cookieStore.get('portal_servidor_id')?.value

    if (!portalServidorId) {
      return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
    }

    // Fetch existing sheet
    const { data: folha, error: fetchError } = await supabase
      .from('folha_ponto')
      .select('id, escala_mensal_id, mes, ano, status, servidor_id, registros')
      .eq('id', folhaId)
      .single()

    if (fetchError || !folha) throw new Error('Folha de ponto não encontrada')

    if (folha.servidor_id !== portalServidorId) {
      return { error: 'Acesso negado.' }
    }

    if (await isCompetencyClosed(folha.mes, folha.ano)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    // Bloquear alteração de marcações reais (origem = 'real') pelo portal
    const oldRegistros = folha.registros as any[]
    for (const r of registros) {
      const oldR = oldRegistros?.find((o: any) => o.dia === r.dia)
      if (oldR) {
        if (oldR.origem_entrada === 'real' && r.entrada !== oldR.entrada) {
          return { error: 'Não é permitido alterar marcações reais de entrada.' }
        }
        if (oldR.origem_saida_intervalo === 'real' && r.saida_intervalo !== oldR.saida_intervalo) {
          return { error: 'Não é permitido alterar marcações reais de saída intervalo.' }
        }
        if (oldR.origem_retorno_intervalo === 'real' && r.retorno_intervalo !== oldR.retorno_intervalo) {
          return { error: 'Não é permitido alterar marcações reais de retorno intervalo.' }
        }
        if (oldR.origem_saida === 'real' && r.saida !== oldR.saida) {
          return { error: 'Não é permitido alterar marcações reais de saída.' }
        }
      }
    }

    if (folha.status === 'Revisada') {
      return { error: 'Esta folha de ponto já foi revisada e fechada pela coordenação e não pode ser editada.' }
    }

    // Fetch scale
    const { data: escala } = await supabase
      .from('escala_mensal')
      .select('unidade_id, setor_id, status, jornada_id, jornadas(horas_totais, nome, intervalo_minutos)')
      .eq('id', folha.escala_mensal_id)
      .single()

    if (!escala) throw new Error('Escala vinculada não encontrada')

    const jornadaDetails = escala.jornadas ? (escala.jornadas as any) : null
    const horasNormaisDiarias = jornadaDetails?.horas_totais ?? 8

    // Fetch holidays
    const startDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-01`
    const daysInMonth = new Date(folha.ano, folha.mes, 0).getDate()
    const endDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-${daysInMonth}`
    const { data: feriados } = await supabase
      .from('feriados')
      .select('data')
      .gte('data', startDate)
      .lte('data', endDate)
    const feriadosSet = new Set(feriados?.map(f => f.data) || [])

    let totalHorasNormais = 0
    let totalExtra50 = 0
    let totalExtra100 = 0
    let totalFaltas = 0

    registros.forEach(r => {
      if (r.turno_codigo) {
        totalHorasNormais += horasNormaisDiarias
      }

      const isFalta = r.observacao && r.observacao.toUpperCase().includes('FALTA')
      if (isFalta) {
        totalFaltas++
      }

      if (r.hora_extra_minutos && r.hora_extra_minutos > 0) {
        const dateObj = new Date(folha.ano, folha.mes - 1, r.dia)
        const dateStr = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(r.dia).padStart(2, '0')}`
        const isSunday = dateObj.getDay() === 0
        const isHoliday = feriadosSet.has(dateStr)

        if (isSunday || isHoliday) {
          totalExtra100 += r.hora_extra_minutos
        } else {
          if (r.hora_extra_tipo === '100%') {
            totalExtra100 += r.hora_extra_minutos
          } else {
            totalExtra50 += r.hora_extra_minutos
          }
        }
      }
    })

    const updatePayload: any = {
      registros,
      total_horas_normais: parseFloat(totalHorasNormais.toFixed(2)),
      total_horas_extras_50: parseFloat((totalExtra50 / 60).toFixed(2)),
      total_horas_extras_100: parseFloat((totalExtra100 / 60).toFixed(2)),
      total_faltas: totalFaltas,
      ultima_edicao_em: new Date().toISOString()
    }

    const { error: updateError } = await supabase
      .from('folha_ponto')
      .update(updatePayload)
      .eq('id', folhaId)

    if (updateError) throw updateError

    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar folha pelo servidor:', error)
    return { error: error.message }
  }
}

// Server Action: Check scale divergence from the portal
export async function verificarDivergenciaEscalaServidor(folhaId: string) {
  try {
    const supabase = await createAdminClient()
    const cookieStore = await cookies()
    const portalServidorId = cookieStore.get('portal_servidor_id')?.value

    if (!portalServidorId) {
      return { divergent: false }
    }

    const { data: folha } = await supabase
      .from('folha_ponto')
      .select('escala_mensal_id, escala_fingerprint, registros, servidor_id')
      .eq('id', folhaId)
      .single()

    if (!folha || folha.servidor_id !== portalServidorId) return { divergent: false }

    const { data: escalaDiaria } = await supabase
      .from('escala_diaria')
      .select('dia, dicionario_turnos_id, categoria, dicionario_turnos(codigo)')
      .eq('escala_mensal_id', folha.escala_mensal_id)
      .eq('categoria', 'Regular')

    const currentFingerprint = generateFingerprint(escalaDiaria || [])
    const divergent = currentFingerprint !== folha.escala_fingerprint

    const affectedDays: number[] = []
    if (divergent) {
      const records = folha.registros as any[]
      const currentShifts = escalaDiaria || []

      for (let day = 1; day <= 31; day++) {
        const record = records.find(r => r.dia === day)
        const currentShift = currentShifts.find(s => s.dia === day)

        const hadShift = record && record.turno_codigo !== null
        const hasShift = !!currentShift

        const changed = (hadShift !== hasShift) || (hadShift && record.turno_codigo !== getTurnoCodigo(currentShift?.dicionario_turnos))
        if (changed) {
          affectedDays.push(day)
        }
      }
    }

    return {
      divergent,
      currentFingerprint,
      savedFingerprint: folha.escala_fingerprint,
      affectedDays
    }
  } catch (error) {
    console.error('Erro ao verificar divergência pelo servidor:', error)
    return { divergent: false }
  }
}

// Server Action: Sync sheet with escala from the portal
export async function sincronizarFolhaPontoServidor(folhaId: string) {
  try {
    const supabase = await createAdminClient()
    const cookieStore = await cookies()
    const portalServidorId = cookieStore.get('portal_servidor_id')?.value

    if (!portalServidorId) {
      return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
    }

    const { data: folha, error: folhaError } = await supabase
      .from('folha_ponto')
      .select('*')
      .eq('id', folhaId)
      .single()

    if (folhaError || !folha) throw new Error('Folha de ponto não encontrada')

    if (folha.servidor_id !== portalServidorId) {
      return { error: 'Acesso negado.' }
    }

    if (await isCompetencyClosed(folha.mes, folha.ano)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    if (folha.status === 'Revisada') {
      return { error: 'Esta folha de ponto já foi revisada e fechada pela coordenação e não pode ser sincronizada.' }
    }

    const { data: escala, error: escError } = await supabase
      .from('escala_mensal')
      .select('id, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais), unidade_id, setor_id')
      .eq('id', folha.escala_mensal_id)
      .single()

    if (escError || !escala) throw new Error('Escala vinculada não encontrada')

    // Fetch all shifts from escala_diaria (Regular, Extra, Plantão) for the specific scale of this folha
    const { data: escalaDiaria } = await supabase
      .from('escala_diaria')
      .select('id, dia, categoria, dicionario_turnos_id, presenca_entrada_em, presenca_saida_em, presenca_confirmada, dicionario_turnos(codigo, slots, horas_computadas)')
      .eq('escala_mensal_id', escala.id)

    // Fetch manual validation logs for the specific scale of this folha
    const { data: logs } = await supabase
      .from('logs_sobreaviso')
      .select('dia, categoria, validacao_manual, motivo_acionamento')
      .eq('escala_mensal_id', escala.id)

    const currentShifts = escalaDiaria || []
    const fingerprint = generateFingerprint(currentShifts.filter(d => d.categoria === 'Regular'))

    const startDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-01`
    const daysInMonth = new Date(folha.ano, folha.mes, 0).getDate()
    const endDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-${daysInMonth}`
    const { data: feriados } = await supabase
      .from('feriados')
      .select('data, descricao')
      .gte('data', startDate)
      .lte('data', endDate)

    const feriadosSet = new Set(feriados?.map(f => f.data) || [])

    // Fetch pontos facultativos
    const { data: pontosFacultativos } = await supabase
      .from('pontos_facultativos')
      .select('id, data, descricao, inicio_liberacao_em, fim_liberacao_em, gera_he_para_essenciais')
      .gte('data', startDate)
      .lte('data', endDate)

    const { data: pfSetores } = await supabase
      .from('ponto_facultativo_setores')
      .select('*')

    const { data: sectorInfo } = await supabase
      .from('setores')
      .select('essencial')
      .eq('id', escala.setor_id)
      .maybeSingle()
    const isSectorEssencial = !!sectorInfo?.essencial

    const { data: afastamentos } = await supabase
      .from('servidores_eventos')
      .select('data_inicio, data_fim, observacao, slots, tipos_eventos(nome)')
      .eq('servidor_id', folha.servidor_id)
      .or(`data_inicio.lte.${endDate},data_fim.gte.${startDate}`)

    // Fetch temporary journeys overlapping this month
    const { data: tempJourneys } = await supabase
      .from('servidores_jornadas_temporarias')
      .select('*, jornadas(nome, horas_totais, intervalo_minutos)')
      .eq('servidor_id', folha.servidor_id)
      .or(`data_inicio.lte.${endDate},data_fim.gte.${startDate}`)

    // Parse Jornada
    const globalJornadaDetails = escala.jornadas ? (escala.jornadas as any) : null
    const globalJornada = parseJornadaNome(globalJornadaDetails?.nome || '')
    const globalIntervaloMinutos = globalJornadaDetails?.intervalo_minutos ?? 60
    const globalHorasNormaisDiarias = globalJornadaDetails?.horas_totais ?? 8

    // Fetch tolerance
    const { data: configVar } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'folha_ponto_variacao_minutos')
      .single()
    const maxVar = configVar?.valor ? parseInt(configVar.valor as string, 10) : 15

    // Fetch timezone and setup current local time limit
    const { data: configTimezone } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'timezone')
      .maybeSingle()
    const timezone = (configTimezone?.valor as string) || 'America/Sao_Paulo'
    const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }))
    const currentYear = nowLocal.getFullYear()
    const currentMonth = nowLocal.getMonth() + 1
    const currentDay = nowLocal.getDate()
    const currentHour = nowLocal.getHours()
    const currentMinute = nowLocal.getMinutes()
    const currentTotalMin = currentHour * 60 + currentMinute

    const registrosExistentes = folha.registros as any[]
    const registrosAtualizados: any[] = []

    let totalHorasNormais = 0
    let totalExtra50 = 0
    let totalExtra100 = 0
    let totalFaltas = 0

    const weekDaysShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(folha.ano, folha.mes - 1, day)
      const dayOfWeekStr = weekDaysShort[dateObj.getDay()]
      const dateStr = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`

      // Resolve dynamic journey for this day
      const tempJourney = tempJourneys?.find(tj => dateStr >= tj.data_inicio && dateStr <= tj.data_fim)
      const activeJornada = tempJourney ? tempJourney.jornadas : globalJornadaDetails
      const { startHour, startMin, endHour, endMin } = activeJornada === globalJornadaDetails ? globalJornada : parseJornadaNome(activeJornada?.nome || '')
      const intervaloMinutos = activeJornada === globalJornadaDetails ? globalIntervaloMinutos : (activeJornada?.intervalo_minutos ?? 60)
      const horasNormaisDiarias = activeJornada === globalJornadaDetails ? globalHorasNormaisDiarias : (activeJornada?.horas_totais ?? 8)

      const currentShift = currentShifts.find(s => s.dia === day && s.categoria === 'Regular')
      const extraShift = currentShifts.find(s => s.dia === day && s.categoria === 'Extra')
      const extraHoursScheduled = getExtraHoursFromShift(extraShift)
      const extraMinutesScheduled = Math.round(extraHoursScheduled * 60)
      const registroExistente = registrosExistentes.find(r => r.dia === day)

      const hadShift = registroExistente && registroExistente.turno_codigo !== null
      const hasShift = !!currentShift

      const scaleChangedForDay = (hadShift !== hasShift) || (hadShift && registroExistente.turno_codigo !== getTurnoCodigo(currentShift?.dicionario_turnos))

      const rawAfastamento = afastamentos?.find(af => dateStr >= af.data_inicio && dateStr <= af.data_fim)
      const afastamento = isShiftOverlappingAfastamento(rawAfastamento, currentShift) ? rawAfastamento : null
      const feriadoInfo = feriados?.find(f => f.data === dateStr)

      const shouldPreserve = !scaleChangedForDay

      // Otherwise, REGENERATE the day
      const shouldGenerate = (scheduledMin: number) => {
        if (folha.ano > currentYear) return false
        if (folha.ano < currentYear) return true
        if (folha.mes > currentMonth) return false
        if (folha.mes < currentMonth) return true
        if (day > currentDay) return false
        if (day < currentDay) return true
        return currentTotalMin >= (scheduledMin % 1440)
      }

      // Check if point facultativo applies
      const pf = pontosFacultativos?.find(p => p.data === dateStr)
      let pfInfo = null
      if (pf) {
        const rule = pfSetores?.find(r => r.ponto_facultativo_id === pf.id && r.setor_id === escala.setor_id)
        if (rule) {
          if (rule.tipo_regra === 'incluido') pfInfo = pf
        } else if (!isSectorEssencial) {
          pfInfo = pf
        }
      }

      let registro: any = {
        dia: day,
        dia_semana: dayOfWeekStr,
        turno_codigo: getTurnoCodigo(currentShift?.dicionario_turnos),
        entrada: '',
        saida_intervalo: '',
        retorno_intervalo: '',
        saida: '',
        hora_extra_minutos: 0,
        hora_extra_tipo: null,
        observacao: '',
        origem_entrada: null,
        origem_saida_intervalo: null,
        origem_retorno_intervalo: null,
        origem_saida: null,
        feriado: !!feriadoInfo,
        ponto_facultativo: !!pfInfo,
        afastamento: afastamento ? getAfastamentoObservacao(afastamento) : null
      }

      if (registro.afastamento) {
        registro.observacao = registro.afastamento.toUpperCase()
      } else if (registro.feriado) {
        registro.observacao = `FERIADO: ${feriadoInfo?.descricao}`.toUpperCase()
        if (rawAfastamento) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${getAfastamentoObservacao(rawAfastamento)} | ${registro.observacao}`.toUpperCase()
        }
      } else if (registro.ponto_facultativo && pfInfo && !pfInfo.inicio_liberacao_em && !pfInfo.fim_liberacao_em) {
        // Full day Ponto Facultativo
        registro.observacao = `PONTO FACULTATIVO: ${pfInfo.descricao}`.toUpperCase()
        if (currentShift) {
          totalHorasNormais += horasNormaisDiarias
        }
        if (rawAfastamento) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${getAfastamentoObservacao(rawAfastamento)} | ${registro.observacao}`.toUpperCase()
        }
      } else if (!currentShift) {
        if (dateObj.getDay() === 0) {
          registro.observacao = 'DOMINGO'
        } else if (dateObj.getDay() === 6) {
          registro.observacao = 'SÁBADO'
        } else {
          registro.observacao = 'FOLGA'
        }
        if (rawAfastamento) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${getAfastamentoObservacao(rawAfastamento)} | ${registro.observacao}`.toUpperCase()
        }
      } else {
        totalHorasNormais += horasNormaisDiarias
        if (pfInfo) {
          if (pfInfo.inicio_liberacao_em) {
            registro.observacao = `PONTO FACULTATIVO A PARTIR DAS ${pfInfo.inicio_liberacao_em.substring(0, 5)}: ${pfInfo.descricao}`.toUpperCase()
          } else if (pfInfo.fim_liberacao_em) {
            registro.observacao = `PONTO FACULTATIVO ATÉ AS ${pfInfo.fim_liberacao_em.substring(0, 5)}: ${pfInfo.descricao}`.toUpperCase()
          }
        }
        if (rawAfastamento) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${getAfastamentoObservacao(rawAfastamento)}${registro.observacao ? ' | ' + registro.observacao : ''}`.toUpperCase()
        }

        // Check if entry/exit was validated manually by a coordinator
        const isManualEntrada = logs?.some(log =>
          log.dia === day &&
          log.categoria === 'Regular' &&
          log.validacao_manual === true &&
          log.motivo_acionamento?.toLowerCase().includes('entrada')
        )
        const isManualSaida = logs?.some(log =>
          log.dia === day &&
          log.categoria === 'Regular' &&
          log.validacao_manual === true &&
          log.motivo_acionamento?.toLowerCase().includes('saida')
        )

        const dayShifts = currentShifts.filter(d => d.dia === day)
        const allEntradas = dayShifts.map(s => s.presenca_entrada_em).filter(Boolean)
        const allSaidas = dayShifts.map(s => s.presenca_saida_em).filter(Boolean)

        const realEntradaTime = allEntradas.length > 0 ? new Date(Math.min(...allEntradas.map(t => new Date(t).getTime()))) : null
        const realSaidaTime = allSaidas.length > 0 ? new Date(Math.max(...allSaidas.map(t => new Date(t).getTime()))) : null

        const hasRealEntrada = realEntradaTime !== null && !isManualEntrada
        const hasRealSaida = realSaidaTime !== null && !isManualSaida

        const officialEntradaMin = startHour * 60 + startMin
        const baseOfficialSaidaMin = endHour * 60 + endMin
        let officialSaidaMin = baseOfficialSaidaMin + extraMinutesScheduled
        let totalBrutoMin = officialSaidaMin - officialEntradaMin
        if (totalBrutoMin < 0) totalBrutoMin += 24 * 60

        const halfJornadaMin = Math.floor(totalBrutoMin / 2)
        const officialSaidaIntervaloMin = (officialEntradaMin + halfJornadaMin) % (24 * 60)
        const officialRetornoIntervaloMin = (officialSaidaIntervaloMin + intervaloMinutos) % (24 * 60)

        const seedBase = `${folha.servidor_id}-${folha.mes}-${folha.ano}-${day}`

        // Parse ponto facultativo release/limit minutes
        let pfInicioMin: number | null = null
        let pfFimMin: number | null = null
        if (pfInfo) {
          if (pfInfo.inicio_liberacao_em) {
            const parts = pfInfo.inicio_liberacao_em.split(':')
            pfInicioMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)
          }
          if (pfInfo.fim_liberacao_em) {
            const parts = pfInfo.fim_liberacao_em.split(':')
            pfFimMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)
          }
        }

        // 1. Entrance Time
        if (shouldPreserve && registroExistente?.origem_entrada === 'manual') {
          registro.entrada = registroExistente.entrada
          registro.origem_entrada = 'manual'
        } else if (hasRealEntrada && realEntradaTime) {
          registro.entrada = realEntradaTime.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
          registro.origem_entrada = 'real'
        } else if (isManualEntrada && realEntradaTime) {
          registro.entrada = realEntradaTime.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
          registro.origem_entrada = 'manual'
        } else if (shouldGenerate(officialEntradaMin)) {
          let targetEntradaMin = officialEntradaMin
          if (pfFimMin !== null && officialEntradaMin < pfFimMin) {
            targetEntradaMin = pfFimMin
          }
          const offset = getDeterministicOffset(`${seedBase}-entrada`, maxVar)
          const genMin = (targetEntradaMin + offset + 24 * 60) % (24 * 60)
          registro.entrada = formatMinutesToTimeStr(genMin)
          registro.origem_entrada = 'ficticio'
        }

        // 2. Exit Time
        if (shouldPreserve && registroExistente?.origem_saida === 'manual') {
          registro.saida = registroExistente.saida
          registro.origem_saida = 'manual'
        } else if (hasRealSaida && realSaidaTime) {
          registro.saida = realSaidaTime.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
          registro.origem_saida = 'real'
        } else if (isManualSaida && realSaidaTime) {
          registro.saida = realSaidaTime.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
          registro.origem_saida = 'manual'
        } else if (shouldGenerate(officialSaidaMin)) {
          let targetSaidaMin = officialSaidaMin
          if (pfInicioMin !== null && officialEntradaMin < pfInicioMin) {
            targetSaidaMin = pfInicioMin
          }
          const offset = getDeterministicOffset(`${seedBase}-saida`, maxVar)
          const genMin = (targetSaidaMin + offset + 24 * 60) % (24 * 60)
          registro.saida = formatMinutesToTimeStr(genMin)
          registro.origem_saida = 'ficticio'
        }

        // 3. Lunch Interval
        if (intervaloMinutos > 0) {
          let targetSaidaMin = officialSaidaMin
          if (pfInicioMin !== null && officialEntradaMin < pfInicioMin) {
            targetSaidaMin = pfInicioMin
          }
          
          if (targetSaidaMin > officialSaidaIntervaloMin) {
            if (shouldPreserve && registroExistente?.origem_saida_intervalo === 'manual') {
              registro.saida_intervalo = registroExistente.saida_intervalo
              registro.origem_saida_intervalo = 'manual'
            } else if (shouldGenerate(officialSaidaIntervaloMin)) {
              const outOffset = getDeterministicOffset(`${seedBase}-lunchout`, maxVar)
              const genOutMin = (officialSaidaIntervaloMin + outOffset + 24 * 60) % (24 * 60)
              registro.saida_intervalo = formatMinutesToTimeStr(genOutMin)
              registro.origem_saida_intervalo = 'ficticio'
            }

            if (shouldPreserve && registroExistente?.origem_retorno_intervalo === 'manual') {
              registro.retorno_intervalo = registroExistente.retorno_intervalo
              registro.origem_retorno_intervalo = 'manual'
            } else if (shouldGenerate(officialRetornoIntervaloMin)) {
              const returnOffset = getDeterministicOffset(`${seedBase}-lunchreturn`, maxVar)
              const genReturnMin = (officialRetornoIntervaloMin + returnOffset + 24 * 60) % (24 * 60)
              registro.retorno_intervalo = formatMinutesToTimeStr(genReturnMin)
              registro.origem_retorno_intervalo = 'ficticio'
            }
          }
        }

      // Preserve manual observation if needed
        if (shouldPreserve && registroExistente && (
          registroExistente.observacao.includes('FALTA') ||
          registroExistente.observacao.includes('MANUAL')
        )) {
          registro.observacao = registroExistente.observacao
        }

        if (registro.observacao.includes('FALTA')) {
          totalFaltas++
        }

        // 4. Overtime Calculation
        const scheduledEntrance = new Date(`${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00-03:00`)
        const scheduledExit = new Date(`${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00-03:00`)
        if (scheduledExit <= scheduledEntrance) {
          scheduledExit.setDate(scheduledExit.getDate() + 1)
        }

        let effectiveScheduledExit = scheduledExit
        if (pfInfo && pfInfo.inicio_liberacao_em && pfInicioMin !== null && officialEntradaMin < pfInicioMin) {
          const releaseHour = Math.floor(pfInicioMin / 60)
          const releaseMin = pfInicioMin % 60
          effectiveScheduledExit = new Date(`${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(releaseHour).padStart(2, '0')}:${String(releaseMin).padStart(2, '0')}:00-03:00`)
        }

        let evalExit: Date | null = null

        if (hasRealSaida && realSaidaTime) {
          evalExit = realSaidaTime
        } else if (registro.saida) {
          const [sH, sM] = registro.saida.split(':').map(Number)
          evalExit = new Date(`${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(sH).padStart(2, '0')}:${String(sM).padStart(2, '0')}:00-03:00`)
          if (sH < startHour || (sH === startHour && sM < startMin)) {
            evalExit.setDate(evalExit.getDate() + 1)
          }
        }

        if (evalExit && evalExit > effectiveScheduledExit) {
          let extra50Min = 0
          let extra100Min = 0

          const current = new Date(effectiveScheduledExit.getTime())
          const end = new Date(evalExit.getTime())

          while (current < end) {
            const localCurrent = new Date(current.getTime() - 3 * 60 * 60 * 1000)
            const curHour = localCurrent.getUTCHours()
            const curDayOfWeek = localCurrent.getUTCDay()
            const curDateStr = `${localCurrent.getUTCFullYear()}-${String(localCurrent.getUTCMonth() + 1).padStart(2, '0')}-${String(localCurrent.getUTCDate()).padStart(2, '0')}`
            const isSunday = curDayOfWeek === 0
            const isHoliday = feriadosSet.has(curDateStr)
            const isNight = curHour >= 22 || curHour < 5

            const isPFLiberado = pfInfo && (
              (pfInfo.inicio_liberacao_em && pfInicioMin !== null && (localCurrent.getUTCHours() * 60 + localCurrent.getUTCMinutes()) >= pfInicioMin) ||
              (pfInfo.fim_liberacao_em && pfFimMin !== null && (localCurrent.getUTCHours() * 60 + localCurrent.getUTCMinutes()) < pfFimMin)
            )

            if (isSunday || isHoliday || isNight || (isPFLiberado && pfInfo && pfInfo.gera_he_para_essenciais)) {
              extra100Min++
            } else {
              extra50Min++
            }

            current.setMinutes(current.getMinutes() + 1)
          }

          registro.hora_extra_minutos = extra50Min + extra100Min
          registro.hora_extra_tipo = extra100Min > 0 ? '100%' : '50%'
          totalExtra50 += extra50Min
          totalExtra100 += extra100Min
        } else {
          registro.hora_extra_minutos = 0
          registro.hora_extra_tipo = null
        }
      }

      registrosAtualizados.push(registro)
    }

    // Save updated folha
    const { error: saveError } = await supabase
      .from('folha_ponto')
      .update({
        registros: registrosAtualizados,
        escala_fingerprint: fingerprint,
        total_horas_normais: parseFloat(totalHorasNormais.toFixed(2)),
        total_horas_extras_50: parseFloat((totalExtra50 / 60).toFixed(2)),
        total_horas_extras_100: parseFloat((totalExtra100 / 60).toFixed(2)),
        total_faltas: totalFaltas,
        ultima_edicao_em: new Date().toISOString()
      })
      .eq('id', folhaId)

    if (saveError) throw saveError

    return { success: true }
  } catch (error: any) {
    console.error('Erro na sincronização de folha pelo servidor:', error)
    return { error: error.message }
  }
}

// Server Action: Generate or regenerate employee's timesheet from the portal
export async function gerarFolhaPontoServidor(servidorId: string, mes: number, ano: number, forcarRascunho: boolean = false, escalaMensalId?: string) {
  try {
    const supabase = await createAdminClient()
    const cookieStore = await cookies()
    const portalServidorId = cookieStore.get('portal_servidor_id')?.value

    if (!portalServidorId) {
      return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
    }

    if (servidorId !== portalServidorId) {
      return { error: 'Acesso negado.' }
    }

    // Check if the sheet already exists and is closed (Revisada)
    let existingQuery = supabase
      .from('folha_ponto')
      .select('status, registros')

    if (escalaMensalId) {
      existingQuery = existingQuery.eq('escala_mensal_id', escalaMensalId)
    } else {
      existingQuery = existingQuery.eq('servidor_id', servidorId).eq('mes', mes).eq('ano', ano)
    }

    const { data: existingFolha } = await existingQuery.maybeSingle()

    const registrosExistentes = existingFolha?.registros as any[] || []

    if (await isCompetencyClosed(mes, ano)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    if (existingFolha && existingFolha.status === 'Revisada') {
      return { error: 'Esta folha de ponto já foi revisada e fechada pela coordenação e não pode ser regenerada.' }
    }

    // Fetch server lotação details
    const { data: servidor, error: servError } = await supabase
      .from('servidores')
      .select('id, unidade_id, setor_id, nome, matricula')
      .eq('id', servidorId)
      .single()

    if (servError || !servidor) throw new Error('Servidor não encontrado')

    // Fetch the active lotação escala_mensal
    let escala;
    if (escalaMensalId) {
      const { data: esc, error: escError } = await supabase
        .from('escala_mensal')
        .select('id, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais), unidade_id, setor_id')
        .eq('id', escalaMensalId)
        .eq('servidor_id', servidorId)
        .eq('ativo', true)
        .single()
      
      if (escError) throw escError
      escala = esc
    } else {
      const { data: esc, error: escError } = await supabase
        .from('escala_mensal')
        .select('id, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais), unidade_id, setor_id')
        .eq('servidor_id', servidorId)
        .eq('unidade_id', servidor.unidade_id)
        .eq('setor_id', servidor.setor_id)
        .eq('mes', mes)
        .eq('ano', ano)
        .eq('ativo', true)
        .maybeSingle()
      
      if (escError) throw escError
      escala = esc
    }

    if (!escala) {
      return { error: 'Servidor não possui escala regular criada neste setor para o mês selecionado.' }
    }

    // Check status requirement
    if (escala.status === 'Em Andamento' && !forcarRascunho) {
      return { error: 'A escala está Em Andamento. A folha deve ser gerada como Rascunho.' }
    }

    // Fetch config for tolerance
    const { data: configVar } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'folha_ponto_variacao_minutos')
      .single()
    const maxVar = configVar?.valor ? parseInt(configVar.valor as string, 10) : 15

    // Fetch timezone and setup current local time limit
    const { data: configTimezone } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'timezone')
      .maybeSingle()
    const timezone = (configTimezone?.valor as string) || 'America/Sao_Paulo'
    const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }))
    const currentYear = nowLocal.getFullYear()
    const currentMonth = nowLocal.getMonth() + 1
    const currentDay = nowLocal.getDate()
    const currentHour = nowLocal.getHours()
    const currentMinute = nowLocal.getMinutes()
    const currentTotalMin = currentHour * 60 + currentMinute

    // Fetch shifts from escala_diaria
    const { data: escalaDiaria, error: diError } = await supabase
      .from('escala_diaria')
      .select('id, dia, categoria, dicionario_turnos_id, presenca_entrada_em, presenca_saida_em, presenca_confirmada, dicionario_turnos(codigo, slots, horas_computadas)')
      .eq('escala_mensal_id', escala.id)

    if (diError) throw diError

    // Fetch manual validation logs
    const { data: logs } = await supabase
      .from('logs_sobreaviso')
      .select('dia, categoria, validacao_manual, motivo_acionamento')
      .eq('escala_mensal_id', escala.id)

    const currentShifts = escalaDiaria || []
    const fingerprint = generateFingerprint(currentShifts.filter(d => d.categoria === 'Regular'))

    // Fetch holidays
    const startDate = `${ano}-${String(mes).padStart(2, '0')}-01`
    const daysInMonth = new Date(ano, mes, 0).getDate()
    const endDate = `${ano}-${String(mes).padStart(2, '0')}-${daysInMonth}`
    
    const { data: feriados } = await supabase
      .from('feriados')
      .select('data, descricao')
      .gte('data', startDate)
      .lte('data', endDate)

    const feriadosSet = new Set(feriados?.map(f => f.data) || [])

    // Fetch pontos facultativos
    const { data: pontosFacultativos } = await supabase
      .from('pontos_facultativos')
      .select('id, data, descricao, inicio_liberacao_em, fim_liberacao_em, gera_he_para_essenciais')
      .gte('data', startDate)
      .lte('data', endDate)

    const { data: pfSetores } = await supabase
      .from('ponto_facultativo_setores')
      .select('*')

    const { data: sectorInfo } = await supabase
      .from('setores')
      .select('essencial')
      .eq('id', escala.setor_id)
      .maybeSingle()
    const isSectorEssencial = !!sectorInfo?.essencial

    // Fetch absences (afastamentos)
    const { data: afastamentos } = await supabase
      .from('servidores_eventos')
      .select('data_inicio, data_fim, observacao, slots, tipos_eventos(nome)')
      .eq('servidor_id', servidorId)
      .or(`data_inicio.lte.${endDate},data_fim.gte.${startDate}`)

    // Fetch temporary journeys overlapping this month
    const { data: tempJourneys } = await supabase
      .from('servidores_jornadas_temporarias')
      .select('*, jornadas(nome, horas_totais, intervalo_minutos)')
      .eq('servidor_id', servidorId)
      .or(`data_inicio.lte.${endDate},data_fim.gte.${startDate}`)

    // Parse Jornada
    const globalJornadaDetails = escala.jornadas ? (escala.jornadas as any) : null
    const globalJornada = parseJornadaNome(globalJornadaDetails?.nome || '')
    const globalIntervaloMinutos = globalJornadaDetails?.intervalo_minutos ?? 60
    const globalHorasNormaisDiarias = globalJornadaDetails?.horas_totais ?? 8

    const registros: any[] = []
    let totalHorasNormais = 0
    let totalExtra50 = 0
    let totalExtra100 = 0
    let totalFaltas = 0

    const weekDaysShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(ano, mes - 1, day)
      const dayOfWeekStr = weekDaysShort[dateObj.getDay()]
      const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`

      // Resolve dynamic journey for this day
      const tempJourney = tempJourneys?.find(tj => dateStr >= tj.data_inicio && dateStr <= tj.data_fim)
      const activeJornada = tempJourney ? tempJourney.jornadas : globalJornadaDetails
      const { startHour, startMin, endHour, endMin } = activeJornada === globalJornadaDetails ? globalJornada : parseJornadaNome(activeJornada?.nome || '')
      const intervaloMinutos = activeJornada === globalJornadaDetails ? globalIntervaloMinutos : (activeJornada?.intervalo_minutos ?? 60)
      const horasNormaisDiarias = activeJornada === globalJornadaDetails ? globalHorasNormaisDiarias : (activeJornada?.horas_totais ?? 8)

      const rawAfastamento = afastamentos?.find(af => dateStr >= af.data_inicio && dateStr <= af.data_fim)
      const feriadoInfo = feriados?.find(f => f.data === dateStr)
      const shift = escalaDiaria?.find(ed => ed.dia === day && ed.categoria === 'Regular')
      const extraShift = escalaDiaria?.find(ed => ed.dia === day && ed.categoria === 'Extra')
      const extraHoursScheduled = getExtraHoursFromShift(extraShift)
      const extraMinutesScheduled = Math.round(extraHoursScheduled * 60)
      const afastamento = isShiftOverlappingAfastamento(rawAfastamento, shift) ? rawAfastamento : null

      // Check manual edits in existing record to preserve them
      const registroExistente = registrosExistentes.find((r: any) => r.dia === day)
      const shouldPreserve = true

      // Helper function to check if we should generate time for a scheduled marker
      const shouldGenerate = (scheduledMin: number) => {
        if (ano > currentYear) return false
        if (ano < currentYear) return true
        if (mes > currentMonth) return false
        if (mes < currentMonth) return true
        if (day > currentDay) return false
        if (day < currentDay) return true
        return currentTotalMin >= (scheduledMin % 1440)
      }

      // Check if point facultativo applies
      const pf = pontosFacultativos?.find(p => p.data === dateStr)
      let pfInfo = null
      if (pf) {
        const rule = pfSetores?.find(r => r.ponto_facultativo_id === pf.id && r.setor_id === escala.setor_id)
        if (rule) {
          if (rule.tipo_regra === 'incluido') pfInfo = pf
        } else if (!isSectorEssencial) {
          pfInfo = pf
        }
      }

      let registro: any = {
        dia: day,
        dia_semana: dayOfWeekStr,
        turno_codigo: getTurnoCodigo(shift?.dicionario_turnos),
        entrada: '',
        saida_intervalo: '',
        retorno_intervalo: '',
        saida: '',
        hora_extra_minutos: 0,
        hora_extra_tipo: null,
        observacao: '',
        origem_entrada: null,
        origem_saida_intervalo: null,
        origem_retorno_intervalo: null,
        origem_saida: null,
        feriado: !!feriadoInfo,
        ponto_facultativo: !!pfInfo,
        afastamento: afastamento ? getAfastamentoObservacao(afastamento) : null
      }

      if (registro.afastamento) {
        registro.observacao = registro.afastamento.toUpperCase()
      } else if (registro.feriado) {
        registro.observacao = `FERIADO: ${feriadoInfo?.descricao}`.toUpperCase()
        if (rawAfastamento) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${getAfastamentoObservacao(rawAfastamento)} | ${registro.observacao}`.toUpperCase()
        }
      } else if (registro.ponto_facultativo && pfInfo && !pfInfo.inicio_liberacao_em && !pfInfo.fim_liberacao_em) {
        // Full day Ponto Facultativo
        registro.observacao = `PONTO FACULTATIVO: ${pfInfo.descricao}`.toUpperCase()
        if (shift) {
          totalHorasNormais += horasNormaisDiarias
        }
        if (rawAfastamento) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${getAfastamentoObservacao(rawAfastamento)} | ${registro.observacao}`.toUpperCase()
        }
      } else if (!shift) {
        if (dateObj.getDay() === 0) {
          registro.observacao = 'DOMINGO'
        } else if (dateObj.getDay() === 6) {
          registro.observacao = 'SÁBADO'
        } else {
          registro.observacao = 'FOLGA'
        }
        if (rawAfastamento) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${getAfastamentoObservacao(rawAfastamento)} | ${registro.observacao}`.toUpperCase()
        }
      } else {
        totalHorasNormais += horasNormaisDiarias
        if (pfInfo) {
          if (pfInfo.inicio_liberacao_em) {
            registro.observacao = `PONTO FACULTATIVO A PARTIR DAS ${pfInfo.inicio_liberacao_em.substring(0, 5)}: ${pfInfo.descricao}`.toUpperCase()
          } else if (pfInfo.fim_liberacao_em) {
            registro.observacao = `PONTO FACULTATIVO ATÉ AS ${pfInfo.fim_liberacao_em.substring(0, 5)}: ${pfInfo.descricao}`.toUpperCase()
          }
        }
        if (rawAfastamento) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${getAfastamentoObservacao(rawAfastamento)}${registro.observacao ? ' | ' + registro.observacao : ''}`.toUpperCase()
        }

        // Check if entry/exit was validated manually by a coordinator
        const isManualEntrada = logs?.some(log =>
          log.dia === day &&
          log.categoria === 'Regular' &&
          log.validacao_manual === true &&
          log.motivo_acionamento?.toLowerCase().includes('entrada')
        )
        const isManualSaida = logs?.some(log =>
          log.dia === day &&
          log.categoria === 'Regular' &&
          log.validacao_manual === true &&
          log.motivo_acionamento?.toLowerCase().includes('saida')
        )

        const dayShifts = escalaDiaria?.filter((d: any) => d.dia === day) || []
        const allEntradas = dayShifts.map((s: any) => s.presenca_entrada_em).filter(Boolean)
        const allSaidas = dayShifts.map((s: any) => s.presenca_saida_em).filter(Boolean)

        const realEntradaTime = allEntradas.length > 0 ? new Date(Math.min(...allEntradas.map((t: any) => new Date(t).getTime()))) : null
        const realSaidaTime = allSaidas.length > 0 ? new Date(Math.max(...allSaidas.map((t: any) => new Date(t).getTime()))) : null

        const hasRealEntrada = realEntradaTime !== null && !isManualEntrada
        const hasRealSaida = realSaidaTime !== null && !isManualSaida

        const officialEntradaMin = startHour * 60 + startMin
        const baseOfficialSaidaMin = endHour * 60 + endMin
        let officialSaidaMin = baseOfficialSaidaMin + extraMinutesScheduled
        let totalBrutoMin = officialSaidaMin - officialEntradaMin
        if (totalBrutoMin < 0) totalBrutoMin += 24 * 60

        const halfJornadaMin = Math.floor(totalBrutoMin / 2)
        const officialSaidaIntervaloMin = (officialEntradaMin + halfJornadaMin) % (24 * 60)
        const officialRetornoIntervaloMin = (officialSaidaIntervaloMin + intervaloMinutos) % (24 * 60)

        const seedBase = `${servidorId}-${mes}-${ano}-${day}`

        // Parse ponto facultativo release/limit minutes
        let pfInicioMin: number | null = null
        let pfFimMin: number | null = null
        if (pfInfo) {
          if (pfInfo.inicio_liberacao_em) {
            const parts = pfInfo.inicio_liberacao_em.split(':')
            pfInicioMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)
          }
          if (pfInfo.fim_liberacao_em) {
            const parts = pfInfo.fim_liberacao_em.split(':')
            pfFimMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)
          }
        }

        // 1. Entrance Time
        if (shouldPreserve && registroExistente?.origem_entrada === 'manual') {
          registro.entrada = registroExistente.entrada
          registro.origem_entrada = 'manual'
        } else if (hasRealEntrada && realEntradaTime) {
          registro.entrada = realEntradaTime.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
          registro.origem_entrada = 'real'
        } else if (isManualEntrada && realEntradaTime) {
          registro.entrada = realEntradaTime.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
          registro.origem_entrada = 'manual'
        } else if (shouldGenerate(officialEntradaMin)) {
          let targetEntradaMin = officialEntradaMin
          if (pfFimMin !== null && officialEntradaMin < pfFimMin) {
            targetEntradaMin = pfFimMin
          }
          const offset = getDeterministicOffset(`${seedBase}-entrada`, maxVar)
          const genMin = (targetEntradaMin + offset + 24 * 60) % (24 * 60)
          registro.entrada = formatMinutesToTimeStr(genMin)
          registro.origem_entrada = 'ficticio'
        }

        // 2. Exit Time
        if (shouldPreserve && registroExistente?.origem_saida === 'manual') {
          registro.saida = registroExistente.saida
          registro.origem_saida = 'manual'
        } else if (hasRealSaida && realSaidaTime) {
          registro.saida = realSaidaTime.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
          registro.origem_saida = 'real'
        } else if (isManualSaida && realSaidaTime) {
          registro.saida = realSaidaTime.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
          registro.origem_saida = 'manual'
        } else if (shouldGenerate(officialSaidaMin)) {
          let targetSaidaMin = officialSaidaMin
          if (pfInicioMin !== null && officialEntradaMin < pfInicioMin) {
            targetSaidaMin = pfInicioMin
          }
          const offset = getDeterministicOffset(`${seedBase}-saida`, maxVar)
          const genMin = (targetSaidaMin + offset + 24 * 60) % (24 * 60)
          registro.saida = formatMinutesToTimeStr(genMin)
          registro.origem_saida = 'ficticio'
        }

        // 3. Lunch Interval
        if (intervaloMinutos > 0) {
          let targetSaidaMin = officialSaidaMin
          if (pfInicioMin !== null && officialEntradaMin < pfInicioMin) {
            targetSaidaMin = pfInicioMin
          }
          
          if (targetSaidaMin > officialSaidaIntervaloMin) {
            if (shouldPreserve && registroExistente?.origem_saida_intervalo === 'manual') {
              registro.saida_intervalo = registroExistente.saida_intervalo
              registro.origem_saida_intervalo = 'manual'
            } else if (shouldGenerate(officialSaidaIntervaloMin)) {
              const outOffset = getDeterministicOffset(`${seedBase}-lunchout`, maxVar)
              const genOutMin = (officialSaidaIntervaloMin + outOffset + 24 * 60) % (24 * 60)
              registro.saida_intervalo = formatMinutesToTimeStr(genOutMin)
              registro.origem_saida_intervalo = 'ficticio'
            }

            if (shouldPreserve && registroExistente?.origem_retorno_intervalo === 'manual') {
              registro.retorno_intervalo = registroExistente.retorno_intervalo
              registro.origem_retorno_intervalo = 'manual'
            } else if (shouldGenerate(officialRetornoIntervaloMin)) {
              const returnOffset = getDeterministicOffset(`${seedBase}-lunchreturn`, maxVar)
              const genReturnMin = (officialRetornoIntervaloMin + returnOffset + 24 * 60) % (24 * 60)
              registro.retorno_intervalo = formatMinutesToTimeStr(genReturnMin)
              registro.origem_retorno_intervalo = 'ficticio'
            }
          }
        }

        // Preserve manual observation if needed
        if (shouldPreserve && registroExistente && (
          registroExistente.observacao.includes('FALTA') ||
          registroExistente.observacao.includes('MANUAL')
        )) {
          registro.observacao = registroExistente.observacao
        }

        if (registro.observacao.includes('FALTA')) {
          totalFaltas++
        }

        // 4. Overtime Calculation
        const scheduledEntrance = new Date(`${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00-03:00`)
        const scheduledExit = new Date(`${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00-03:00`)
        if (scheduledExit <= scheduledEntrance) {
          scheduledExit.setDate(scheduledExit.getDate() + 1)
        }

        let effectiveScheduledExit = scheduledExit
        if (pfInfo && pfInfo.inicio_liberacao_em && pfInicioMin !== null && officialEntradaMin < pfInicioMin) {
          const releaseHour = Math.floor(pfInicioMin / 60)
          const releaseMin = pfInicioMin % 60
          effectiveScheduledExit = new Date(`${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(releaseHour).padStart(2, '0')}:${String(releaseMin).padStart(2, '0')}:00-03:00`)
        }

        let evalExit: Date | null = null

        if (hasRealSaida && realSaidaTime) {
          evalExit = realSaidaTime
        } else if (registro.saida) {
          const [sH, sM] = registro.saida.split(':').map(Number)
          evalExit = new Date(`${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(sH).padStart(2, '0')}:${String(sM).padStart(2, '0')}:00-03:00`)
          if (sH < startHour || (sH === startHour && sM < startMin)) {
            evalExit.setDate(evalExit.getDate() + 1)
          }
        }

        if (evalExit && evalExit > effectiveScheduledExit) {
          let extra50Min = 0
          let extra100Min = 0

          const current = new Date(effectiveScheduledExit.getTime())
          const end = new Date(evalExit.getTime())

          while (current < end) {
            const localCurrent = new Date(current.getTime() - 3 * 60 * 60 * 1000)
            const curHour = localCurrent.getUTCHours()
            const curDayOfWeek = localCurrent.getUTCDay()
            const curDateStr = `${localCurrent.getUTCFullYear()}-${String(localCurrent.getUTCMonth() + 1).padStart(2, '0')}-${String(localCurrent.getUTCDate()).padStart(2, '0')}`
            const isSunday = curDayOfWeek === 0
            const isHoliday = feriadosSet.has(curDateStr)
            const isNight = curHour >= 22 || curHour < 5

            const isPFLiberado = pfInfo && (
              (pfInfo.inicio_liberacao_em && pfInicioMin !== null && (localCurrent.getUTCHours() * 60 + localCurrent.getUTCMinutes()) >= pfInicioMin) ||
              (pfInfo.fim_liberacao_em && pfFimMin !== null && (localCurrent.getUTCHours() * 60 + localCurrent.getUTCMinutes()) < pfFimMin)
            )

            if (isSunday || isHoliday || isNight || (isPFLiberado && pfInfo && pfInfo.gera_he_para_essenciais)) {
              extra100Min++
            } else {
              extra50Min++
            }

            current.setMinutes(current.getMinutes() + 1)
          }

          registro.hora_extra_minutos = extra50Min + extra100Min
          registro.hora_extra_tipo = extra100Min > 0 ? '100%' : '50%'
          totalExtra50 += extra50Min
          totalExtra100 += extra100Min
        } else {
          registro.hora_extra_minutos = 0
          registro.hora_extra_tipo = null
        }
      }

      registros.push(registro)
    }

    const { error: upsertError } = await supabase
      .from('folha_ponto')
      .upsert({
        escala_mensal_id: escala.id,
        servidor_id: servidorId,
        mes,
        ano,
        status: forcarRascunho ? 'Rascunho' : 'Gerada',
        registros,
        escala_fingerprint: fingerprint,
        total_horas_normais: parseFloat(totalHorasNormais.toFixed(2)),
        total_horas_extras_50: parseFloat((totalExtra50 / 60).toFixed(2)),
        total_horas_extras_100: parseFloat((totalExtra100 / 60).toFixed(2)),
        total_faltas: totalFaltas,
        ultima_edicao_em: new Date().toISOString()
      }, {
        onConflict: 'escala_mensal_id'
      })

    if (upsertError) throw upsertError

    return { success: true }
  } catch (error: any) {
    console.error('Erro ao gerar folha pelo servidor:', error)
    return { error: error.message }
  }
}

export async function checkFolhaPontoHabilitada() {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from('configuracoes_globais')
    .select('valor')
    .eq('chave', 'folha_ponto_habilitada')
    .single()
  return data?.valor === true || data?.valor?.toString() === 'true'
}

