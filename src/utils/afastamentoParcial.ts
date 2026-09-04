/**
 * Afastamento de MEIO PERIODO — fonte unica do frontend, espelho de `fn_afastamento_dia`,
 * `fn_afastamento_anula_turno` e `fn_afastamento_parcial_no_turno` (migration 20260904120000).
 *
 * O QUE ESTE ARQUIVO RESOLVE
 *   Um afastamento por slot `{M}` sobre um turno `MT` anulava o DIA INTEIRO. A escala do dia era
 *   apagada por `fn_clean_conflicting_shifts` (o DELETE nunca olhou slot, so data), o relancamento
 *   era recusado por `fn_prevent_shift_during_event` (a condicao era INTERSECAO) e a folha
 *   imprimia "AFASTAMENTO PARCIAL: ... | FOLGA" sem horario nenhum — o periodo efetivamente
 *   trabalhado sumia. Caso real: LUANA JESUS DE OLIVEIRA (mat. 52705), 25 e 27/08/2026, jornada
 *   08H AS 18H, declaracao de comparecimento pela manha; ela trabalhou as duas tardes e a folha
 *   marcou os dois dias como folga.
 *
 * A REGRA E A CONTENCAO, NAO A INTERSECAO
 *   | o afastamento do dia...        | alcance        | efeito                                  |
 *   |--------------------------------|----------------|-----------------------------------------|
 *   | e integral (sem slots)         | `anula`        | dia inteiro afastado (inalterado)       |
 *   | COBRE todos os slots do turno  | `anula`        | dia inteiro afastado (inalterado)       |
 *   | alcanca PARTE dos slots        | `parcial`      | o servidor trabalha o resto (NOVO)      |
 *   | nao alcanca nenhum slot        | `nao_alcanca`  | nao e parcial (ver aviso abaixo)        |
 *
 * ⚠️ `nao_alcanca` NAO E "sem efeito", e essa distincao e o que impede uma regressao grave.
 *   Ha Ferias e Licenca Premio lancadas em producao com slots `{M,T}` sobre turno `N` — intersecao
 *   VAZIA. E uso indevido do campo, mas a escala daqueles dias precisa continuar sendo apagada:
 *   tratar isso como "parcial" deixaria o servidor escalado durante as proprias ferias. Por isso a
 *   limpeza pergunta `ehParcial`, e nao `!anula`.
 *
 * ⚠️ A leitura e SEMPRE do DIA, nunca de um evento isolado. Duas declaracoes de comparecimento no
 *   mesmo dia (uma `{M}` e outra `{T}`, caso KETHURY CHAVES em 14/08/2026) sao parciais uma a uma
 *   e, juntas, COBREM o turno MT. Quem classifica recebe a uniao — ver `resumoAfastamentoDia`.
 *
 * ⚠️ Modulo PURO (sem React, sem Supabase) para ter portao: `node scratchpad/sim_afastamento_parcial.js`.
 */

import type { AfastamentoEvento } from './afastamentos'

export type AlcanceAfastamento = 'nao_alcanca' | 'parcial' | 'anula'

/**
 * Afastamento por horas nao tira o servidor da escala do dia.
 *
 * ⚠️ Mora AQUI, e nao em `afastamentos.ts`, so por causa da direcao da dependencia: a regra de
 * bloqueio depende da classificacao, nunca o contrario. `afastamentos.ts` reexporta esta funcao,
 * entao quem ja a importava de la continua funcionando — nao existem duas definicoes.
 */
export function afastamentoBloqueiaEscala(evento: AfastamentoEvento): boolean {
  const tipo = evento.periodo_tipo || 'integral'
  return tipo !== 'horas' && !evento.hora_inicio
}

/** O que os afastamentos de UM dia, somados, representam. */
export interface ResumoAfastamentoDia {
  /** Ao menos um afastamento bloqueante do dia nao tem slots: o dia inteiro esta coberto. */
  integral: boolean
  /** Uniao dos slots de todos os afastamentos bloqueantes do dia, ordenada. */
  slots: string[]
  /** Ha algum afastamento bloqueante no dia? Falso quando so ha afastamento por horas, ou nenhum. */
  temAfastamento: boolean
}

/** Ordem de leitura dos slots: manha, tarde, noite. */
const ORDEM_SLOT: Record<string, number> = { M: 0, T: 1, N: 2 }

/**
 * Junta os afastamentos BLOQUEANTES do dia num resumo unico.
 *
 * Afastamento por horas fica de fora por `afastamentoBloqueiaEscala` — ele nunca tira o servidor
 * da escala (declaracao de comparecimento por horario, migration 20260817210000), entao tambem
 * nao entra na conta de cobertura.
 */
