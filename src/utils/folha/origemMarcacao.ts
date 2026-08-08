/**
 * Fonte unica da resolucao de horario e origem de cada passo de presenca na folha de ponto.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *   Ate 08/08/2026 a folha decidia se um horario era "manual" lendo logs_sobreaviso:
 *
 *     const isManualEntrada = logs?.some(log =>
 *       log.dia === day && log.categoria === 'Regular' &&
 *       log.validacao_manual === true &&
 *       log.motivo_acionamento?.toLowerCase().includes('entrada'))
 *
 *   Isso estava quebrado por tres motivos independentes:
 *
 *   1. Desde 20260807020000 a fn_confirmar_presenca_manual so grava em logs_sobreaviso quando
 *      a categoria e Sobreaviso. Validacao manual de Regular, Plantao e Extra deixou de
 *      produzir qualquer linha la — e passou a entrar na folha como origem 'real'. Uma folha
 *      de ponto afirmando batida real onde houve validacao manual e exatamente o tipo de erro
 *      que vira problema juridico.
 *   2. includes('saida') nunca casa com "Validacao Manual (Saida / 2o Turno)", que grava
 *      "Saida" com acento. A deteccao de saida ja nascia sempre falsa.
 *   3. Os passos de intervalo nao tinham deteccao nenhuma — eram sempre 'real'.
 *
 *   A fonte correta sempre esteve na propria linha de escala_diaria: as flags
 *   presenca_*_manual, escritas por fn_confirmar_presenca_manual e zeradas por
 *   fn_reverter_presenca_manual. A folha simplesmente nao as lia.
 *
 * PRECISAO DA AGREGACAO
 *   Um dia pode ter varios turnos (Regular + Extra + Plantao). A folha consolida o dia
 *   agregando MIN nas entradas e MAX nas saidas. A flag de origem e lida da MESMA linha que
 *   forneceu o horario vencedor — nao de "algum turno do dia". Sem isso, um Extra validado
 *   manualmente contaminaria a origem da entrada real do turno Regular.
 *
 * LIMITE CONHECIDO
 *   Linhas anteriores a 20260804000000/20260804030000 (criacao das flags) tem false por
 *   DEFAULT mesmo quando a validacao foi manual. Esse historico continua sendo reportado como
 *   'real'. Nao ha heuristica segura para recuperar isso — a alternativa (inferir por
 *   timestamp redondo) marcaria batidas reais de terminal como manuais. O backfill correto
 *   acontece na Fase 1 da integracao com relogio de ponto, junto de marcacoes_ponto.
 */

export type PassoPresenca = 'entrada' | 'intervalo_saida' | 'intervalo_retorno' | 'saida'

/** Subconjunto de escala_diaria que este modulo precisa. */
export interface TurnoPresenca {
  presenca_entrada_em?: string | null
  presenca_intervalo_saida_em?: string | null
  presenca_intervalo_retorno_em?: string | null
  presenca_saida_em?: string | null
  presenca_entrada_manual?: boolean | null
  presenca_intervalo_saida_manual?: boolean | null
  presenca_intervalo_retorno_manual?: boolean | null
  presenca_saida_manual?: boolean | null
}

export interface MarcacaoDoDia {
  /** Horario consolidado do dia para o passo, ou null se nenhum turno tem o campo preenchido. */
  horario: Date | null
  /** true quando o horario vencedor foi gravado por validacao manual do coordenador. */
  manual: boolean
}

/**
 * Colunas e regra de agregacao de cada passo. As direcoes (min nas entradas, max nas saidas)
 * reproduzem exatamente o comportamento que a folha ja tinha.
 */
const CAMPOS: Record<
  PassoPresenca,
  { timestamp: keyof TurnoPresenca; flag: keyof TurnoPresenca; agregacao: 'min' | 'max' }
> = {
  entrada: {
    timestamp: 'presenca_entrada_em',
    flag: 'presenca_entrada_manual',
    agregacao: 'min',
  },
  intervalo_saida: {
    timestamp: 'presenca_intervalo_saida_em',
    flag: 'presenca_intervalo_saida_manual',
    agregacao: 'min',
  },
  intervalo_retorno: {
    timestamp: 'presenca_intervalo_retorno_em',
    flag: 'presenca_intervalo_retorno_manual',
    agregacao: 'max',
  },
  saida: {
    timestamp: 'presenca_saida_em',
    flag: 'presenca_saida_manual',
    agregacao: 'max',
  },
}

/**
 * Consolida os turnos de um dia num unico horario para o passo pedido, devolvendo junto a
 * origem daquele horario especifico.
 */
export function resolverMarcacaoDoDia(
  turnos: TurnoPresenca[] | null | undefined,
  passo: PassoPresenca
): MarcacaoDoDia {
  const { timestamp, flag, agregacao } = CAMPOS[passo]

  let vencedor: { ms: number; manual: boolean } | null = null

  for (const turno of turnos || []) {
    const bruto = turno?.[timestamp] as string | null | undefined
    if (!bruto) continue

    const ms = new Date(bruto).getTime()
    if (Number.isNaN(ms)) continue

    const melhor =
      vencedor === null || (agregacao === 'min' ? ms < vencedor.ms : ms > vencedor.ms)

    if (melhor) {
      vencedor = { ms, manual: turno[flag] === true }
    }
  }

  if (vencedor === null) {
    return { horario: null, manual: false }
  }

  return { horario: new Date(vencedor.ms), manual: vencedor.manual }
}

/**
 * Colunas de presenca que a folha precisa selecionar de escala_diaria para que
 * resolverMarcacaoDoDia funcione. Manter em um lugar so evita que uma das quatro copias da
 * geracao de folha esqueca uma flag e volte a reportar validacao manual como batida real.
 */
/*
 * Precisa ser um literal com `as const`: o parser de tipos do supabase-js le a string de
 * .select() em tempo de compilacao para inferir o tipo da linha. Um valor de tipo `string`
 * (o que um Array.join() devolveria) faz o parser falhar com ParserError e derruba a inferencia
 * de todas as colunas da consulta.
 */
export const COLUNAS_PRESENCA_FOLHA =
  'presenca_entrada_em, presenca_intervalo_saida_em, presenca_intervalo_retorno_em, presenca_saida_em, presenca_entrada_manual, presenca_intervalo_saida_manual, presenca_intervalo_retorno_manual, presenca_saida_manual' as const
