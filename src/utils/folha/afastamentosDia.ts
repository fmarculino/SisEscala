/**
 * Afastamentos de UM dia — fonte única da geração de folha e do portal do servidor.
 *
 * ⚠️ Um dia pode ter MAIS DE UM afastamento, e até 24/08/2026 as quatro cópias da geração
 * usavam `afastamentos?.find(...)`, que devolve só o primeiro. Caso real medido (KETHURY
 * CHAVES, 14/08/2026, USF ENFERMEIRA ZEZINHA): duas Declarações de Comparecimento lançadas,
 * uma para o período M e outra para o T, e a folha imprimia apenas `(M)`. O segundo evento
 * sumia da observação, do campo `afastamento` do registro e — por consequência — do anexo
 * de ocorrências (`ocorrenciasMes` em `FolhaPontoEditor`), que deriva de `registros`.
 *
 * O lançamento nunca se perdeu: `servidores_eventos` tem as duas linhas e a tela de
 * Afastamentos mostra as duas. O que se perdia era a LEITURA por dia.
 *
 * Nada aqui decide bloqueio de escala — isso continua em `src/utils/afastamentos.ts`,
 * que espelha `fn_prevent_shift_during_event`. Este módulo é sobre DESCREVER o dia.
 */

export interface AfastamentoDia {
  data_inicio: string
  data_fim: string
  observacao?: string | null
  slots?: string[] | null
  periodo_tipo?: string | null
  hora_inicio?: string | null
  hora_fim?: string | null
  minutos_afastamento?: number | null
  regime_abono?: string | null
  tipos_eventos?: any
  [key: string]: any
}

export function getAfastamentoNome(tiposEventos: any): string | null {
  if (!tiposEventos) return null
  if (Array.isArray(tiposEventos)) {
    return tiposEventos[0]?.nome || null
  }
  return tiposEventos.nome || null
}

export function getAfastamentoObservacao(af: any): string {
  const baseName = getAfastamentoNome(af.tipos_eventos) || af.observacao || 'Afastado'
  if (af.periodo_tipo === 'horas' || af.hora_inicio) {
    const hIni = af.hora_inicio?.substring(0, 5) || '--:--'
    const hFim = af.hora_fim?.substring(0, 5) || '--:--'
    const durMin = af.minutos_afastamento || 0
    const durStr = durMin > 0 ? ` (${Math.floor(durMin / 60)}h${String(durMin % 60).padStart(2, '0')}m)` : ''
    const regStr = af.regime_abono === 'a_compensar' ? ' [A Compensar]' : ''
    return `${baseName}: ${hIni} às ${hFim}${durStr}${regStr}`
  }
  if (af.slots && af.slots.length > 0) {
    return `${baseName} (${af.slots.join(', ')})`
  }
  return baseName
}

/**
 * O afastamento anula este turno? Por horas nunca anula (é declaração de comparecimento:
 * o servidor trabalha o resto do dia). Integral anula qualquer turno. Por slot, anula o
 * turno cujos slots cruzam os dele.
 */
export function isShiftOverlappingAfastamento(afastamento: any, shift: any): boolean {
  if (!afastamento) return false
  if (afastamento.periodo_tipo === 'horas' || afastamento.hora_inicio) {
    // Afastamento por horas não anula o turno inteiro
    return false
  }
  if (!afastamento.slots || afastamento.slots.length === 0) return true
  if (!shift || !shift.dicionario_turnos) return false
  const shiftSlots = (shift.dicionario_turnos as any).slots || []
  return shiftSlots.some((s: string) => afastamento.slots.includes(s))
}

/**
 * Ordem de leitura dentro do dia: integral primeiro, depois pela hora em que o afastamento
 * começa — a do relógio, quando é por horas; a do período, quando é por slot.
 */
function ordemNoDia(af: AfastamentoDia): number {
  if (af.hora_inicio) {
    const [h, m] = af.hora_inicio.split(':')
    return Number(h) * 60 + Number(m || 0)
  }
  const slots = af.slots || []
  if (slots.length === 0) return -1
  const inicioDoSlot: Record<string, number> = { M: 0, T: 720, N: 1080 }
  return Math.min(...slots.map(s => inicioDoSlot[s] ?? 1440))
}

/**
 * TODOS os afastamentos que alcançam `dateStr`, em ordem estável.
 *
 * O desempate é pela própria descrição, e não pela ordem de chegada: as quatro consultas de
 * `servidores_eventos` não têm `ORDER BY`, então a ordem do PostgREST não é garantida — sem
 * isso, regerar a mesma folha duas vezes poderia trocar a ordem do texto impresso.
 */
export function afastamentosDoDia(
  afastamentos: AfastamentoDia[] | null | undefined,
  dateStr: string
): AfastamentoDia[] {
  return (afastamentos || [])
    .filter(af => dateStr >= af.data_inicio && dateStr <= af.data_fim)
    .sort((a, b) => {
      const d = ordemNoDia(a) - ordemNoDia(b)
      if (d !== 0) return d
      return getAfastamentoObservacao(a).localeCompare(getAfastamentoObservacao(b), 'pt-BR')
    })
}

/**
 * Descrição de todos os afastamentos do dia, na ordem de `afastamentosDoDia`.
 * Devolve '' para lista vazia — quem grava campo anulável decide o null no sítio.
 */
export function descreverAfastamentos(eventos: AfastamentoDia[]): string {
  return eventos.map(getAfastamentoObservacao).join(' + ')
}
