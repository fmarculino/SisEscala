'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { hasSectorAccess, UserProfile } from '@/utils/permissions'

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
    turno: r.dicionario_turnos_id,
    cat: r.categoria
  }))
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


// List servers for a sector/month with their scale and folha status
export async function getServidoresFolhaPonto(mes: number, ano: number, unidadeId: string, setorId: string) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // Security check
    if (!hasSectorAccess(userProfile, setorId, unidadeId)) {
      return { error: 'Acesso negado a este setor/unidade.' }
    }

    // 1. Fetch servers allocated in this unit & sector
    const { data: servidores, error: servError } = await supabase
      .from('servidores')
      .select('id, nome, matricula, cargo')
      .eq('unidade_id', unidadeId)
      .eq('setor_id', setorId)
      .eq('status', 'Ativo')
      .order('nome')

    if (servError) throw servError
    if (!servidores || servidores.length === 0) return { servidores: [] }

    const serverIds = servidores.map(s => s.id)

    // 2. Fetch scales for these servers in this month
    const { data: escalas, error: escError } = await supabase
      .from('escala_mensal')
      .select('id, status, servidor_id, jornada_id, jornadas(nome)')
      .in('servidor_id', serverIds)
      .eq('unidade_id', unidadeId)
      .eq('setor_id', setorId)
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('ativo', true)

    if (escError) throw escError

    // 3. Fetch existing folhas
    const { data: folhas, error: folhaError } = await supabase
      .from('folha_ponto')
      .select('id, status, servidor_id, total_horas_normais, total_horas_extras_50, total_horas_extras_100, total_faltas')
      .in('servidor_id', serverIds)
      .eq('mes', mes)
      .eq('ano', ano)

    if (folhaError) throw folhaError

    // 4. Map together
    const mapped = servidores.map(s => {
      const escala = escalas?.find(e => e.servidor_id === s.id)
      const folha = folhas?.find(f => f.servidor_id === s.id)

      return {
        servidor_id: s.id,
        nome: s.nome,
        matricula: s.matricula,
        cargo: s.cargo,
        escala_mensal_id: escala?.id || null,
        escala_status: escala?.status || 'Sem Escala',
        folha_id: folha?.id || null,
        folha_status: folha?.status || 'Não Gerada',
        jornada_nome: (escala?.jornadas as any)?.nome || 'Não Vinculada',
        total_horas_normais: folha?.total_horas_normais || 0,
        total_horas_extras_50: folha?.total_horas_extras_50 || 0,
        total_horas_extras_100: folha?.total_horas_extras_100 || 0,
        total_faltas: folha?.total_faltas || 0,
      }
    })

    return { servidores: mapped }
  } catch (error: any) {
    console.error('Erro em getServidoresFolhaPonto:', error)
    return { error: error.message }
  }
}

