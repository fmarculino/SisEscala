/**
 * Fonte unica da leitura cronologica dos quatro passos de um dia da folha de ponto.
 *
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE
 *   A folha guarda cada passo como "HH:MM", sem data. Num plantao 18h as 06h a saida le
 *   "06:00", que e MENOR que a entrada "18:11" — e toda comparacao ingenua conclui
 *   "horario invertido". A folha do dia 03/08/2026 (AGACY, USF Zezinha, jornada 18H AS 06H)
 *   saia com borda vermelha em retorno e saida, corretamente preenchidos.
 *
 * POR QUE UM MODULO, E NAO UM IF EM CADA TELA
 *   Em 19/08/2026 (commit 64d8863) a mesma correcao foi colada em tres lugares, com TRES
 *   criterios diferentes de "e noturno". As tres divergiam entre si, e duas estavam erradas:
 *
 *   1. normalizarHorarios.ts classificava como plantao noturno todo dia com uma marcacao antes
 *      e outra depois do meio-dia — ou seja, TODO dia de trabalho normal. Como o ramo de duas
 *      batidas ordena com pivo nas 12:00 e sem guard de inversao, o botao "Auto-Corrigir"
 *      passou a INVERTER batida real de jornada diurna: 08:00 -> 17:00 virava 17:00 -> 08:00,
 *      levando a origem 'real' junto. Uma saida de terminal rotulada como entrada e registro
 *      de ponto falso, e "Regenerar" nao desfaz (shouldPreserve preserva o valor invertido).
 *   2. salvarFolhaPonto detectava noturno com /18|19|20|21|22/ sobre o nome da jornada.
 *      "08H AS 18H" contem "18" — a jornada diurna mais comum do sistema era classificada
 *      como noturna, e o guard de inversao (que existe para pegar erro de digitacao antes de
 *      virar folha oficial) ficava inerte justamente nela.
 *
 *   Manter isso em um lugar so nao e estilo: e o que impede a tela pintar vermelho num dia que
 *   o save aceita, ou o contrario.
 *
 * O CRITERIO: A VIRADA E PERMITIDA, NUNCA DEDUZIDA DAS MARCACOES
 *   `podeCruzarMeiaNoite` responde se aquele dia TEM DIREITO a rolar para o dia seguinte. A
 *   resposta vem da jornada prevista (nome com fim <= inicio) ou de a entrada ser vespertina —
 *   nunca de "as marcacoes parecem fora de ordem", que foi exatamente o raciocinio circular do
 *   item 1 acima: usar o sintoma da inversao como prova de que inversao nao existe.
 *
 *   Com o direito concedido, a rolagem e aplicada na ORDEM DAS COLUNAS, acumulando. O resultado
 *   e monotonico por construcao, entao dia que cruza a meia-noite nunca mais e reordenado — e
 *   interpretado. Dia diurno nao ganha rolagem nenhuma e a deteccao de inversao volta a ser
 *   estrita, que e o comportamento que pegava erro de digitacao antes de 64d8863.
 *
 * LIMITE CONHECIDO — E POR QUE ELE NAO SE FECHA AQUI
 *   Sem a data, "18:00 depois 17:00" e ambiguo: pode ser intervalo iniciado 23h depois, pode
 *   ser digitacao errada. Nenhuma heuristica resolve isso, e este modulo nao finge resolver
 *   (ver MAX_ROLAGENS e o teto de 24h abaixo).
 *
 *   A informacao existe e e descartada: resolverMarcacaoDoDia devolve um Date completo, o
 *   calculo de hora extra da geracao usa esse Date com setDate(+1) e acerta a virada, e a linha
 *   seguinte formata com toLocaleTimeString({hour, minute}) e joga a data fora. A correcao de
 *   verdade e persistir o offset de dia por passo na geracao — as quatro copias dela — e fazer
 *   tela, validacao e impressao LEREM o campo em vez de readivinhar. Enquanto isso nao existe,
 *   este modulo e o palpite unico, conservador e testavel; nao o lugar certo da resposta.
 */

export type PassoFolha = 'entrada' | 'saida_intervalo' | 'retorno_intervalo' | 'saida'

/** Ordem canonica dos passos na folha. Tambem e a ordem cronologica esperada do dia. */
export const PASSOS_FOLHA: readonly PassoFolha[] = [
  'entrada',
  'saida_intervalo',
  'retorno_intervalo',
  'saida',
] as const

/** Um dia da folha, so os campos que este modulo le. */
export type HorariosDia = Partial<Record<PassoFolha, string | null | undefined>>

