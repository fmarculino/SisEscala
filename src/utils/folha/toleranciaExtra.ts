/**
 * Fonte unica da tolerancia de variacao de horario no registro de ponto.
 *
 * BASE LEGAL — CLT Art. 58 §1º
 *   "Nao serao descontadas nem computadas como jornada extraordinaria as variacoes de horario no
 *   registro de ponto nao excedentes de cinco minutos, observado o limite maximo de dez minutos
 *   diarios."
 *
 * ⚠️ E UM LIMIAR, NAO UMA FRANQUIA — e essa e a diferenca que mais custa errar.
 *   Sumula 366 do TST: ultrapassado o limite, "como extra sera considerada a TOTALIDADE do tempo
 *   que exceder a jornada normal". Nao se desconta os 10 minutos e paga-se o resto.
 *
 *     saiu 4 min depois  -> 0 de hora extra
 *     saiu 12 min depois -> 12 min de hora extra (NAO 2)
 *
 *   Medido sobre 08/2026 (1.192 dias, 485h11 de extra): como limiar deixa de pagar 18h24; como
 *   franquia deixaria de pagar 120h55. A diferenca de 102h31 e o tamanho do erro.
 *
 * OS DOIS LIMITES SAO INDEPENDENTES E VALEM JUNTOS
 *   - `porMarcacaoMin` (5): teto de CADA variacao isolada.
 *   - `diariaMin` (10): teto da SOMA das variacoes do dia.
 *
 *   Chegar 4 min antes e sair 4 min depois: cada variacao cabe nos 5 e a soma (8) cabe nos 10 —
 *   nada e computado. Sair 8 min depois, sozinho: cabe nos 10 diarios mas estoura os 5 daquela
 *   marcacao — computa-se tudo. E o que a lei diz, e e por isso que os dois parametros existem.
 *
 * ⚠️ A ANTECIPACAO DA ENTRADA ENTRA NA CONTA, MAS NAO VIRA PAGAMENTO.
 *   O SisEscala computa hora extra apenas pelo excedente da SAIDA. A antecipacao da entrada e
 *   somada aqui somente para decidir se o dia cabe na tolerancia — ela nunca aumenta o valor
 *   pago. Ignora-la faria um dia de 4 min antes + 4 min depois (8 min a disposicao) ser tolerado
 *   com o mesmo criterio de um dia de 4 min depois apenas, o que a lei nao autoriza.
 *
 * ⚠️ ATRASO NAO E VARIACAO TOLERAVEL AQUI.
 *   Chegar DEPOIS do previsto nao gera hora extra e nao entra nesta conta — tratar atraso e outro
 *   assunto (falta/desconto), com regra propria. Por isso so a antecipacao e considerada.
 *
 * CONFIGURAVEL PORQUE A REGRA LOCAL PODE DIVERGIR
 *   `configuracoes_globais.tolerancia_extra_minutos_por_marcacao` e
 *   `tolerancia_extra_minutos_diaria`. Zero nos dois desliga a tolerancia (comportamento anterior
 *   a 23/08/2026). O default abaixo e o da CLT.
 */

export interface LimitesTolerancia {
  /** Teto de cada variacao isolada, em minutos. CLT Art. 58 §1º: 5. */
  porMarcacaoMin: number
  /** Teto da soma das variacoes do dia, em minutos. CLT Art. 58 §1º: 10. */
  diariaMin: number
}

export const TOLERANCIA_CLT: LimitesTolerancia = { porMarcacaoMin: 5, diariaMin: 10 }

/** Um valor de configuracao que nao seja numero >= 0 cai no default, nunca em NaN. */
function num(v: unknown, padrao: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? n : padrao
}

/**
 * Lê os limites de um mapa chave -> valor de `configuracoes_globais`.
 * Aceita tanto `Map`/objeto quanto a lista crua `[{ chave, valor }]`.
 */
export function lerLimitesTolerancia(
  configs: Record<string, unknown> | Map<string, unknown> | { chave: string; valor: unknown }[] | null | undefined
): LimitesTolerancia {
  if (!configs) return TOLERANCIA_CLT
  const get = (k: string): unknown => {
    if (Array.isArray(configs)) return configs.find(c => c?.chave === k)?.valor
    if (configs instanceof Map) return configs.get(k)
    return (configs as Record<string, unknown>)[k]
  }
  return {
    porMarcacaoMin: num(get('tolerancia_extra_minutos_por_marcacao'), TOLERANCIA_CLT.porMarcacaoMin),
    diariaMin: num(get('tolerancia_extra_minutos_diaria'), TOLERANCIA_CLT.diariaMin),
  }
}

/**
 * O dia inteiro cabe na tolerância? `true` significa **zerar** a hora extra do dia.
 *
 * Nunca absorve quando os dois limites estão em zero — é assim que a tolerância se desliga.
 */
export function toleranciaAbsorve(args: {
  /** Minutos que a saída real passou do fim previsto. É o que o sistema paga. */
  excedenteSaidaMin: number
  /** Minutos que a entrada real veio ANTES do início previsto. Só decide, não paga. */
  antecipacaoEntradaMin?: number
  limites?: LimitesTolerancia | null
}): boolean {
  const { porMarcacaoMin, diariaMin } = args.limites || TOLERANCIA_CLT
  if (porMarcacaoMin <= 0 && diariaMin <= 0) return false

  const saida = Math.max(0, args.excedenteSaidaMin || 0)
  const entrada = Math.max(0, args.antecipacaoEntradaMin || 0)
  if (saida <= 0) return false

  return saida <= porMarcacaoMin
    && entrada <= porMarcacaoMin
    && (saida + entrada) <= diariaMin
}

/** Diferença em minutos entre dois instantes, nunca negativa. */
export function minutosEntre(depois: Date | null | undefined, antes: Date | null | undefined): number {
  if (!depois || !antes) return 0
  return Math.max(0, (depois.getTime() - antes.getTime()) / 60000)
}
