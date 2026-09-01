/**
 * Fonte unica da ordem cronologica dos quatro passos de presenca de UM bloco de trabalho.
 *
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE (01/09/2026)
 *   A validacao manual da grade comparava os quatro horarios como minutos do MESMO dia civil.
 *   Num plantao noturno isso e sempre falso: entrada 19:00, intervalo 22:00/23:00, saida 07:00 —
 *   a saida e do dia SEGUINTE, e a tela recusava com "a saida final (07:00) nao pode ser anterior
 *   ou igual ao retorno do intervalo (23:00)". O coordenador nao tinha como completar a validacao
 *   de nenhum plantao que atravessa a meia-noite.
 *
 *   Havia um remendo — `&& mSai > 360`, que deixava passar saida ate as 06:00 e nada acima disso.
 *   Ele nao vinha de regra nenhuma: `N` termina as 07:00, `MN` as 13:00 e `MTN` as 07:00, todos
 *   acima do corte. Saiu junto.
 *
 * A REGRA
 *   Os passos preenchidos formam UMA sequencia estritamente crescente. Quando o turno atravessa a
 *   meia-noite, o passo cujo HH:MM cai antes do passo anterior pertence ao dia seguinte — e isso
 *   vale para os QUATRO passos, nao so para a saida (plantao 19:00–07:00 com intervalo 00:30/01:30
 *   tem os dois passos de intervalo no dia seguinte).
 *
 *   Quem decide se o turno atravessa a meia-noite e o PREVISTO do bloco (fn_blocos_previstos_dia,
 *   a mesma fonte que o terminal cobra), com o codigo do turno como reserva. Sem isso, so restaria
 *   adivinhar pelo proprio horario digitado — que e exatamente o que produz o remendo acima.
 *
 * ⚠️ O TETO DE 24H E O QUE IMPEDE A NORMALIZACAO DE ESCONDER ERRO DE DIGITACAO.
 *   Sem ele, "entrada 19:00 / saida 18:00" (um 7 virando 8) viraria uma jornada de 23h em vez de
 *   ser recusada, e depois `retorno 17:00` empurraria a sequencia para D+2. Um bloco de trabalho
 *   nunca passa de 24h — `MTN` bate exatamente nas 24h e e o maior do dicionario.
 *
 * ⚠️ O BANCO NAO DELEGA ISTO A TELA. `fn_registrar_presenca_informada` faz a MESMA normalizacao
 *   monotonica antes de gravar (migration 20260901110000): a RPC e chamavel direto e ate
 *   01/09/2026 so deslocava a `saida`, e so quando a `entrada` vinha no mesmo payload — validar o
 *   2o periodo de um plantao noturno gravava a saida das 07:00 ANTES do retorno das 23:00.
 */

export type PassoPresenca = 'entrada' | 'intervalo_saida' | 'intervalo_retorno' | 'saida'

/** A ordem cronologica dos passos dentro de um bloco. Nao e alfabetica nem a do formulario. */
export const PASSOS_EM_ORDEM: PassoPresenca[] = [
  'entrada', 'intervalo_saida', 'intervalo_retorno', 'saida',
]

export const ROTULO_PASSO: Record<PassoPresenca, string> = {
  entrada: 'entrada',
  intervalo_saida: 'saída para o intervalo',
  intervalo_retorno: 'retorno do intervalo',
  saida: 'saída final',
}

const MIN_POR_DIA = 24 * 60

/** `'07:00'` ou `'07:00:00'` -> minutos desde a meia-noite. Fora do formato, null. */
export function minutosDoHHMM(valor?: string | null): number | null {
  if (!valor) return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(valor.trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export type HorariosDaSequencia = Partial<Record<PassoPresenca, string | null | undefined>>

export type ResultadoSequencia = {
  /** false quando ha erro cronologico; a mensagem ja vem pronta para a tela. */
  ok: boolean
  mensagem?: string
  /** Minutos acumulados desde a meia-noite do dia da ESCALA: 07:00 do dia seguinte = 1860. */
  acumulado: Partial<Record<PassoPresenca, number>>
  /** Passos que caem no dia seguinte — a tela marca "+1 dia" ao lado do campo. */
  diaSeguinte: PassoPresenca[]
}

/**
 * Avalia (e normaliza) a sequencia de horarios de um bloco.
 *
 * `cruzaMeiaNoite` vem do previsto do bloco, nunca do que foi digitado: e o que separa
 * "plantao noturno" de "erro de digitacao" quando a saida e menor que a entrada.
 */
export function avaliarSequenciaPresenca(
  horarios: HorariosDaSequencia,
  opcoes: { cruzaMeiaNoite: boolean }
): ResultadoSequencia {
  const acumulado: Partial<Record<PassoPresenca, number>> = {}
  const diaSeguinte: PassoPresenca[] = []

  let anterior: { passo: PassoPresenca; hhmm: string; minutos: number } | null = null
  let ancora: number | null = null

  for (const passo of PASSOS_EM_ORDEM) {
    const hhmm = (horarios[passo] || '').toString().slice(0, 5)
    const base = minutosDoHHMM(hhmm)
    if (base === null) continue

    let valor = base
    if (anterior && valor <= anterior.minutos) {
      if (!opcoes.cruzaMeiaNoite) {
        return {
          ok: false,
          mensagem: `A ${ROTULO_PASSO[passo]} (${hhmm}) não pode ser anterior ou igual `
            + `à ${ROTULO_PASSO[anterior.passo]} (${anterior.hhmm}). `
            + `O turno previsto para este dia não atravessa a meia-noite.`,
          acumulado,
          diaSeguinte,
        }
      }
      valor += MIN_POR_DIA
    }

    // ⚠️ SOMAR UM DIA NAO PODE SER PRESUMIDO COMO SUFICIENTE. Um dia so entra uma vez: se depois
    // do deslocamento o passo AINDA nao passou do anterior, a sequencia e impossivel e tem de ser
    // recusada. Sem esta linha, `19:00 / 18:00 / 17:00` era aceito — o 17:00 ganhava o dia e
    // continuava antes do 18:00, e a validacao passava calada (pego pelo portao ao escreve-lo).
    if (anterior && valor <= anterior.minutos) {
      return {
        ok: false,
        mensagem: `A ${ROTULO_PASSO[passo]} (${hhmm}) não pode ser anterior ou igual `
          + `à ${ROTULO_PASSO[anterior.passo]} (${anterior.hhmm}).`,
        acumulado,
        diaSeguinte,
      }
    }

    if (ancora === null) ancora = valor
    if (valor - ancora > MIN_POR_DIA) {
      return {
        ok: false,
        mensagem: `Com a ${ROTULO_PASSO[passo]} em ${hhmm}, o período passaria de 24 horas. `
          + `Confira os horários informados.`,
        acumulado,
        diaSeguinte,
      }
    }

    acumulado[passo] = valor
    if (valor >= MIN_POR_DIA) diaSeguinte.push(passo)
    anterior = { passo, hhmm, minutos: valor }
  }

  return { ok: true, acumulado, diaSeguinte }
}
