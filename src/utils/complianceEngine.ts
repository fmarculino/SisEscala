/**
 * Motor de Compliance Legal — SisEscala v0.6.0
 * 
 * Módulo puro (sem dependências React/Supabase) que valida regras trabalhistas:
 * - Interjornada: mínimo de 11h entre o fim de um turno e o início do próximo
 * - DSR (Descanso Semanal Remunerado): pelo menos 1 folga a cada 7 dias consecutivos
 * 
 * As violações são INFORMATIVAS (warnings), não bloqueiam o salvamento.
 */

export interface ComplianceViolation {
  type: 'INTERJORNADA' | 'DSR'
  servidorId: string
  dia: number
  message: string
  severity: 'warning'
}

interface TurnoInfo {
  id: string
  codigo: string
  slots?: string[]
  horas_computadas?: number
}

type RowCategory = 'Regular' | 'Extra' | 'Plantão' | 'Sobreaviso'
type GridData = Record<string, Record<RowCategory, Record<number, string>>>

/**
 * Mapeia um código de turno para o horário de INÍCIO mais cedo (em horas, 0-23).
 */
function getShiftStartHour(codigo: string): number {
  const c = codigo.toUpperCase().trim()
  // Prioridade: se contém M, começa às 07h
  if (c.startsWith('M') || c === 'MT' || c === 'MTN') return 7
  if (c.startsWith('T')) return 13
  if (c.startsWith('N')) return 19
  // Fallback para códigos com número (ex: M4, M8)
  if (c.includes('M')) return 7
  if (c.includes('T')) return 13
  if (c.includes('N')) return 19
  return 7 // default manhã
}

/**
 * Mapeia um código de turno para o horário de FIM (em horas desde meia-noite do dia).
 * Valores > 24 indicam que o turno termina no dia seguinte.
 */
function getShiftEndHour(codigo: string, horasComputadas?: number): number {
  const c = codigo.toUpperCase().trim()
  
  // Turnos compostos conhecidos
  if (c === 'MTN') return 31 // 07h + 24h = termina 07h do dia seguinte
  if (c === 'MT') return 19
  if (c === 'MN') return 31 // raro, mas 07h + 24h
  if (c === 'TN') return 31 // 13h + ~18h ≈ termina 07h do dia seguinte
  
  // Noturno: sempre cruza meia-noite
  if (c === 'N' || c === 'N12') return 31 // 19h → 07h (+1dia)
  
  // Turnos simples com horas explícitas
  if (horasComputadas) {
    const start = getShiftStartHour(c)
    return start + horasComputadas
  }
  
  // Turnos simples sem horas - usar padrão de 6h
  if (c === 'M' || c.startsWith('M')) return 13
  if (c === 'T' || c.startsWith('T')) return 19
  
  return 19 // fallback
}

/**
 * Verifica violações de INTERJORNADA para um servidor.
 * Regra: mínimo de 11 horas consecutivas entre o fim de uma jornada e o início da próxima.
 */
export function checkInterjornada(
  gridData: GridData,
  turnos: TurnoInfo[],
  servidorId: string,
  daysInMonth: number
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = []
  const serverData = gridData[servidorId]
  if (!serverData) return violations

  const categories: RowCategory[] = ['Regular', 'Extra', 'Plantão']

  for (let day = 1; day < daysInMonth; day++) {
    const nextDay = day + 1

    // Coletar TODOS os turnos do dia atual (latest end) e do dia seguinte (earliest start)
    let latestEndHour = -1
    let earliestStartNextDay = 25

    // Dia atual: encontrar o turno que termina mais tarde
    for (const cat of categories) {
      const turnoId = serverData[cat]?.[day]
      if (!turnoId) continue
      const turno = turnos.find(t => t.id === turnoId)
      if (!turno) continue
      
      const endHour = getShiftEndHour(turno.codigo, turno.horas_computadas ? Number(turno.horas_computadas) : undefined)
      if (endHour > latestEndHour) latestEndHour = endHour
    }

    // Dia seguinte: encontrar o turno que começa mais cedo
    for (const cat of categories) {
      const turnoId = serverData[cat]?.[nextDay]
      if (!turnoId) continue
      const turno = turnos.find(t => t.id === turnoId)
      if (!turno) continue
      
      const startHour = getShiftStartHour(turno.codigo)
      if (startHour < earliestStartNextDay) earliestStartNextDay = startHour
    }

    // Se ambos os dias têm turno, calcular o gap
    if (latestEndHour >= 0 && earliestStartNextDay < 25) {
      // O start do próximo dia é em horas absolutas do dia seguinte (+24)
      const gapHours = (earliestStartNextDay + 24) - latestEndHour
      
      if (gapHours < 11) {
        violations.push({
          type: 'INTERJORNADA',
          servidorId,
          dia: nextDay,
          message: `Interjornada insuficiente: apenas ${gapHours.toFixed(0)}h de descanso entre os dias ${day} e ${nextDay} (mínimo legal: 11h).`,
          severity: 'warning'
        })
      }
    }
  }

  return violations
}

/**
 * Verifica violações de DSR (Descanso Semanal Remunerado) para um servidor.
 * Regra: pelo menos 1 dia de folga a cada 7 dias consecutivos.
 */
export function checkDSR(
  gridData: GridData,
  servidorId: string,
  daysInMonth: number
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = []
  const serverData = gridData[servidorId]
  if (!serverData) return violations

  const categories: RowCategory[] = ['Regular', 'Extra', 'Plantão']

  // Construir bitmap: dia tem turno ou não
  const hasShift: boolean[] = new Array(daysInMonth + 1).fill(false)
  for (let day = 1; day <= daysInMonth; day++) {
    for (const cat of categories) {
      if (serverData[cat]?.[day]) {
        hasShift[day] = true
        break
      }
    }
  }

  // Sliding window: verificar se existem 7 dias consecutivos sem folga
  let consecutiveWorkDays = 0
  for (let day = 1; day <= daysInMonth; day++) {
    if (hasShift[day]) {
      consecutiveWorkDays++
      if (consecutiveWorkDays >= 7) {
        violations.push({
          type: 'DSR',
          servidorId,
          dia: day,
          message: `Sem folga há ${consecutiveWorkDays} dias consecutivos (dia ${day - consecutiveWorkDays + 1} ao ${day}). O DSR exige pelo menos 1 folga a cada 7 dias.`,
          severity: 'warning'
        })
      }
    } else {
      consecutiveWorkDays = 0
    }
  }

  return violations
}

/**
 * Executa TODAS as verificações de compliance para todos os servidores fornecidos.
 */
export function runComplianceCheck(
  gridData: GridData,
  turnos: TurnoInfo[],
  servidorIds: string[],
  daysInMonth: number
): ComplianceViolation[] {
  if (!gridData || servidorIds.length === 0) return []

  const allViolations: ComplianceViolation[] = []

  for (const servidorId of servidorIds) {
    allViolations.push(...checkInterjornada(gridData, turnos, servidorId, daysInMonth))
    allViolations.push(...checkDSR(gridData, servidorId, daysInMonth))
  }

  return allViolations
}

/**
 * Helper: filtra violações para uma célula específica.
 */
export function getViolationsForCell(
  violations: ComplianceViolation[],
  servidorId: string,
  dia: number
): ComplianceViolation[] {
  return violations.filter(v => v.servidorId === servidorId && v.dia === dia)
}