export interface SequenciaDia {
  /**
   * Minutos ABSOLUTOS de cada passo, ja com a rolagem de meia-noite aplicada. Passo do dia
   * seguinte vem como minuto + 1440. null quando o campo esta vazio.
   */
  minutos: Record<PassoFolha, number | null>
  /** 0 = mesmo dia da linha da folha, 1 = dia seguinte. Sempre 0 quando o campo esta vazio. */
  offsetDias: Record<PassoFolha, number>
  /** true quando algum passo preenchido caiu no dia seguinte. */
  cruzaMeiaNoite: boolean
  /** Entrada >= Saida do intervalo (com rolagem aplicada). */
  entradaInvertida: boolean
  /** Saida do intervalo >= Retorno do intervalo. */
  intervaloInvertido: boolean
  /** Ultimo passo antes da saida >= Saida final. */
  saidaInvertida: boolean
  /** Qualquer uma das tres acima. */
  invertido: boolean
}

/** Atalho de leitura: algum passo preenchido deste dia caiu no dia seguinte? */
export function temViradaDeDia(
  horarios: HorariosDia,
  jornadaNome?: string | null
): boolean {
  return sequenciarDia(horarios, jornadaNome).cruzaMeiaNoite
}

const MINUTOS_DIA = 24 * 60

/**
 * Uma linha da folha cobre uma jornada, nunca duas noites. Permitir uma segunda rolagem faria
 * qualquer sequencia, por mais quebrada, virar "cronologica" — e a inversao deixaria de existir
 * como conceito. Precisando de uma segunda, a leitura para e o dia e reportado como invertido.
 */
const MAX_ROLAGENS = 1

export function timeToMin(timeStr?: string | null): number | null {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return null
  const [h, m] = timeStr.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return null
  return h * 60 + m
}

/**
 * O nome da jornada descreve uma jornada que termina no dia seguinte? ("18H AS 06H" -> true)
 *
 * Continua sendo regex sobre o nome porque e a unica informacao de jornada que a folha carrega
 * hoje (registro.jornada_nome). Renomear jornada quebra isto, exatamente como ja quebra o nivel
 * 3 da cadeia de precedencia de horario previsto — mesma divida, nao uma nova.
 */
export function jornadaCruzaMeiaNoite(jornadaNome?: string | null): boolean {
  const j = parseJornadaNome(jornadaNome)
  return j !== null && j.fimMin <= j.inicioMin
}

