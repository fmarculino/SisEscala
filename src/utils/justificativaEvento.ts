/**
 * Justificativa de EVENTO: quais categorias têm uma, e o que dizer para as que não têm.
 *
 * O módulo "Justificativas de Eventos" existe para **Hora Extra, Plantão e Sobreaviso** — é o que
 * a tela anuncia, é o que as consultas filtram, e é o que a tabela impõe: `justificativas_eventos`
 * tem `CHECK (categoria = ANY (ARRAY['Extra','Plantão','Sobreaviso']))`.
 *
 * 🚨 **Turno Regular não é evento.** Até 10/09/2026 a troca de turno de um dia Regular com ponto
 * tentava gravar a justificativa ali e morria em `23514` — a alteração inteira voltava atrás e o
 * coordenador via a mensagem crua do Postgres, sem nenhum outro caminho para corrigir a célula.
 *
 * ⚠️ **Espelho exato da CHECK, sem normalizar acento nem caixa.** Aceitar `plantao` aqui não
 * ajudaria ninguém: o banco continuaria recusando a linha. A categoria vem do enum
 * `escala_categoria`, então já chega exata.
 *
 * ⚠️ **Quem registra o ato é o histórico, sempre.** `escala_diaria_turno_historico` é append-only
 * e recebe o motivo em toda categoria. O que varia é só se aquele motivo também sai no relatório
 * de justificativas — e é isso que a tela precisa dizer com honestidade (armadilha 22: relatar o
 * que mudou, nunca o que se calculou).
 */

/** Categorias que têm justificativa de evento. Espelha justificativas_eventos_categoria_check. */
export const CATEGORIAS_COM_JUSTIFICATIVA_EVENTO = ['Extra', 'Plantão', 'Sobreaviso'] as const

export function categoriaTemJustificativaEvento(categoria: string | null | undefined): boolean {
  if (!categoria) return false
  return (CATEGORIAS_COM_JUSTIFICATIVA_EVENTO as readonly string[]).includes(categoria)
}

/**
 * Onde o motivo da troca de turno vai parar. Frase para o modal que pede a justificativa —
 * escrita antes de a alteração acontecer.
 */
export function destinoDaJustificativaTurno(categoria: string | null | undefined): string {
  if (categoriaTemJustificativaEvento(categoria)) {
    return `ele fica no histórico da escala e sai no relatório de justificativas de ${categoria}.`
  }
  return 'ele fica no histórico da escala. O relatório de justificativas cobre Hora Extra, '
    + 'Plantão e Sobreaviso — turno Regular não entra nele.'
}

/** O que de fato foi gravado. Frase para a confirmação, depois da alteração. */
export function descreverTrocaAplicada(params: {
  servidorNome: string
  dia: number
  codigoAnterior: string
  codigoNovo: string
  categoria: string
}): string {
  const { servidorNome, dia, codigoAnterior, codigoNovo, categoria } = params
  const onde = categoriaTemJustificativaEvento(categoria)
    ? `com a justificativa no histórico da escala e no relatório de justificativas de ${categoria}`
    : 'com a justificativa no histórico da escala'
  return `${servidorNome} — dia ${dia}: ${codigoAnterior || '—'} → ${codigoNovo}.\n\n`
    + `A alteração já está salva no banco, ${onde}. As marcações de ponto do dia foram preservadas.`
}
