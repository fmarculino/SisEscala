'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { hasSectorAccess, UserProfile, applyAccessFilters } from '@/utils/permissions'
import { autoCloseExpiredScalesAndTimesheets, isCompetencyClosed } from '@/utils/autoClose'

// Helper: Get user profile with unit/sector permissions
async function getUserProfile(supabase: any): Promise<UserProfile> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
    .eq('id', user.id)
    .single()

  if (!profile) throw new Error('Perfil de usuário não encontrado')

  return {
    ...profile,
    permitted_unidades: profile.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: profile.profile_setores?.map((ps: any) => ps.setor_id) || []
  }
}

// Helper: Parse Jornada name string (e.g. "08H ÀS 18H", "07H30 AS 16H30", "19:00 - 07:00")
function parseJornadaNome(nome: string): { startHour: number; startMin: number; endHour: number; endMin: number } {
  const defaultVal = { startHour: 8, startMin: 0, endHour: 17, endMin: 0 }
  if (!nome) return defaultVal

  // Matches pattern: (hours)[h:](minutes)? (às|as|to|-|a) (hours)[h:](minutes)?
  const match = nome.match(/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i)
  if (!match) return defaultVal

  const startHour = parseInt(match[1], 10)
  const startMin = match[2] ? parseInt(match[2], 10) : 0
  const endHour = parseInt(match[3], 10)
  const endMin = match[4] ? parseInt(match[4], 10) : 0

  return { startHour, startMin, endHour, endMin }
}

// Helper: Simple deterministic random offset generator (-14 to +14 minutes, never 0)
function getDeterministicOffset(seedStr: string, maxOffset: number = 15): number {
  let hash = 0
  for (let i = 0; i < seedStr.length; i++) {
    hash = seedStr.charCodeAt(i) + ((hash << 5) - hash)
  }
  const absOffset = (Math.abs(hash) % (maxOffset - 1)) + 1 // 1 to maxOffset-1 (e.g. 1 to 14)
  const sign = hash % 2 === 0 ? 1 : -1
  return sign * absOffset
}

// Helper: Format minutes since midnight back to "HH:MM"
function formatMinutesToTimeStr(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Helper: Generate fingerprint of current scale
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

// Helper: Safely extract code from turn dictionary (which could be an array or object in typings)
function getTurnoCodigo(dicionarioTurnos: any): string | null {
  if (!dicionarioTurnos) return null
  if (Array.isArray(dicionarioTurnos)) {
    return dicionarioTurnos[0]?.codigo || null
  }
  return dicionarioTurnos.codigo || null
}

// Helper: Safely extract name from event types (which could be an array or object in typings)
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
}// List servers for a sector/month with their scale and folha status (unit and sector are optional)
// ONLY includes servers with active scales for the selected competency
export async function getServidoresFolhaPonto(mes: number, ano: number, unidadeId?: string, setorId?: string) {
  try {
    await autoCloseExpiredScalesAndTimesheets()
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // If unit and sector are specifically provided, we check permission for it
    if (unidadeId && setorId) {
      if (!hasSectorAccess(userProfile, setorId, unidadeId)) {
        return { error: 'Acesso negado a este setor/unidade.' }
      }
    }

    // 1. Fetch active scales in this sector/unit/month/year to find all servers who have scales for this period
    let queryEscalas = supabase
      .from('escala_mensal')
      .select('id, status, servidor_id, unidade_id, setor_id, status, jornada_id, jornadas(nome), servidores(id, nome, matricula, cargo)')
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('ativo', true)

    if (unidadeId) {
      queryEscalas = queryEscalas.eq('unidade_id', unidadeId)
    }
    if (setorId) {
      queryEscalas = queryEscalas.eq('setor_id', setorId)
    }

    queryEscalas = applyAccessFilters(queryEscalas, userProfile)

    const { data: escalasMes, error: escError } = await queryEscalas
    if (escError) throw escError

    if (!escalasMes || escalasMes.length === 0) {
      return { servidores: [] }
    }

    // 2. Fetch existing sheets for these specific scales
    const scaleIds = escalasMes.map(e => e.id)
    const { data: folhas, error: folhaError } = await supabase
      .from('folha_ponto')
      .select('id, status, servidor_id, escala_mensal_id, total_horas_normais, total_horas_extras_50, total_horas_extras_100, total_faltas, cargo')
      .in('escala_mensal_id', scaleIds)

    if (folhaError) throw folhaError

    // 3. Map together
    const result = escalasMes
      .map(escala => {
        const servidor = escala.servidores as any
        if (!servidor) return null

        const folha = folhas?.find(f => f.escala_mensal_id === escala.id)

        return {
          servidor_id: servidor.id,
          nome: servidor.nome,
          matricula: servidor.matricula,
          cargo: folha?.cargo || servidor.cargo,
          escala_mensal_id: escala.id,
          escala_status: escala.status,
          folha_id: folha?.id || null,
          folha_status: folha?.status || 'Não Gerada',
          jornada_nome: (escala.jornadas as any)?.nome || 'Não Vinculada',
          total_horas_normais: folha?.total_horas_normais || 0,
          total_horas_extras_50: folha?.total_horas_extras_50 || 0,
          total_horas_extras_100: folha?.total_horas_extras_100 || 0,
          total_faltas: folha?.total_faltas || 0,
        }
      })
      .filter(Boolean) as any[]

    // Sort alphabetically by server name
    result.sort((a, b) => a.nome.localeCompare(b.nome))

    return { servidores: result }
  } catch (error: any) {
    console.error('Erro em getServidoresFolhaPonto:', error)
    return { error: error.message }
  }
}

