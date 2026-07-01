/**
 * Gerador de Templates de Escala — SisEscala v0.6.0
 * 
 * Módulo puro que gera padrões de escala pré-definidos.
 * Os templates NÃO gravam no banco — apenas retornam o mapeamento dia→turnoId
 * para ser injetado no gridData local.
 */

export type TemplateType = '12x36' | '5x2' | '6x1'

export interface TemplateConfig {
  type: TemplateType
  turnoId: string        // ID do turno a ser aplicado
  startDay: number       // Dia de início (1-31)
  startWorking: boolean  // true = começa trabalhando, false = começa folgando
}

export interface TemplateOption {
  type: TemplateType
  label: string
  description: string
}

/**
 * Lista de templates disponíveis para exibição na UI.
 */
export const TEMPLATE_OPTIONS: TemplateOption[] = [
  {
    type: '12x36',
    label: 'Escala 12×36',
    description: 'Trabalha 12h e descansa 36h. Comum em saúde e segurança. Resulta em dias alternados.'
  },
  {
    type: '5x2',
    label: 'Escala 5×2',
    description: 'Trabalha 5 dias (seg-sex) e folga 2 (sáb-dom). Escala comercial padrão.'
  },
  {
    type: '6x1',
    label: 'Escala 6×1',
    description: 'Trabalha 6 dias consecutivos e folga 1. Garantia mínima de DSR.'
  }
]

/**
 * Gera o mapeamento dia→turnoId baseado no template selecionado.
 * 
 * @param config - Configuração do template
 * @param daysInMonth - Número de dias no mês
 * @param mes - Mês (1-12)
 * @param ano - Ano
 * @param protectedDays - Dias que NÃO devem ser sobrescritos (presença confirmada)
 * @returns Record<number, string> - Mapeamento dia → turnoId
 */
export function generateTemplate(
  config: TemplateConfig,
  daysInMonth: number,
  mes: number,
  ano: number,
  protectedDays: Set<number> = new Set()
): Record<number, string> {
  switch (config.type) {
    case '12x36':
      return generate12x36(config, daysInMonth, protectedDays)
    case '5x2':
      return generate5x2(config, daysInMonth, mes, ano, protectedDays)
    case '6x1':
      return generate6x1(config, daysInMonth, protectedDays)
    default:
      return {}
  }
}

/**
 * Escala 12×36: dia sim, dia não.
 * O servidor trabalha 12h em um dia e folga no dia seguinte (36h de descanso).
 */
function generate12x36(
  config: TemplateConfig,
  daysInMonth: number,
  protectedDays: Set<number>
): Record<number, string> {
  const result: Record<number, string> = {}
  let isWorkDay = config.startWorking

  for (let day = config.startDay; day <= daysInMonth; day++) {
    if (isWorkDay && !protectedDays.has(day)) {
      result[day] = config.turnoId
    }
    isWorkDay = !isWorkDay
  }

  return result
}

/**
 * Escala 5×2: trabalha seg-sex, folga sáb-dom.
 * Usa o calendário real para determinar os dias da semana.
 */
function generate5x2(
  config: TemplateConfig,
  daysInMonth: number,
  mes: number,
  ano: number,
  protectedDays: Set<number>
): Record<number, string> {
  const result: Record<number, string> = {}

  for (let day = config.startDay; day <= daysInMonth; day++) {
    const dayOfWeek = new Date(ano, mes - 1, day).getDay() // 0=Dom, 6=Sáb
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5

    if (isWeekday && !protectedDays.has(day)) {
      result[day] = config.turnoId
    }
  }

  return result
}

/**
 * Escala 6×1: trabalha 6 dias, folga 1.
 * A contagem é cíclica a partir do dia de início.
 */
function generate6x1(
  config: TemplateConfig,
  daysInMonth: number,
  protectedDays: Set<number>
): Record<number, string> {
  const result: Record<number, string> = {}
  const cycleLength = 7 // 6 trabalho + 1 folga
  
  for (let day = config.startDay; day <= daysInMonth; day++) {
    // Calcular posição no ciclo relativa ao startDay
    let offset = day - config.startDay
    // Normalizar offsets negativos
    while (offset < 0) offset += cycleLength
    
    const posInCycle = offset % cycleLength
    
    // Nos primeiros 6 dias do ciclo: trabalha. No 7º: folga.
    const isWorkDay = config.startWorking 
      ? posInCycle < 6  // Começa trabalhando: dias 0-5 = trabalho, dia 6 = folga
      : posInCycle > 0  // Começa folgando: dia 0 = folga, dias 1-6 = trabalho

    if (isWorkDay && !protectedDays.has(day)) {
      result[day] = config.turnoId
    }
  }

  return result
}

/**
 * Helper: conta o total de dias de trabalho gerados pelo template.
 */
export function countWorkDays(template: Record<number, string>): number {
  return Object.keys(template).filter(k => template[parseInt(k)]).length
}
