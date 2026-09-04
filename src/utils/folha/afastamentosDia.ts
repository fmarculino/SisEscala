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

import { alcanceNoTurno, minutosPrevistosNosSlots, resumoAfastamentoDia } from '../afastamentoParcial'
import { previstoDaJornada } from './calculoDia'

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
 * Minutos ABONADOS do dia — o campo "Abono" do cartão de ponto.
 *
 * ⚠️ ABONO NÃO É "DIA DE AFASTAMENTO", e confundir os dois produz número que engana o RH.
 *   Medido em produção em 04/09/2026 (competência 08/2026): contar todo dia com afastamento
 *   daria **1.173 dias de "abono"**, mas eles são Férias (304), Licença Prêmio (206), Licença
 *   saúde (197), Licença Maternidade (124)... — categorias próprias, que ninguém chama de abono.
 *
 *   Abono é o tempo NÃO TRABALHADO QUE FOI RELEVADO: a Declaração de Comparecimento e afins,
 *   lançadas por HORAS, com `regime_abono` diferente de `'a_compensar'`. É por isso que ele é
 *   medido em minutos (HH:MM na folha), e não em dias: o que se abona é o tempo.
 *
 * `a_compensar` fica de fora de propósito — aquele tempo o servidor ainda deve.
 */
export function minutosAbonadosDoDia(afastamentos: AfastamentoDia[] | null | undefined): number {
  if (!afastamentos?.length) return 0
  let total = 0
  for (const af of afastamentos) {
    const porHoras = af.periodo_tipo === 'horas' || !!af.hora_inicio
    if (!porHoras) continue
    if (af.regime_abono === 'a_compensar') continue
    total += Math.max(0, Number(af.minutos_afastamento) || 0)
  }
  return total
}

/**
 * O afastamento ALCANÇA este turno? Por horas nunca alcança (é declaração de comparecimento:
 * o servidor trabalha o resto do dia). Integral alcança qualquer turno. Por slot, alcança o
 * turno cujos slots cruzam os dele.
 *
 * ⚠️ Alcançar não é ANULAR — a distinção nasceu em 04/09/2026. Um afastamento `{M}` alcança um
 * turno `MT` sem anulá-lo: o servidor trabalha a tarde, e o dia precisa continuar na folha com
 * os horários dela. Quem decide anulação é `avaliarAfastamentosNoTurno`, sobre a UNIÃO do dia.
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

/** O que os afastamentos de um dia fazem com o turno daquele dia. */
export interface VeredictoAfastamentoTurno {
  /** Afastamentos que ANULAM o dia. Vazio quando o dia é parcial — ali o servidor trabalhou. */
  anulantes: AfastamentoDia[]
  /** Slots do turno cobertos por afastamento parcial. Vazio quando o dia não é parcial. */
  slotsParciais: string[]
  /** Minutos da jornada prevista que caem nos slots parciais — o abono do meio período. */
  abonoParcialMinutos: number
}

/**
 * Fonte única das QUATRO cópias da geração de folha para "o que este afastamento faz com o dia".
 *
 * 🚨 A avaliação é da UNIÃO dos afastamentos do dia contra os slots do turno, nunca evento a
 *    evento. Duas declarações de comparecimento (`{M}` e `{T}`) são parciais uma a uma e, juntas,
 *    cobrem um turno `MT` — tratá-las isoladamente daria um dia "parcial" em que ninguém
 *    trabalhou. Ver `alcanceNoTurno` em `afastamentoParcial.ts`.
 *
 * ⚠️ O abono NÃO desconta o intervalo intrajornada. Na prática ele cai na fronteira M/T (o padrão
 *    é 12:00, e `FAIXA_SLOT.T` começa exatamente aí), então o período afastado é trabalho puro.
 *    Descontá-lo exigiria saber onde a jornada põe o intervalo naquele dia — dado que a folha não
 *    carrega — e erraria mais do que acerta.
 */
export function avaliarAfastamentosNoTurno(
  afastamentosDoDia: AfastamentoDia[],
  shift: any,
  jornadaNome?: string | null
): VeredictoAfastamentoTurno {
  const turnoSlots: string[] = (shift?.dicionario_turnos as any)?.slots || []
  const resumo = resumoAfastamentoDia(afastamentosDoDia as any)
  const alcance = alcanceNoTurno(resumo, turnoSlots)

  if (alcance === 'anula') {
    return {
      anulantes: afastamentosDoDia.filter(af => isShiftOverlappingAfastamento(af, shift)),
      slotsParciais: [],
      abonoParcialMinutos: 0,
    }
  }

  if (alcance === 'parcial') {
    const slotsParciais = turnoSlots.filter(s => resumo.slots.includes(s))
    return {
      anulantes: [],
      slotsParciais,
      abonoParcialMinutos: minutosPrevistosNosSlots(slotsParciais, previstoDaJornada(jornadaNome)),
    }
  }

  return { anulantes: [], slotsParciais: [], abonoParcialMinutos: 0 }
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