// Generate (or regenerate) a timesheet for a server
// Core logic to generate or regenerate a timesheet for a server (bypasses permission checks for admin/cron use)
export async function executeGerarFolhaPonto(
  supabase: any,
  servidorId: string,
  mes: number,
  ano: number,
  targetStatus: 'Rascunho' | 'Gerada' | 'Revisada',
  escalaMensalId?: string,
  geradoPorId?: string | null
) {
  try {
    let escala: any = null

    if (escalaMensalId) {
      const { data: esc, error: escError } = await supabase
        .from('escala_mensal')
        .select('id, status, unidade_id, setor_id, mes, ano, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais)')
        .eq('id', escalaMensalId)
        .single()
      if (escError) throw escError
      escala = esc
    } else {
      // Find matching scale for this server, month, year
      const { data: serverInfo } = await supabase
        .from('servidores')
        .select('unidade_id, setor_id')
        .eq('id', servidorId)
        .single()

      const query = supabase
        .from('escala_mensal')
        .select('id, status, unidade_id, setor_id, mes, ano, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais)')
        .eq('servidor_id', servidorId)
        .eq('mes', mes)
        .eq('ano', ano)
        .eq('ativo', true)

      if (serverInfo?.unidade_id && serverInfo?.setor_id) {
        const { data: match } = await query
          .eq('unidade_id', serverInfo.unidade_id)
          .eq('setor_id', serverInfo.setor_id)
          .maybeSingle()
        if (match) {
          escala = match
        }
      }

      if (!escala) {
        const { data: list } = await supabase
          .from('escala_mensal')
          .select('id, status, unidade_id, setor_id, mes, ano, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais)')
          .eq('servidor_id', servidorId)
          .eq('mes', mes)
          .eq('ano', ano)
          .eq('ativo', true)
          .limit(1)
        if (list && list.length > 0) {
          escala = list[0]
        }
      }
    }

    if (!escala) {
      return { error: 'Servidor não possui escala regular criada neste setor para o mês selecionado.' }
    }

    const resolvedMes = escala.mes
    const resolvedAno = escala.ano

    if (await isCompetencyClosed(resolvedMes, resolvedAno)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    // Fetch server details
    const { data: servidor, error: servError } = await supabase
      .from('servidores')
      .select('id, nome, matricula, cargo')
      .eq('id', servidorId)
      .single()

    if (servError || !servidor) throw new Error('Servidor não encontrado')

    // Fetch config for tolerance
    const { data: configVar } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'folha_ponto_variacao_minutos')
      .single()
    const maxVar = configVar?.valor ? parseInt(configVar.valor as string, 10) : 15

    // Fetch all shifts from escala_diaria (including Extra and Plantão) for the specific scale of this folha
    const { data: escalaDiaria, error: diError } = await supabase
      .from('escala_diaria')
      .select('id, dia, categoria, dicionario_turnos_id, presenca_entrada_em, presenca_saida_em, presenca_confirmada, dicionario_turnos(codigo, slots)')
      .eq('escala_mensal_id', escala.id)

    if (diError) throw diError

    // Fetch manual validation logs for the specific scale of this folha
    const { data: logs } = await supabase
      .from('logs_sobreaviso')
      .select('dia, categoria, validacao_manual, motivo_acionamento')
      .eq('escala_mensal_id', escala.id)

    // Fetch holidays
    const startDate = `${resolvedAno}-${String(resolvedMes).padStart(2, '0')}-01`
    const daysInMonth = new Date(resolvedAno, resolvedMes, 0).getDate()
    const endDate = `${resolvedAno}-${String(resolvedMes).padStart(2, '0')}-${daysInMonth}`
    
    const { data: feriados } = await supabase
      .from('feriados')
      .select('data, descricao')
      .gte('data', startDate)
      .lte('data', endDate)

    const feriadosSet = new Set(feriados?.map((f: any) => f.data) || [])

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

    // Fetch existing folha if exists to preserve manual edits and cargo
    const { data: existingFolha } = await supabase
      .from('folha_ponto')
      .select('registros, cargo')
      .eq('escala_mensal_id', escala.id)
      .maybeSingle()

    const registrosExistentes = existingFolha?.registros as any[] || []

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

    const registros: any[] = []
    let totalHorasNormais = 0
    let totalExtra50 = 0
    let totalExtra100 = 0
    let totalFaltas = 0

    const weekDaysShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(resolvedAno, resolvedMes - 1, day)
      const dayOfWeekStr = weekDaysShort[dateObj.getDay()]
      const dateStr = `${resolvedAno}-${String(resolvedMes).padStart(2, '0')}-${String(day).padStart(2, '0')}`

      // Resolve dynamic journey for this day
      const tempJourney = tempJourneys?.find((tj: any) => dateStr >= tj.data_inicio && dateStr <= tj.data_fim)
      const activeJornada = tempJourney ? tempJourney.jornadas : globalJornadaDetails
      const { startHour, startMin, endHour, endMin } = activeJornada === globalJornadaDetails ? globalJornada : parseJornadaNome(activeJornada?.nome || '')
      const intervaloMinutos = activeJornada === globalJornadaDetails ? globalIntervaloMinutos : (activeJornada?.intervalo_minutos ?? 60)
      const horasNormaisDiarias = activeJornada === globalJornadaDetails ? globalHorasNormaisDiarias : (activeJornada?.horas_totais ?? 8)

      // Check afastamento
      const rawAfastamento = afastamentos?.find((af: any) => dateStr >= af.data_inicio && dateStr <= af.data_fim)
      const shift = escalaDiaria?.find((ed: any) => ed.dia === day && ed.categoria === 'Regular')
      const afastamento = isShiftOverlappingAfastamento(rawAfastamento, shift) ? rawAfastamento : null
      
      // Check holiday
      const feriadoInfo = feriados?.find((f: any) => f.data === dateStr)

      // Check manual edits in existing record to preserve them
      const registroExistente = registrosExistentes.find((r: any) => r.dia === day)
      const hasManualEdits = registroExistente && (
        registroExistente.origem_entrada === 'manual' ||
        registroExistente.origem_saida_intervalo === 'manual' ||
        registroExistente.origem_retorno_intervalo === 'manual' ||
        registroExistente.origem_saida === 'manual' ||
        registroExistente.observacao.includes('FALTA') ||
        registroExistente.observacao.includes('MANUAL')
      )

      if (hasManualEdits) {
        registros.push(registroExistente)
        if (registroExistente.turno_codigo) {
          totalHorasNormais += horasNormaisDiarias
        }
        if (registroExistente.observacao.includes('FALTA')) {
          totalFaltas++
        }
        if (registroExistente.hora_extra_minutos) {
          const isSunday = dateObj.getDay() === 0
          const isHoliday = !!feriadoInfo
          if (isSunday || isHoliday) {
            totalExtra100 += registroExistente.hora_extra_minutos
          } else {
            totalExtra50 += registroExistente.hora_extra_minutos
          }
        }
        continue
      }

      // Helper function to check if we should generate time for a scheduled marker
      const shouldGenerate = (scheduledMin: number) => {
        if (resolvedAno > currentYear) return false
        if (resolvedAno < currentYear) return true
        if (resolvedMes > currentMonth) return false
        if (resolvedMes < currentMonth) return true
        if (day > currentDay) return false
        if (day < currentDay) return true
        return currentTotalMin >= (scheduledMin % 1440)
      }

      // Check if point facultativo applies
      const pf = pontosFacultativos?.find((p: any) => p.data === dateStr)
      let pfInfo = null
      if (pf) {
        const rule = pfSetores?.find((r: any) => r.ponto_facultativo_id === pf.id && r.setor_id === escala.setor_id)
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
        afastamento: afastamento ? getAfastamentoObservacao(afastamento) : null,
        jornada_nome: activeJornada?.nome || null,
        jornada_temporaria: !!tempJourney,
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
        // Rest day (folga)
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
        // Work day!
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
        const isManualEntrada = logs?.some((log: any) => 
          log.dia === day && 
          log.categoria === 'Regular' && 
          log.validacao_manual === true && 
          log.motivo_acionamento?.toLowerCase().includes('entrada')
        )
        const isManualSaida = logs?.some((log: any) => 
          log.dia === day && 
          log.categoria === 'Regular' && 
          log.validacao_manual === true && 
          log.motivo_acionamento?.toLowerCase().includes('saida')
        )

        // Check if there was presence confirmada on any shift for this day (Regular, Extra, Plantão)
        const dayShifts = escalaDiaria?.filter((d: any) => d.dia === day) || []
        const allEntradas = dayShifts.map((s: any) => s.presenca_entrada_em).filter(Boolean)
        const allSaidas = dayShifts.map((s: any) => s.presenca_saida_em).filter(Boolean)
        
        const realEntradaTime = allEntradas.length > 0 ? new Date(Math.min(...allEntradas.map((t: any) => new Date(t).getTime()))) : null
        const realSaidaTime = allSaidas.length > 0 ? new Date(Math.max(...allSaidas.map((t: any) => new Date(t).getTime()))) : null

        const hasRealEntrada = realEntradaTime !== null && !isManualEntrada
        const hasRealSaida = realSaidaTime !== null && !isManualSaida

        // Calculate official time markers (in minutes from midnight)
        const officialEntradaMin = startHour * 60 + startMin
        let officialSaidaMin = endHour * 60 + endMin
        let totalBrutoMin = officialSaidaMin - officialEntradaMin
        if (totalBrutoMin < 0) {
          totalBrutoMin += 24 * 60
        }
        
        // Midpoint of shift for lunch out
        const halfJornadaMin = Math.floor(totalBrutoMin / 2)
        const officialSaidaIntervaloMin = (officialEntradaMin + halfJornadaMin) % (24 * 60)
        const officialRetornoIntervaloMin = (officialSaidaIntervaloMin + intervaloMinutos) % (24 * 60)

        // Generate seeds for deterministic fictitious times
        const seedBase = `${servidorId}-${resolvedMes}-${resolvedAno}-${day}`

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
        if (hasRealEntrada && realEntradaTime) {
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
        if (hasRealSaida && realSaidaTime) {
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
            // Lunch out
            if (shouldGenerate(officialSaidaIntervaloMin)) {
              const outOffset = getDeterministicOffset(`${seedBase}-lunchout`, maxVar)
              const genOutMin = (officialSaidaIntervaloMin + outOffset + 24 * 60) % (24 * 60)
              registro.saida_intervalo = formatMinutesToTimeStr(genOutMin)
              registro.origem_saida_intervalo = 'ficticio'
            }

            // Lunch return
            if (shouldGenerate(officialRetornoIntervaloMin)) {
              const returnOffset = getDeterministicOffset(`${seedBase}-lunchreturn`, maxVar)
              const genReturnMin = (officialRetornoIntervaloMin + returnOffset + 24 * 60) % (24 * 60)
              registro.retorno_intervalo = formatMinutesToTimeStr(genReturnMin)
              registro.origem_retorno_intervalo = 'ficticio'
            }
          }
        }

        // 4. Overtime Calculation (Real Exit only)
        if (hasRealSaida && realSaidaTime) {
          const realExit = realSaidaTime
          
          // Official scheduled exit timestamp
          const scheduledEntrance = new Date(`${resolvedAno}-${String(resolvedMes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00-03:00`)
          const scheduledExit = new Date(`${resolvedAno}-${String(resolvedMes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00-03:00`)
          if (scheduledExit <= scheduledEntrance) {
            scheduledExit.setDate(scheduledExit.getDate() + 1) // crosses midnight
          }

          let effectiveScheduledExit = scheduledExit
          if (pfInfo && pfInfo.inicio_liberacao_em && pfInicioMin !== null && officialEntradaMin < pfInicioMin) {
            const releaseHour = Math.floor(pfInicioMin / 60)
            const releaseMin = pfInicioMin % 60
            effectiveScheduledExit = new Date(`${resolvedAno}-${String(resolvedMes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(releaseHour).padStart(2, '0')}:${String(releaseMin).padStart(2, '0')}:00-03:00`)
          }

          if (realExit > effectiveScheduledExit) {
            // Calculate extra minutes minute-by-minute
            let extra50Min = 0
            let extra100Min = 0
            
            const current = new Date(effectiveScheduledExit.getTime())
            const end = new Date(realExit.getTime())
            
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
            totalExtra50 += extra50Min
            totalExtra100 += extra100Min
          }
        }
      }

      registros.push(registro)
    }

    // Scale fingerprint for change detection
    const fingerprint = generateFingerprint(escalaDiaria)

    // Save to public.folha_ponto
    const { data: savedFolha, error: saveError } = await supabase
      .from('folha_ponto')
      .upsert({
        escala_mensal_id: escala.id,
        servidor_id: servidorId,
        mes: resolvedMes,
        ano: resolvedAno,
        status: targetStatus,
        registros,
        escala_fingerprint: fingerprint,
        total_horas_normais: parseFloat(totalHorasNormais.toFixed(2)),
        total_horas_extras_50: parseFloat((totalExtra50 / 60).toFixed(2)),
        total_horas_extras_100: parseFloat((totalExtra100 / 60).toFixed(2)),
        total_faltas: totalFaltas,
        gerado_por_id: geradoPorId,
        gerado_em: new Date().toISOString(),
        cargo: existingFolha?.cargo || servidor.cargo
      }, { onConflict: 'escala_mensal_id' })
      .select('id')
      .single()

    if (saveError) throw saveError

    return { success: true, folha_id: savedFolha.id }
  } catch (error: any) {
    console.error('Erro ao gerar folha de ponto:', error)
    return { error: error.message }
  }
}