// Generate (or regenerate) a timesheet for a server
export async function gerarFolhaPonto(servidorId: string, mes: number, ano: number, forcarRascunho: boolean = false) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // Fetch server lotação details
    const { data: servidor, error: servError } = await supabase
      .from('servidores')
      .select('id, unidade_id, setor_id, nome, matricula')
      .eq('id', servidorId)
      .single()

    if (servError || !servidor) throw new Error('Servidor não encontrado')

    // Security check
    if (!servidor.unidade_id || !servidor.setor_id || !hasSectorAccess(userProfile, servidor.setor_id, servidor.unidade_id)) {
      return { error: 'Acesso negado às escalas deste servidor.' }
    }

    // Fetch the active lotação escala_mensal
    const { data: escala, error: escError } = await supabase
      .from('escala_mensal')
      .select('id, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais)')
      .eq('servidor_id', servidorId)
      .eq('unidade_id', servidor.unidade_id)
      .eq('setor_id', servidor.setor_id)
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('ativo', true)
      .maybeSingle()

    if (escError) throw escError
    if (!escala) {
      return { error: 'Servidor não possui escala regular criada neste setor para o mês selecionado.' }
    }

    // Check status requirement
    if (escala.status === 'Em Andamento' && !forcarRascunho) {
      return { error: 'A escala do servidor está Em Andamento. Você deve gerar como Rascunho.' }
    }

    // Fetch config for tolerance
    const { data: configVar } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'folha_ponto_variacao_minutos')
      .single()
    const maxVar = configVar?.valor ? parseInt(configVar.valor as string, 10) : 15

    // Fetch regular shifts from escala_diaria
    const { data: escalaDiaria, error: diError } = await supabase
      .from('escala_diaria')
      .select('id, dia, dicionario_turnos_id, presenca_entrada_em, presenca_saida_em, presenca_confirmada, dicionario_turnos(codigo, slots)')
      .eq('escala_mensal_id', escala.id)
      .eq('categoria', 'Regular')

    if (diError) throw diError

    // Fetch manual validation logs
    const { data: logs } = await supabase
      .from('logs_sobreaviso')
      .select('dia, categoria, validacao_manual, motivo_acionamento')
      .eq('escala_mensal_id', escala.id)

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

    // Fetch absences (afastamentos)
    const { data: afastamentos } = await supabase
      .from('servidores_eventos')
      .select('data_inicio, data_fim, observacao, tipos_eventos(nome)')
      .eq('servidor_id', servidorId)
      .or(`data_inicio.lte.${endDate},data_fim.gte.${startDate}`)

    // Parse Jornada
    const jornadaDetails = escala.jornadas ? (escala.jornadas as any) : null
    const { startHour, startMin, endHour, endMin } = parseJornadaNome(jornadaDetails?.nome || '')
    const intervaloMinutos = jornadaDetails?.intervalo_minutos ?? 60
    const horasNormaisDiarias = jornadaDetails?.horas_totais ?? 8

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

      // Check afastamento
      const afastamento = afastamentos?.find(af => dateStr >= af.data_inicio && dateStr <= af.data_fim)
      
      // Check holiday
      const feriadoInfo = feriados?.find(f => f.data === dateStr)

      const shift = escalaDiaria?.find(ed => ed.dia === day)

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
        afastamento: afastamento ? (getAfastamentoNome(afastamento.tipos_eventos) || afastamento.observacao || 'Afastado') : null
      }

      if (registro.afastamento) {
        registro.observacao = registro.afastamento.toUpperCase()
      } else if (registro.feriado) {
        registro.observacao = `FERIADO: ${feriadoInfo?.descricao}`.toUpperCase()
      } else if (!shift) {
        // Rest day (folga)
        if (dateObj.getDay() === 0) {
          registro.observacao = 'DOMINGO'
        } else if (dateObj.getDay() === 6) {
          registro.observacao = 'SÁBADO'
        } else {
          registro.observacao = 'FOLGA'
        }
      } else {
        // Work day!
        totalHorasNormais += horasNormaisDiarias

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

        // Check if there was presence confirmada but actually no checkin/checkout timestamps
        const hasRealEntrada = !!shift.presenca_entrada_em && !isManualEntrada
        const hasRealSaida = !!shift.presenca_saida_em && !isManualSaida

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
        const seedBase = `${servidorId}-${mes}-${ano}-${day}`

        // 1. Entrance Time
        if (hasRealEntrada) {
          const d = new Date(shift.presenca_entrada_em)
          registro.entrada = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
          registro.origem_entrada = 'real'
        } else {
          const offset = getDeterministicOffset(`${seedBase}-entrada`, maxVar)
          const genMin = (officialEntradaMin + offset + 24 * 60) % (24 * 60)
          registro.entrada = formatMinutesToTimeStr(genMin)
          registro.origem_entrada = 'ficticio'
        }

        // 2. Exit Time
        if (hasRealSaida) {
          const d = new Date(shift.presenca_saida_em)
          registro.saida = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
          registro.origem_saida = 'real'
        } else {
          const offset = getDeterministicOffset(`${seedBase}-saida`, maxVar)
          const genMin = (officialSaidaMin + offset + 24 * 60) % (24 * 60)
          registro.saida = formatMinutesToTimeStr(genMin)
          registro.origem_saida = 'ficticio'
        }

        // 3. Lunch Interval
        if (intervaloMinutos > 0) {
          // Lunch out
          const outOffset = getDeterministicOffset(`${seedBase}-lunchout`, maxVar)
          const genOutMin = (officialSaidaIntervaloMin + outOffset + 24 * 60) % (24 * 60)
          registro.saida_intervalo = formatMinutesToTimeStr(genOutMin)
          registro.origem_saida_intervalo = 'ficticio'

          // Lunch return
          const returnOffset = getDeterministicOffset(`${seedBase}-lunchreturn`, maxVar)
          const genReturnMin = (genOutMin + intervaloMinutos + returnOffset + 24 * 60) % (24 * 60)
          registro.retorno_intervalo = formatMinutesToTimeStr(genReturnMin)
          registro.origem_retorno_intervalo = 'ficticio'
        }

        // 4. Overtime Calculation (Real Exit only)
        if (hasRealSaida && shift.presenca_saida_em) {
          const realExit = new Date(shift.presenca_saida_em)
          
          // Official scheduled exit timestamp
          const scheduledEntrance = new Date(`${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00-03:00`)
          const scheduledExit = new Date(`${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00-03:00`)
          if (scheduledExit <= scheduledEntrance) {
            scheduledExit.setDate(scheduledExit.getDate() + 1) // crosses midnight
          }

          if (realExit > scheduledExit) {
            // Calculate extra minutes minute-by-minute
            let extra50Min = 0
            let extra100Min = 0
            
            const current = new Date(scheduledExit.getTime())
            const end = new Date(realExit.getTime())
            
            // Build a quick lookup of holidays within this month
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
        mes,
        ano,
        status: forcarRascunho ? 'Rascunho' : 'Gerada',
        registros,
        escala_fingerprint: fingerprint,
        total_horas_normais: parseFloat(totalHorasNormais.toFixed(2)),
        total_horas_extras_50: parseFloat((totalExtra50 / 60).toFixed(2)),
        total_horas_extras_100: parseFloat((totalExtra100 / 60).toFixed(2)),
        total_faltas: totalFaltas,
        gerado_por_id: userProfile.id,
        gerado_em: new Date().toISOString()
      }, { onConflict: 'servidor_id, mes, ano' })
      .select('id')
      .single()

    if (saveError) throw saveError

    revalidatePath('/folha-ponto')
    return { success: true, folha_id: savedFolha.id }
  } catch (error: any) {
    console.error('Erro ao gerar folha de ponto:', error)
    return { error: error.message }
  }
}