export function resumoAfastamentoDia(eventos: AfastamentoEvento[] | null | undefined): ResumoAfastamentoDia {
  const bloqueantes = (eventos || []).filter(afastamentoBloqueiaEscala)
  if (bloqueantes.length === 0) return { integral: false, slots: [], temAfastamento: false }

  let integral = false
  const slots = new Set<string>()
  for (const ev of bloqueantes) {
    if (!ev.slots || ev.slots.length === 0) integral = true
    else for (const s of ev.slots) slots.add(s)
  }

  return {
    integral,
    slots: [...slots].sort((a, b) => (ORDEM_SLOT[a] ?? 9) - (ORDEM_SLOT[b] ?? 9) || a.localeCompare(b)),
    temAfastamento: true,
  }
}

/**
 * O alcance do afastamento do dia sobre UM turno.
 *
 * ⚠️ Turno sem slots conhecidos nunca e alcancado por afastamento de slot — e o mesmo resultado do
 * operador `&&` do SQL com array vazio, e trocar isso mudaria o comportamento de todo turno cujo
 * codigo nao esteja no dicionario.
 */
export function alcanceNoTurno(
  resumo: ResumoAfastamentoDia,
  turnoSlots: string[] | null | undefined
): AlcanceAfastamento {
  if (!resumo.temAfastamento) return 'nao_alcanca'
  if (resumo.integral) return 'anula'

  const ts = turnoSlots || []
  if (ts.length === 0) return 'nao_alcanca'
  if (resumo.slots.length === 0) return 'nao_alcanca'

  const alcancados = ts.filter(s => resumo.slots.includes(s))
  if (alcancados.length === 0) return 'nao_alcanca'
  return alcancados.length === ts.length ? 'anula' : 'parcial'
}

/** Atalho: o afastamento do dia anula este turno? */
export function afastamentoAnulaTurno(
  resumo: ResumoAfastamentoDia,
  turnoSlots: string[] | null | undefined
): boolean {
  return alcanceNoTurno(resumo, turnoSlots) === 'anula'
}

/** Atalho: o afastamento do dia e PARCIAL neste turno (o servidor trabalha o resto)? */
export function afastamentoParcialNoTurno(
  resumo: ResumoAfastamentoDia,
  turnoSlots: string[] | null | undefined
): boolean {
  return alcanceNoTurno(resumo, turnoSlots) === 'parcial'
}

/** Os slots do turno que o servidor AINDA trabalha, na ordem do turno. */
export function slotsTrabalhados(
  turnoSlots: string[] | null | undefined,
  resumo: ResumoAfastamentoDia
): string[] {
  if (resumo.integral) return []
  return (turnoSlots || []).filter(s => !resumo.slots.includes(s))
}

/**
 * Faixa do dia coberta por cada slot, em minutos desde a meia-noite.
 *
 * Mesma convencao ja usada por `ordemNoDia` em `folha/afastamentosDia.ts` (M começa 00:00,
 * T começa 12:00, N começa 18:00), aqui completada com o fim de cada faixa.
 */
export const FAIXA_SLOT: Record<string, [number, number]> = {
  M: [0, 720],
  T: [720, 1080],
  N: [1080, 1440],
}

/**
 * Minutos da jornada prevista que caem nos slots informados.
 *
 * Serve ao campo ABONO do dia parcial: e o tempo que o servidor deixou de trabalhar e que a
 * declaracao releva. Trabalha por minuto, no mesmo eixo absoluto de `minutosNoturnos`, entao
 * jornada que atravessa a meia-noite (`saidaMin > 1440`) e tratada sem caso especial.
 *
 * ⚠️ Devolve 0 sem previsto. Estimar a jornada aqui seria fabricar o numero que explica a folha.
 */
export function minutosPrevistosNosSlots(
  slots: string[] | null | undefined,
  previsto: { entradaMin: number; saidaMin: number } | null | undefined
): number {
  if (!previsto || !slots?.length) return 0
  if (!(previsto.saidaMin > previsto.entradaMin)) return 0

  let total = 0
  for (let t = previsto.entradaMin; t < previsto.saidaMin; t++) {
    const doDia = ((t % 1440) + 1440) % 1440
    for (const s of slots) {
      const faixa = FAIXA_SLOT[s]
      if (faixa && doDia >= faixa[0] && doDia < faixa[1]) {
        total++
        break
      }
    }
  }
  return total
}
