/**
 * Motor de Geração de Escala Inteligente — SisEscala v0.7.0
 * 
 * Lógica pura e consultas ao Supabase para gerar e sugerir escalas baseadas em:
 * 1. Continuidade histórica de folgas do mês anterior (especialmente 12x36).
 * 2. Bloqueio automático de dias de afastamento (férias, licenças).
 * 3. Preferência de turno e dimensionamento do setor.
 */

import { SupabaseClient } from '@supabase/supabase-js'

export interface GeneratorOptions {
  respectContinuity: boolean
  respectEvents: boolean
  respectPreferences: boolean
}

type RowCategory = 'Regular' | 'Extra' | 'Plantão' | 'Sobreaviso'
type GridData = Record<string, Record<RowCategory, Record<number, string>>>

interface HistoryInfo {
  patternDetected: '12x36' | '5x2' | '6x1' | 'Desconhecido'
  lastDayWorked: boolean
  lastDayOffset: number // quantos dias faz desde o último plantão
  preferredTurnoId: string | null
}

/**
 * Calcula o mês e ano anterior.
 */
export function getPreviousMonth(mes: number, ano: number) {
  const prevMes = mes === 1 ? 12 : mes - 1
  const prevAno = mes === 1 ? ano - 1 : ano
  return { mes: prevMes, ano: prevAno }
}

/**
 * Busca o histórico do mês anterior e os eventos de afastamento do mês alvo.
 */
export async function fetchGeneratorData(
  supabase: SupabaseClient,
  servidorIds: string[],
  setorId: string,
  mes: number,
  ano: number
) {
  const { mes: prevMes, ano: prevAno } = getPreviousMonth(mes, ano)
  const lastDayPrev = new Date(prevAno, prevMes, 0).getDate()

  // 1. Buscar escalas mensais do mês anterior
  const { data: prevScales } = await supabase
    .from('escala_mensal')
    .select('id, servidor_id')
    .eq('setor_id', setorId)
    .eq('mes', prevMes)
    .eq('ano', prevAno)
    .in('servidor_id', servidorIds)

  const prevScaleMap = new Map<string, string>() // servidor_id -> escala_mensal_id
  prevScales?.forEach(ps => {
    if (ps.servidor_id) prevScaleMap.set(ps.servidor_id, ps.id)
  })

  // 2. Buscar escalas diárias do mês anterior para detectar o padrão
  const prevScaleIds = prevScales?.map(ps => ps.id) || []
  let prevDailies: any[] = []
  if (prevScaleIds.length > 0) {
    const { data } = await supabase
      .from('escala_diaria')
      .select('escala_mensal_id, dia, dicionario_turnos_id, categoria')
      .in('escala_mensal_id', prevScaleIds)
      .eq('categoria', 'Regular')
    prevDailies = data || []
  }

  // 3. Buscar eventos de afastamento no mês atual
  const lastDayCurrent = new Date(ano, mes, 0).getDate()
  const startRange = `${ano}-${mes.toString().padStart(2, '0')}-01`
  const endRange = `${ano}-${mes.toString().padStart(2, '0')}-${lastDayCurrent}`

  const { data: events } = await supabase
    .from('servidores_eventos')
    .select('*, tipos_eventos(*)')
    .in('servidor_id', servidorIds)
    .or(`data_inicio.lte.${endRange},data_fim.gte.${startRange}`)

  // 4. Buscar detalhes dos servidores (preferências e carga horária)
  const { data: serverDetails } = await supabase
    .from('servidores')
    .select('id, preferenca_turno, carga_horaria_semanal')
    .in('id', servidorIds)

  return {
    prevScaleMap,
    prevDailies,
    lastDayPrev,
    events: events || [],
    serverDetails: serverDetails || []
  }
}

/**
 * Analisa os plantões do mês anterior de um servidor para detectar o padrão e a continuidade.
 */
function analyzeHistory(
  servidorId: string,
  escalaMensalId: string | undefined,
  prevDailies: any[],
  lastDayPrev: number
): HistoryInfo {
  if (!escalaMensalId) {
    return { patternDetected: 'Desconhecido', lastDayWorked: false, lastDayOffset: 99, preferredTurnoId: null }
  }

  // Filtrar diárias do servidor no mês anterior
  const dailies = prevDailies.filter(d => d.escala_mensal_id === escalaMensalId)
  if (dailies.length === 0) {
    return { patternDetected: 'Desconhecido', lastDayWorked: false, lastDayOffset: 99, preferredTurnoId: null }
  }

  // Encontrar dias trabalhados
  const workedDays = dailies
    .filter(d => d.dicionario_turnos_id !== null)
    .map(d => d.dia)
    .sort((a, b) => a - b)

  if (workedDays.length === 0) {
    return { patternDetected: 'Desconhecido', lastDayWorked: false, lastDayOffset: 99, preferredTurnoId: null }
  }

  // Salvar o turno mais usado como preferência de turno histórica
  const turnFreq: Record<string, number> = {}
  let preferredTurnoId: string | null = null
  let maxFreq = 0
  dailies.forEach(d => {
    if (d.dicionario_turnos_id) {
      turnFreq[d.dicionario_turnos_id] = (turnFreq[d.dicionario_turnos_id] || 0) + 1
      if (turnFreq[d.dicionario_turnos_id] > maxFreq) {
        maxFreq = turnFreq[d.dicionario_turnos_id]
        preferredTurnoId = d.dicionario_turnos_id
      }
    }
  })

  // Detectar padrão 12x36 (trabalha dia sim, dia não)
  // Medimos as diferenças entre dias de plantão consecutivos
  let diffsOf2 = 0
  for (let i = 1; i < workedDays.length; i++) {
    if (workedDays[i] - workedDays[i - 1] === 2) {
      diffsOf2++
    }
  }

  const ratio12x36 = diffsOf2 / (workedDays.length - 1 || 1)
  const patternDetected = ratio12x36 > 0.6 ? '12x36' : 'Desconhecido'

  // Verificar proximidade do último dia trabalhado
  const lastWorkedDay = workedDays[workedDays.length - 1]
  const lastDayWorked = lastWorkedDay === lastDayPrev
  const lastDayOffset = lastDayPrev - lastWorkedDay

  return {
    patternDetected,
    lastDayWorked,
    lastDayOffset,
    preferredTurnoId
  }
}