function parseJornadaNome(
  jornadaNome?: string | null
): { inicioMin: number; fimMin: number } | null {
  if (!jornadaNome) return null
  const match = jornadaNome.match(
    /(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i
  )
  if (!match) return null
  const inicioH = parseInt(match[1], 10)
  const fimH = parseInt(match[3], 10)
  if (isNaN(inicioH) || isNaN(fimH)) return null
  return {
    inicioMin: inicioH * 60 + (match[2] ? parseInt(match[2], 10) : 0),
    fimMin: fimH * 60 + (match[4] ? parseInt(match[4], 10) : 0),
  }
}

/**
 * Aquele dia tem DIREITO de rolar para o dia seguinte?
 *
 * O NOME DA JORNADA E AUTORITATIVO NOS DOIS SENTIDOS. Se ele diz que a jornada termina no dia
 * seguinte, ha direito; se diz que termina no mesmo dia, NAO ha — e uma saida menor que a
 * entrada ali e problema, nao virada.
 *
 * So quando o nome nao e parseavel entra o palpite de que entrada vespertina (>= 12:00) indica
 * jornada noturna.
 *
 * POR QUE O PALPITE NAO VALE QUANDO O NOME PARSEIA
 *   A primeira versao deste arquivo aplicava o palpite sempre, para cobrir um Plantao N escalado
 *   sobre servidor de jornada diurna. Medido em produção em 19/08/2026, nos 94 dias em que a
 *   entrada e >= 12:00 e a saida e menor que ela — exatamente onde a decisao pesa:
 *
 *     67 tem nome de jornada que ja diz noturna  -> cobertos pela regra principal
 *     27 tem nome de jornada DIURNA              -> so o palpite os salvava
 *      0 tem nome nao parseavel
 *
 *   E os 27 sao todos turno DIURNO (MT, T, T4, M em 08H AS 18H, 13H AS 19H, 14H AS 18H...) —
 *   nenhum plantao noturno de verdade. Ou seja, o palpite nao protegia nenhum caso legitimo e
 *   carimbava "+1d" em 27 linhas com dado corrompido, escondendo justamente o que precisava
 *   aparecer. 55 delas sao linhas de turno MT cuja entrada veio da vespera as ~18:00 e cuja
 *   saida veio do dia seguinte as ~08:00 — `fn_blocos_previstos_dia` preve 08:00 -> 18:00 no
 *   mesmo dia para esses dias, entao a previsao esta certa e a atribuicao da batida e que erra.
 *
 * A ASSIMETRIA E DELIBERADA
 *   Se um Plantao N sobre jornada diurna aparecer, ele vai ser marcado como invertido — alarme
 *   falso, visivel, que alguem corrige. O caminho oposto (carimbar "+1d" e seguir) transforma
 *   dado corrompido em jornada plausivel dentro do espelho oficial, em silencio. Num sistema de
 *   ponto, alarme falso visivel ganha de erro silencioso.
 */
export function podeCruzarMeiaNoite(
  horarios: HorariosDia,
  jornadaNome?: string | null
): boolean {
  const jornada = parseJornadaNome(jornadaNome)
  if (jornada !== null) return jornada.fimMin <= jornada.inicioMin
  const entradaMin = timeToMin(horarios.entrada)
  return entradaMin !== null && entradaMin >= 12 * 60
}

/**
 * Le os quatro passos do dia em ordem cronologica absoluta.
 *
 * Percorre na ordem das colunas — que e a ordem em que fn_confirmar_presenca atribui os passos,
 * logo ja cronologica quando o dado esta sao. Cada passo menor que o anterior consome a rolagem
 * de meia-noite, se o dia tiver direito a ela; senao, e inversao.
 */
export function sequenciarDia(
  horarios: HorariosDia,
  jornadaNome?: string | null
): SequenciaDia {
  const podeRolar = podeCruzarMeiaNoite(horarios, jornadaNome)

  const minutos = {} as Record<PassoFolha, number | null>
  const offsetDias = {} as Record<PassoFolha, number>

  let offsetAtual = 0
  let anteriorBruto: number | null = null
  let rolagemImpossivel = false

  /**
   * Ancora para o caso de a ENTRADA estar vazia — o servidor esqueceu de registrar e o
   * coordenador digita so a saida. Sem passo anterior nao havia com o que comparar, e uma saida
   * digitada como "06:00" numa jornada 18H AS 06H saia sem o marcador de dia seguinte.
   *
   * Vale so quando a entrada esta vazia. Com entrada preenchida ela E a ancora, por definicao:
   * a linha da folha e o dia em que a jornada comecou. Ancorar tambem nesse caso faria uma
   * entrada adiantada (17:55 numa jornada que comeca 18:00) ser lida como do dia seguinte.
   */
  if (podeRolar && timeToMin(horarios.entrada) === null) {
    const jornada = parseJornadaNome(jornadaNome)
    if (jornada !== null) anteriorBruto = jornada.inicioMin
  }

  for (const passo of PASSOS_FOLHA) {
    const bruto = timeToMin(horarios[passo])
    if (bruto === null) {
      minutos[passo] = null
      offsetDias[passo] = 0
      continue
    }

    if (anteriorBruto !== null && bruto < anteriorBruto) {
      if (podeRolar && offsetAtual < MAX_ROLAGENS) {
        offsetAtual++
      } else {
        // Sem direito a rolar (ou ja rolou uma vez): e inversao de verdade. Mantem o offset
        // corrente para que a comparacao abaixo acuse, em vez de mascarar.
        rolagemImpossivel = true
      }
    }

    minutos[passo] = bruto + offsetAtual * MINUTOS_DIA
    offsetDias[passo] = offsetAtual
    anteriorBruto = bruto
  }

  const { entrada, saida_intervalo, retorno_intervalo, saida } = minutos

  // Compara cada par so quando os dois lados existem. O antecessor da saida final e o ultimo
  // passo preenchido antes dela — sem isso, dia de jornada direta (2 batidas) nunca seria
  // conferido.
  const antesDaSaida = retorno_intervalo ?? saida_intervalo ?? entrada

  const entradaInvertida =
    entrada !== null && saida_intervalo !== null && entrada >= saida_intervalo
  const intervaloInvertido =
    saida_intervalo !== null && retorno_intervalo !== null && saida_intervalo >= retorno_intervalo
  const saidaInvertida = antesDaSaida !== null && saida !== null && antesDaSaida >= saida

  const cruzaMeiaNoite = PASSOS_FOLHA.some(p => offsetDias[p] > 0)

  return {
    minutos,
    offsetDias,
    cruzaMeiaNoite,
    entradaInvertida,
    intervaloInvertido,
    saidaInvertida,
    invertido: rolagemImpossivel || entradaInvertida || intervaloInvertido || saidaInvertida,
  }
}