// Generate (or regenerate) a timesheet for a server
export async function gerarFolhaPonto(
  servidorId: string,
  mes: number,
  ano: number,
  forcarRascunho: boolean = false,
  escalaMensalId?: string
) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    let escala: any = null

    if (escalaMensalId) {
      const { data: esc, error: escError } = await supabase
        .from('escala_mensal')
        .select('id, status, unidade_id, setor_id, mes, ano, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais)')
        .eq('id', escalaMensalId)
        .single()
      if (escError) throw escError
      escala = esc
    } else {
      // Find matching scale for this server, month, year
      const { data: serverInfo } = await supabase
        .from('servidores')
        .select('unidade_id, setor_id')
        .eq('id', servidorId)
        .single()

      const query = supabase
        .from('escala_mensal')
        .select('id, status, unidade_id, setor_id, mes, ano, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais)')
        .eq('servidor_id', servidorId)
        .eq('mes', mes)
        .eq('ano', ano)
        .eq('ativo', true)

      if (serverInfo?.unidade_id && serverInfo?.setor_id) {
        const { data: match } = await query
          .eq('unidade_id', serverInfo.unidade_id)
          .eq('setor_id', serverInfo.setor_id)
          .maybeSingle()
        if (match) {
          escala = match
        }
      }

      if (!escala) {
        const { data: list } = await supabase
          .from('escala_mensal')
          .select('id, status, unidade_id, setor_id, mes, ano, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais)')
          .eq('servidor_id', servidorId)
          .eq('mes', mes)
          .eq('ano', ano)
          .eq('ativo', true)
          .limit(1)
        if (list && list.length > 0) {
          escala = list[0]
        }
      }
    }

    if (!escala) {
      return { error: 'Servidor não possui escala regular criada neste setor para o mês selecionado.' }
    }

    const resolvedMes = escala.mes
    const resolvedAno = escala.ano
    const resolvedUnidadeId = escala.unidade_id
    const resolvedSetorId = escala.setor_id

    if (await isCompetencyClosed(resolvedMes, resolvedAno)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    // Security check using scale's unit and sector
    if (!resolvedUnidadeId || !resolvedSetorId || !hasSectorAccess(userProfile, resolvedSetorId, resolvedUnidadeId)) {
      return { error: 'Acesso negado às escalas deste servidor.' }
    }

    // Check status requirement
    if (escala.status === 'Em Andamento' && !forcarRascunho) {
      return { error: 'A escala do servidor está Em Andamento. Você deve gerar como Rascunho.' }
    }

    const res = await executeGerarFolhaPonto(
      supabase,
      servidorId,
      mes,
      ano,
      forcarRascunho ? 'Rascunho' : 'Gerada',
      escala.id,
      userProfile.id
    )

    if (res.success) {
      revalidatePath('/folha-ponto')
    }

    return res
  } catch (error: any) {
    console.error('Erro ao gerar folha de ponto:', error)
    return { error: error.message }
  }
}