/**
 * Gera a escala inteligente em rascunho local.
 */
export async function generateIntelligentScale(
  supabase: SupabaseClient,
  params: {
    unidadeId: string
    setorId: string
    mes: number
    ano: number
    escalaMensal: any[]
    turnos: any[]
    options: GeneratorOptions
  }
): Promise<GridData> {
  const { escalaMensal, turnos, mes, ano, setorId, options } = params
  const daysInMonth = new Date(ano, mes, 0).getDate()
  const servidorIds = escalaMensal.map(em => em.servidor_id)

  if (servidorIds.length === 0) return {}

  // 1. Buscar dados do histórico e afastamentos
  const data = await fetchGeneratorData(supabase, servidorIds, setorId, mes, ano)

  const resultGrid: GridData = {}

  // Inicializar grid resultante vazio para cada servidor
  servidorIds.forEach(sId => {
    resultGrid[sId] = {
      Regular: {},
      Extra: {},
      Plantão: {},
      Sobreaviso: {}
    }
  })

  // Turno padrão (ex: MT ou M) a ser usado como fallback
  const defaultTurno = turnos.find(t => t.codigo === 'MT') || turnos[0]

  // 2. Processar cada servidor
  escalaMensal.forEach(em => {
    const sId = em.servidor_id
    if (!sId) return

    // Obter detalhes de cadastro (preferência cadastrada)
    const details = data.serverDetails.find(sd => sd.id === sId)
    
    // Obter histórico
    const prevScaleId = data.prevScaleMap.get(sId)
    const history = analyzeHistory(sId, prevScaleId, data.prevDailies, data.lastDayPrev)

    // Decidir turno ideal
    let selectedTurnoId = defaultTurno?.id
    if (options.respectPreferences) {
      // 1ª Prioridade: Preferência cadastrada no banco
      if (details?.preferenca_turno && details.preferenca_turno !== 'Flexivel') {
        const matchingTurno = turnos.find(t => t.codigo === details.preferenca_turno)
        if (matchingTurno) selectedTurnoId = matchingTurno.id
      }
      // 2ª Prioridade: Turno mais usado no mês passado
      else if (history.preferredTurnoId) {
        selectedTurnoId = history.preferredTurnoId
      }
    }

    // Gerar escala com base na continuidade
    if (options.respectContinuity && history.patternDetected === '12x36') {
      // Padrão 12x36:
      // Se trabalhou no último dia do mês anterior (offset 0), deve folgar no dia 1 do mês atual.
      // Se trabalhou há 2 dias (offset 1), deve trabalhar no dia 1 do mês atual.
      let isWorkDay = false
      if (history.lastDayWorked) {
        isWorkDay = false // trabalhou no último dia -> folga no dia 1
      } else if (history.lastDayOffset === 1) {
        isWorkDay = true // trabalhou no penúltimo dia -> trabalha no dia 1
      } else {
        isWorkDay = true // fallback
      }

      for (let day = 1; day <= daysInMonth; day++) {
        if (isWorkDay) {
          resultGrid[sId]['Regular'][day] = selectedTurnoId
        }
        isWorkDay = !isWorkDay
      }
    } else {
      // Fallback padrão se não houver histórico ou continuidade desativada
      // Para manter a segurança, não preenchemos nada (deixamos em branco para o coordenador aplicar um template)
      // ou preenchemos com base no ciclo 12x36 padrão começando trabalhando
      // Mas o usuário pediu "Assistente de Continuidade", então se não houver histórico para continuar,
      // deixamos a linha vazia para não poluir ou assumimos o template padrão se desejar.
      // Vamos deixar a linha vazia, pois "dar menos trabalho" significa não inventar dados onde não existe histórico.
    }

    // 3. Bloqueio por afastamentos (Veredito do Usuário: Limpar dias de férias/licenças)
    if (options.respectEvents) {
      data.events
        .filter(ev => ev.servidor_id === sId)
        .forEach(ev => {
          const start = new Date(ev.data_inicio + 'T00:00:00')
          const end = new Date(ev.data_fim + 'T23:59:59')

          for (let day = 1; day <= daysInMonth; day++) {
            const currentDayDate = new Date(ano, mes - 1, day)
            if (currentDayDate >= start && currentDayDate <= end) {
              // Limpar o turno alocado regular para este dia de afastamento
              delete resultGrid[sId]['Regular'][day]
              delete resultGrid[sId]['Extra'][day]
              delete resultGrid[sId]['Plantão'][day]
            }
          }
        })
    }
  })

  return resultGrid
}
