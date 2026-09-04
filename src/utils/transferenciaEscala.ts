/**
 * O que acontece com a ESCALA quando alguém é transferido de setor.
 *
 * ⚠️ **Até 03/09/2026 o sistema decidia sozinho, e a decisão era APAGAR.**
 * `registrarTransferenciaEfetivada` fazia quatro coisas, todas `DELETE`: apagava os dias a partir
 * da data da transferência no setor de ORIGEM, apagava os dias anteriores no DESTINO (só se a
 * escala de destino já existisse), e apagava por inteiro as escalas de meses seguintes na origem
 * e de meses anteriores no destino.
 *
 * Ou seja: a metade "depois da transferência" era destruída, **nunca movida**, e a escala do setor
 * novo nunca era criada. Medido em produção em 03/09/2026: 4 servidores lotados em MAIS MEDICOS
 * com a escala inteira ainda no AMBULATÓRIO CLÍNICO, os dias posteriores apagados, e MAIS MEDICOS
 * sem escala nenhuma. Agravava que o bloco inteiro rodava num `try/catch` que só fazia
 * `console.error`: a transferência "dava certo" sem ter tocado em escala alguma, e a tela não
 * dizia nada.
 *
 * ⚠️ **O default é `'nao_mexer'`, e isso é deliberado.** Quem chama sem escolher não pode acabar
 * apagando mês de trabalho por omissão. Mexer em escala é decisão de quem transfere, tomada na
 * tela, com o número de dias na frente — nunca efeito colateral de um `UPDATE` em `servidores`.
 */

export type AcaoEscalaTransferencia = 'mover' | 'dividir' | 'nao_mexer'

/** O que de fato mudou — para a tela relatar, nunca supor (armadilha 22). */
export interface RelatoEscalaTransferencia {
  acao: AcaoEscalaTransferencia
  /** Competências movidas por inteiro, como "09/2026". */
  movidas: string[]
  /** Competência dividida e o dia do corte. */
  divididas: { competencia: string; diaCorte: number; dias: number }[]
  /** Competências que NÃO mudaram, com o motivo — é a metade que costuma ser omitida. */
  naoMexidas: { competencia: string; motivo: string }[]
  /** Alguma folha ficou cobrindo dias que mudaram de setor. */
  folhaSincronizar: boolean
}

export function relatoVazio(acao: AcaoEscalaTransferencia): RelatoEscalaTransferencia {
  return { acao, movidas: [], divididas: [], naoMexidas: [], folhaSincronizar: false }
}

export const rotuloCompetencia = (mes: number, ano: number) =>
  `${String(mes).padStart(2, '0')}/${ano}`

/**
 * Texto para a tela depois de transferir. **Sempre diz o que NÃO mudou** — foi a ausência disso
 * que fez a transferência de 03/09/2026 parecer bem-sucedida enquanto a escala continuava no setor
 * antigo.
 */
export function descreverRelato(relato: RelatoEscalaTransferencia): string {
  if (relato.acao === 'nao_mexer') {
    return 'A escala não foi alterada: ela continua no setor de origem. Use "Transferir Escala" na grade quando quiser movê-la.'
  }

  const partes: string[] = []

  if (relato.movidas.length > 0) {
    partes.push(`Escala movida em ${relato.movidas.join(', ')}.`)
  }
  for (const d of relato.divididas) {
    partes.push(`Escala de ${d.competencia} dividida no dia ${d.diaCorte}: ${d.dias} dia(s) passaram para o setor novo.`)
  }
  if (relato.naoMexidas.length > 0) {
    partes.push(
      `Não alterada em ${relato.naoMexidas.map(n => `${n.competencia} (${n.motivo})`).join(', ')}.`
    )
  }
  if (relato.folhaSincronizar) {
    partes.push('Sincronize a folha de ponto das competências afetadas.')
  }

  if (partes.length === 0) {
    return 'Nenhuma escala foi encontrada para este servidor no setor de origem — nada a mover.'
  }
  return partes.join(' ')
}

/**
 * Quais competências a transferência alcança, e como.
 *
 * ⚠️ **A divisão só faz sentido no mês DA transferência.** Nos meses seguintes a pessoa já é do
 * setor novo o mês inteiro — dividir ali produziria uma escala parcial vazia na origem. E o mês da
 * transferência só é dividido quando o corte cai depois do dia 1: transferência no dia 1º é uma
 * mudança de mês inteiro, e mandá-la pela divisão criaria uma escala de origem sem nenhum dia.
 */
export function planejarCompetencias(
  competencias: { mes: number; ano: number }[],
  acao: AcaoEscalaTransferencia,
  transferencia: { dia: number; mes: number; ano: number }
): { mes: number; ano: number; operacao: 'mover' | 'dividir'; diaCorte?: number }[] {
  if (acao === 'nao_mexer') return []

  return competencias.map(c => {
    const ehMesDaTransferencia = c.mes === transferencia.mes && c.ano === transferencia.ano
    if (acao === 'dividir' && ehMesDaTransferencia && transferencia.dia > 1) {
      return { ...c, operacao: 'dividir' as const, diaCorte: transferencia.dia }
    }
    return { ...c, operacao: 'mover' as const }
  })
}

/**
 * Competências do setor de origem que a transferência deve alcançar: a do mês da transferência e
 * as posteriores. As anteriores ficam onde estão — a pessoa trabalhou lá, e reescrever mês passado
 * é o oposto do que a transferência afirma.
 */
export function competenciasAlcancadas(
  todas: { mes: number; ano: number }[],
  transferencia: { mes: number; ano: number }
): { mes: number; ano: number }[] {
  return todas
    .filter(c => c.ano > transferencia.ano || (c.ano === transferencia.ano && c.mes >= transferencia.mes))
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes)
}