// Generate in bulk for all servers in a sector (unit and sector are optional)
export async function gerarFolhasEmLote(
  mes: number,
  ano: number,
  unidadeId?: string,
  setorId?: string,
  forcarRascunho: boolean = false
) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // Fetch scales for this month/year, optionally filtered by unit and sector
    let queryEscalas = supabase
      .from('escala_mensal')
      .select('id, servidor_id, unidade_id, setor_id')
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('ativo', true)

    if (unidadeId) {
      queryEscalas = queryEscalas.eq('unidade_id', unidadeId)
    }
    if (setorId) {
      queryEscalas = queryEscalas.eq('setor_id', setorId)
    }

    // Apply security filters at DB level
    queryEscalas = applyAccessFilters(queryEscalas, userProfile)

    const { data: escalas, error: escError } = await queryEscalas

    if (escError) throw escError
    if (!escalas || escalas.length === 0) {
      return { error: 'Nenhuma escala ativa encontrada para a competência selecionada.' }
    }

    let geradas = 0
    let erros = 0

    for (const esc of escalas) {
      const res = await executeGerarFolhaPonto(
        supabase,
        esc.servidor_id,
        mes,
        ano,
        forcarRascunho ? 'Rascunho' : 'Gerada',
        esc.id,
        userProfile.id
      )
      if (res.success) {
        geradas++
      } else {
        erros++
      }
    }

    revalidatePath('/folha-ponto')
    return { success: true, message: `${geradas} folhas geradas com sucesso. ${erros} falhas.` }
  } catch (error: any) {
    console.error('Erro na geração em lote:', error)
    return { error: error.message }
  }
}