// Generate in bulk for all servers in a sector
export async function gerarFolhasEmLote(mes: number, ano: number, unidadeId: string, setorId: string, forcarRascunho: boolean) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // Security check
    if (!hasSectorAccess(userProfile, setorId, unidadeId)) {
      return { error: 'Acesso negado a este setor/unidade.' }
    }

    // Fetch servers
    const { data: servidores, error: servError } = await supabase
      .from('servidores')
      .select('id')
      .eq('unidade_id', unidadeId)
      .eq('setor_id', setorId)
      .eq('status', 'Ativo')

    if (servError) throw servError
    if (!servidores || servidores.length === 0) return { error: 'Nenhum servidor ativo encontrado neste setor.' }

    let geradas = 0
    let erros = 0

    for (const s of servidores) {
      const res = await gerarFolhaPonto(s.id, mes, ano, forcarRascunho)
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

    // Fetch regular shifts from escala_diaria
    const { data: escalaDiaria } = await supabase
      .from('escala_diaria')
      .select('id, dia, dicionario_turnos_id, presenca_entrada_em, presenca_saida_em, presenca_confirmada, dicionario_turnos(codigo, slots)')
      .eq('escala_mensal_id', escala.id)
      .eq('categoria', 'Regular')

    // Fetch manual validation logs
    const { data: logs } = await supabase
      .from('logs_sobreaviso')
      .select('dia, categoria, validacao_manual, motivo_acionamento')
      .eq('escala_mensal_id', escala.id)

    const currentShifts = escalaDiaria || []
    const fingerprint = generateFingerprint(currentShifts)

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
      .select('data_inicio, data_fim, observacao, tipos_eventos(nome)')
      .eq('servidor_id', folha.servidor_id)
      .or(`data_inicio.lte.${endDate},data_fim.gte.${startDate}`)

    // Parse Jornada
    const jornadaDetails = escala.jornadas ? (escala.jornadas as any) : null
    const { startHour, startMin, endHour, endMin } = parseJornadaNome(jornadaDetails?.nome || '')
    const intervaloMinutos = jornadaDetails?.intervalo_minutos ?? 60
    const horasNormaisDiarias = jornadaDetails?.horas_totais ?? 8

    // Fetch tolerance
    const { data: configVar } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'folha_ponto_variacao_minutos')
      .single()
    const maxVar = configVar?.valor ? parseInt(configVar.valor as string, 10) : 15

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

      const currentShift = currentShifts.find(s => s.dia === day)
      const registroExistente = registrosExistentes.find(r => r.dia === day)

      // Check if this day's scale actually changed (shift presence vs existing record)
      const hadShift = registroExistente && registroExistente.turno_codigo !== null
      const hasShift = !!currentShift

      const scaleChangedForDay = (hadShift !== hasShift) || (hadShift && registroExistente.turno_codigo !== getTurnoCodigo(currentShift?.dicionario_turnos))

      // Check afastamento and holidays
      const afastamento = afastamentos?.find(af => dateStr >= af.data_inicio && dateStr <= af.data_fim)
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
        afastamento: afastamento ? (getAfastamentoNome(afastamento.tipos_eventos) || afastamento.observacao || 'Afastado') : null
      }

      if (registro.afastamento) {
        registro.observacao = registro.afastamento.toUpperCase()
      } else if (registro.feriado) {
        registro.observacao = `FERIADO: ${feriadoInfo?.descricao}`.toUpperCase()
      } else if (!currentShift) {
        if (dateObj.getDay() === 0) {
          registro.observacao = 'DOMINGO'
        } else if (dateObj.getDay() === 6) {
          registro.observacao = 'SÁBADO'
        } else {
          registro.observacao = 'FOLGA'
        }
      } else {
        totalHorasNormais += horasNormaisDiarias

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

        const hasRealEntrada = !!currentShift.presenca_entrada_em && !isManualEntrada
        const hasRealSaida = !!currentShift.presenca_saida_em && !isManualSaida

        const officialEntradaMin = startHour * 60 + startMin
        let officialSaidaMin = endHour * 60 + endMin
        let totalBrutoMin = officialSaidaMin - officialEntradaMin
        if (totalBrutoMin < 0) totalBrutoMin += 24 * 60
        
        const halfJornadaMin = Math.floor(totalBrutoMin / 2)
        const officialSaidaIntervaloMin = (officialEntradaMin + halfJornadaMin) % (24 * 60)
        const officialRetornoIntervaloMin = (officialSaidaIntervaloMin + intervaloMinutos) % (24 * 60)

        const seedBase = `${folha.servidor_id}-${folha.mes}-${folha.ano}-${day}`

        if (hasRealEntrada) {
          const d = new Date(currentShift.presenca_entrada_em)
          registro.entrada = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
          registro.origem_entrada = 'real'
        } else {
          const offset = getDeterministicOffset(`${seedBase}-entrada`, maxVar)
          const genMin = (officialEntradaMin + offset + 24 * 60) % (24 * 60)
          registro.entrada = formatMinutesToTimeStr(genMin)
          registro.origem_entrada = 'ficticio'
        }

        if (hasRealSaida) {
          const d = new Date(currentShift.presenca_saida_em)
          registro.saida = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
          registro.origem_saida = 'real'
        } else {
          const offset = getDeterministicOffset(`${seedBase}-saida`, maxVar)
          const genMin = (officialSaidaMin + offset + 24 * 60) % (24 * 60)
          registro.saida = formatMinutesToTimeStr(genMin)
          registro.origem_saida = 'ficticio'
        }

        if (intervaloMinutos > 0) {
          const outOffset = getDeterministicOffset(`${seedBase}-lunchout`, maxVar)
          const genOutMin = (officialSaidaIntervaloMin + outOffset + 24 * 60) % (24 * 60)
          registro.saida_intervalo = formatMinutesToTimeStr(genOutMin)
          registro.origem_saida_intervalo = 'ficticio'

          const returnOffset = getDeterministicOffset(`${seedBase}-lunchreturn`, maxVar)
          const genReturnMin = (genOutMin + intervaloMinutos + returnOffset + 24 * 60) % (24 * 60)
          registro.retorno_intervalo = formatMinutesToTimeStr(genReturnMin)
          registro.origem_retorno_intervalo = 'ficticio'
        }

        if (hasRealSaida && currentShift.presenca_saida_em) {
          const realExit = new Date(currentShift.presenca_saida_em)
          
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
export async function salvarFolhaPonto(folhaId: string, registros: any[], status?: string) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // Fetch existing sheet to check values and lotação permission
    const { data: folha, error: fetchError } = await supabase
      .from('folha_ponto')
      .select('escala_mensal_id, mes, ano, servidor_id, registros')
      .eq('id', folhaId)
      .single()

    if (fetchError || !folha) throw new Error('Folha de ponto não encontrada')

    const { data: escala } = await supabase
      .from('escala_mensal')
      .select('unidade_id, setor_id, status, jornada_id, jornadas(horas_totais, name, nome, intervalo_minutos)')
      .eq('id', folha.escala_mensal_id)
      .single()

    if (!escala) throw new Error('Escala vinculada não encontrada')

    // Security check
    if (!hasSectorAccess(userProfile, escala.setor_id, escala.unidade_id)) {
      return { error: 'Acesso negado para gerenciar esta folha.' }
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
      .select('dia, dicionario_turnos_id, categoria')
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

        const changed = (hadShift !== hasShift) || (hadShift && record.turno_codigo !== currentShift?.dicionario_turnos_id)
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