// Sincronizar Folha Ponto (after scale changes)
export async function sincronizarFolhaPonto(folhaId: string) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // Fetch the existing folha
    const { data: folha, error: folhaError } = await supabase
      .from('folha_ponto')
      .select('*')
      .eq('id', folhaId)
      .single()

    if (folhaError || !folha) throw new Error('Folha de ponto não encontrada')

    if (await isCompetencyClosed(folha.mes, folha.ano)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    // Fetch scale
    const { data: escala, error: escError } = await supabase
      .from('escala_mensal')
      .select('id, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais), unidade_id, setor_id')
      .eq('id', folha.escala_mensal_id)
      .single()

    if (escError || !escala) throw new Error('Escala vinculada não encontrada')

    // Security check
    if (!hasSectorAccess(userProfile, escala.setor_id, escala.unidade_id)) {
      return { error: 'Acesso negado para gerenciar esta folha.' }
    }

    // Fetch all shifts from escala_diaria (Regular, Extra, Plantão) for the specific scale of this folha
    const { data: escalaDiaria } = await supabase
      .from('escala_diaria')
      .select('id, dia, categoria, dicionario_turnos_id, presenca_entrada_em, presenca_saida_em, presenca_confirmada, dicionario_turnos(codigo, slots)')
      .eq('escala_mensal_id', escala.id)

    // Fetch manual validation logs for the specific scale of this folha
    const { data: logs } = await supabase
      .from('logs_sobreaviso')
      .select('dia, categoria, validacao_manual, motivo_acionamento')
      .eq('escala_mensal_id', escala.id)

    const currentShifts = escalaDiaria || []
    const fingerprint = generateFingerprint(currentShifts.filter(d => d.categoria === 'Regular'))

    // Fetch holidays
    const startDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-01`
    const daysInMonth = new Date(folha.ano, folha.mes, 0).getDate()
    const endDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-${daysInMonth}`
    const { data: feriados } = await supabase
      .from('feriados')
      .select('data, descricao')
      .gte('data', startDate)
      .lte('data', endDate)

    const feriadosSet = new Set(feriados?.map(f => f.data) || [])

    // Fetch absences
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
      const registroExistente = registrosExistentes.find(r => r.dia === day)

      // Check if this day's scale actually changed (shift presence vs existing record)
      const hadShift = registroExistente && registroExistente.turno_codigo !== null
      const hasShift = !!currentShift

      const scaleChangedForDay = (hadShift !== hasShift) || (hadShift && registroExistente.turno_codigo !== getTurnoCodigo(currentShift?.dicionario_turnos))

      // Check afastamento and holidays
      const rawAfastamento = afastamentos?.find(af => dateStr >= af.data_inicio && dateStr <= af.data_fim)
      const afastamento = isShiftOverlappingAfastamento(rawAfastamento, currentShift) ? rawAfastamento : null
      const feriadoInfo = feriados?.find(f => f.data === dateStr)

      // Core logic: If day changed, or if it had no manual edits, we regenerate it.
      // If it had manual edits AND scale DID NOT change, we preserve it.
      const hasManualEdits = registroExistente && (
        registroExistente.origem_entrada === 'manual' ||
        registroExistente.origem_saida_intervalo === 'manual' ||
        registroExistente.origem_retorno_intervalo === 'manual' ||
        registroExistente.origem_saida === 'manual' ||
        registroExistente.observacao.includes('FALTA') || // preserve manually added observations like faltou
        registroExistente.observacao.includes('MANUAL')
      )

      if (hasManualEdits && !scaleChangedForDay) {
        // PRESERVE the entire record if manual edits exist and scale didn't change for this specific day
        registrosAtualizados.push(registroExistente)
        
        // Recalculate totals from this preserved day
        if (registroExistente.turno_codigo) {
          totalHorasNormais += horasNormaisDiarias
        }
        if (registroExistente.observacao.includes('FALTA')) {
          totalFaltas++
        }
        
        // Count manual extra hours
        if (registroExistente.hora_extra_minutos) {
          // Approximate calculation based on day of week / holiday
          const isSunday = dateObj.getDay() === 0
          const isHoliday = !!feriadoInfo
          if (isSunday || isHoliday) {
            totalExtra100 += registroExistente.hora_extra_minutos
          } else {
            // Divide into 50% since we don't have night minute details, or keep it simple
            totalExtra50 += registroExistente.hora_extra_minutos
          }
        }
        continue
      }

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
        afastamento: afastamento ? getAfastamentoObservacao(afastamento) : null,
        jornada_nome: activeJornada?.nome || null,
        jornada_temporaria: !!tempJourney,
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

        // Check if there was presence confirmada on any shift for this day (Regular, Extra, Plantão)
        const dayShifts = currentShifts.filter(d => d.dia === day)
        const allEntradas = dayShifts.map(s => s.presenca_entrada_em).filter(Boolean)
        const allSaidas = dayShifts.map(s => s.presenca_saida_em).filter(Boolean)
        
        const realEntradaTime = allEntradas.length > 0 ? new Date(Math.min(...allEntradas.map(t => new Date(t).getTime()))) : null
        const realSaidaTime = allSaidas.length > 0 ? new Date(Math.max(...allSaidas.map(t => new Date(t).getTime()))) : null

        const hasRealEntrada = realEntradaTime !== null && !isManualEntrada
        const hasRealSaida = realSaidaTime !== null && !isManualSaida

        const officialEntradaMin = startHour * 60 + startMin
        let officialSaidaMin = endHour * 60 + endMin
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

        if (hasRealEntrada && realEntradaTime) {
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

        if (hasRealSaida && realSaidaTime) {
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

        if (intervaloMinutos > 0) {
          let targetSaidaMin = officialSaidaMin
          if (pfInicioMin !== null && officialEntradaMin < pfInicioMin) {
            targetSaidaMin = pfInicioMin
          }

          if (targetSaidaMin > officialSaidaIntervaloMin) {
            if (shouldGenerate(officialSaidaIntervaloMin)) {
              const outOffset = getDeterministicOffset(`${seedBase}-lunchout`, maxVar)
              const genOutMin = (officialSaidaIntervaloMin + outOffset + 24 * 60) % (24 * 60)
              registro.saida_intervalo = formatMinutesToTimeStr(genOutMin)
              registro.origem_saida_intervalo = 'ficticio'
            }

            if (shouldGenerate(officialRetornoIntervaloMin)) {
              const returnOffset = getDeterministicOffset(`${seedBase}-lunchreturn`, maxVar)
              const genReturnMin = (officialRetornoIntervaloMin + returnOffset + 24 * 60) % (24 * 60)
              registro.retorno_intervalo = formatMinutesToTimeStr(genReturnMin)
              registro.origem_retorno_intervalo = 'ficticio'
            }
          }
        }

        if (hasRealSaida && realSaidaTime) {
          const realExit = realSaidaTime
          
          const scheduledEntrance = new Date(`${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00-03:00`)
          const scheduledExit = new Date(`${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00-03:00`)
          if (scheduledExit <= scheduledEntrance) {
            scheduledExit.setDate(scheduledExit.getDate() + 1)
          }

          if (realExit > scheduledExit) {
            let extra50Min = 0
            let extra100Min = 0
            
            const current = new Date(scheduledExit.getTime())
            const end = new Date(realExit.getTime())
            
            while (current < end) {
              const localCurrent = new Date(current.getTime() - 3 * 60 * 60 * 1000)
              const curHour = localCurrent.getUTCHours()
              const curDayOfWeek = localCurrent.getUTCDay()
              const curDateStr = `${localCurrent.getUTCFullYear()}-${String(localCurrent.getUTCMonth() + 1).padStart(2, '0')}-${String(localCurrent.getUTCDate()).padStart(2, '0')}`
              const isSunday = curDayOfWeek === 0
              const isHoliday = feriadosSet.has(curDateStr)
              const isNight = curHour >= 22 || curHour < 5

              if (isSunday || isHoliday || isNight) {
                extra100Min++
              } else {
                extra50Min++
              }
              
              current.setMinutes(current.getMinutes() + 1)
            }

            registro.hora_extra_minutos = extra50Min + extra100Min
            totalExtra50 += extra50Min
            totalExtra100 += extra100Min
          }
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
        ultima_edicao_por_id: userProfile.id,
        ultima_edicao_em: new Date().toISOString()
      })
      .eq('id', folhaId)

    if (saveError) throw saveError

    revalidatePath(`/folha-ponto/${folhaId}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro na sincronização de folha:', error)
    return { error: error.message }
  }
}

// Persist edited timesheet records from the UI editor
export async function salvarFolhaPonto(folhaId: string, registros: any[], status?: string, cargo?: string) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // Fetch existing sheet to check values and lotação permission
    const { data: folha, error: fetchError } = await supabase
      .from('folha_ponto')
      .select('escala_mensal_id, mes, ano, servidor_id, registros, status')
      .eq('id', folhaId)
      .single()

    if (fetchError || !folha) throw new Error('Folha de ponto não encontrada')

    if (await isCompetencyClosed(folha.mes, folha.ano)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    // Bloquear alteração de marcações reais (origem = 'real') para quem não for super_admin
    if (userProfile.role !== 'super_admin') {
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
    }

    const { data: escala } = await supabase
      .from('escala_mensal')
      .select('unidade_id, setor_id, status, jornada_id, jornadas(horas_totais, nome, intervalo_minutos)')
      .eq('id', folha.escala_mensal_id)
      .single()

    if (!escala) throw new Error('Escala vinculada não encontrada')

    // Security check
    if (!hasSectorAccess(userProfile, escala.setor_id, escala.unidade_id)) {
      return { error: 'Acesso negado para gerenciar esta folha.' }
    }

    // Se a folha estiver Revisada, apenas super_admin e admin podem reabri-la (passando status !== 'Revisada')
    if (folha.status === 'Revisada') {
      if (status !== 'Gerada' && status !== 'Rascunho') {
        return { error: 'Esta folha de ponto está fechada (Revisada). Reabra-a antes de fazer edições.' }
      }
      if (userProfile.role !== 'super_admin' && userProfile.role !== 'admin') {
        return { error: 'Apenas administradores podem reabrir uma folha de ponto fechada.' }
      }
    }

    const jornadaDetails = escala.jornadas ? (escala.jornadas as any) : null
    const horasNormaisDiarias = jornadaDetails?.horas_totais ?? 8

    // Fetch holidays of the month for overtime classification
    const startDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-01`
    const daysInMonth = new Date(folha.ano, folha.mes, 0).getDate()
    const endDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-${daysInMonth}`
    const { data: feriados } = await supabase
      .from('feriados')
      .select('data')
      .gte('data', startDate)
      .lte('data', endDate)
    const feriadosSet = new Set(feriados?.map(f => f.data) || [])

    // Recalculate totals
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

      // Check extra hours
      if (r.hora_extra_minutos && r.hora_extra_minutos > 0) {
        const dateObj = new Date(folha.ano, folha.mes - 1, r.dia)
        const dateStr = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(r.dia).padStart(2, '0')}`
        const isSunday = dateObj.getDay() === 0
        const isHoliday = feriadosSet.has(dateStr)

        if (isSunday || isHoliday) {
          totalExtra100 += r.hora_extra_minutos
        } else {
          // If night shift or coordinator split, otherwise default to 50% on normal edits unless flag is present
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
      ultima_edicao_por_id: userProfile.id,
      ultima_edicao_em: new Date().toISOString()
    }

    if (status) {
      updatePayload.status = status
    }

    if (cargo !== undefined) {
      updatePayload.cargo = cargo
    }

    const { error: updateError } = await supabase
      .from('folha_ponto')
      .update(updatePayload)
      .eq('id', folhaId)

    if (updateError) throw updateError

    revalidatePath(`/folha-ponto/${folhaId}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar folha de ponto:', error)
    return { error: error.message }
  }
}

// Get the fingerprint comparison to check if sync is needed
export async function verificarDivergenciaEscala(folhaId: string) {
  try {
    const supabase = await createClient()

    const { data: folha } = await supabase
      .from('folha_ponto')
      .select('escala_mensal_id, escala_fingerprint, registros')
      .eq('id', folhaId)
      .single()

    if (!folha) return { divergent: false }

    const { data: escalaDiaria } = await supabase
      .from('escala_diaria')
      .select('dia, dicionario_turnos_id, categoria, dicionario_turnos(codigo)')
      .eq('escala_mensal_id', folha.escala_mensal_id)
      .eq('categoria', 'Regular')

    const currentFingerprint = generateFingerprint(escalaDiaria || [])
    const divergent = currentFingerprint !== folha.escala_fingerprint

    // Find affected days
    const affectedDays: number[] = []
    if (divergent) {
      const records = folha.registros as any[]
      const currentShifts = escalaDiaria || []

      // Check each day of month (assume 1 to 31)
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
    console.error('Erro ao verificar divergência:', error)
    return { divergent: false }
  }
}

// Fetch complete print data for multiple timesheets (folhas de ponto) in batch
export async function getFolhasPontoPrintData(folhaIds: string[]) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // Fetch global logo config
    const { data: logoData } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'instituicao_cabecalho_url')
      .single()
    const logoUrl = logoData?.valor || ''

    // Fetch the folhas with server details
    const { data: folhas, error: folhaError } = await supabase
      .from('folha_ponto')
      .select('*, servidores(*)')
      .in('id', folhaIds)

    if (folhaError) throw folhaError
    if (!folhas || folhas.length === 0) return { error: 'Nenhuma folha encontrada.' }

    // Fetch scales
    const escalaIds = folhas.map(f => f.escala_mensal_id)
    const { data: escalas, error: escError } = await supabase
      .from('escala_mensal')
      .select('*, unidades(*), setores(*, dicionario_setores(nome)), jornadas(*)')
      .in('id', escalaIds)

    if (escError) throw escError

    const mappedFolhas = []
    for (const folha of folhas) {
      const escala = escalas?.find(e => e.id === folha.escala_mensal_id)
      if (!escala) continue

      if (!hasSectorAccess(userProfile, escala.setor_id, escala.unidade_id)) {
        continue
      }

      let finalFolha = folha
      if (checkIfFolhaHasPendingPastTimes(folha, escala)) {
        await sincronizarFolhaPonto(folha.id)
        const { data: updated } = await supabase
          .from('folha_ponto')
          .select('*, servidores(*)')
          .eq('id', folha.id)
          .maybeSingle()
        if (updated) {
          finalFolha = updated
        }
      }

      const sectorData = Array.isArray(escala.setores) ? escala.setores[0] : escala.setores
      const dictData = sectorData ? (Array.isArray(sectorData.dicionario_setores) 
        ? sectorData.dicionario_setores[0] 
        : sectorData.dicionario_setores) : null

      const resolvedSetor = sectorData ? {
        ...sectorData,
        nome: dictData?.nome || 'SETOR SEM NOME'
      } : null

      mappedFolhas.push({
        ...finalFolha,
        escala: {
          ...escala,
          setores: resolvedSetor
        }
      })
    }

    return { folhas: mappedFolhas, logoUrl }
  } catch (error: any) {
    console.error('Erro em getFolhasPontoPrintData:', error)
    return { error: error.message }
  }
}

export function checkIfFolhaHasPendingPastTimes(folha: any, escala: any, timezone: string = 'America/Sao_Paulo'): boolean {
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

