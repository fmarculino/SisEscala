/**
 * Falta automatica na folha de ponto.
 *
 * Um dia com turno previsto, sem afastamento/feriado/facultativo cobrindo-o e SEM nenhuma
 * marcacao (real ou manual) de entrada nem saida fica em branco hoje — nao vira falta, nao
 * conta em lugar nenhum, sem sinalizacao. Ver
 * docs/planos/2026-08-14-estudo-faltas-automaticas-e-banco-de-horas.md (secao 2).
 *
 * Regra: pendente ("FALTA - AGUARDANDO JUSTIFICATIVA") enquanto o mes ainda esta dentro do
 * prazo de justificativa (configuracoes_globais.justificativa_prazo_dias_uteis, dias uteis
 * APOS O FIM DO MES — e assim que a propria tela de Configuracoes ja descreve o campo, so
 * nunca foi lido em lugar nenhum ate 14/08/2026). Vira falta DEFINITIVA quando o prazo passa
 * sem ninguem preencher uma observacao manual.
 *
 * So avalia dias que ja aconteceram (nunca marca falta num dia futuro dentro do mes corrente).
 */

/** Conta dias uteis (seg-sex, exclui feriados) estritamente APOS dataBase, ate dataAtual inclusive. */
export function diasUteisAposData(dataBase: Date, dataAtual: Date, feriados: Set<string>): number {
  if (dataAtual <= dataBase) return 0

  let count = 0
  const cursor = new Date(dataBase)
  cursor.setDate(cursor.getDate() + 1)

  while (cursor <= dataAtual) {
    const diaDaSemana = cursor.getDay()
    const dataStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    if (diaDaSemana !== 0 && diaDaSemana !== 6 && !feriados.has(dataStr)) {
      count++
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return count
}

export function resolverFaltaAutomatica(opts: {
  /** O dia (calendario local) ja aconteceu, comparado a "hoje". */
  diaJaPassou: boolean
  /** Ha algum registro (real ou manual) de entrada ou saida neste dia. */
  temMarcacao: boolean
  /** Ultimo dia do mes da folha, calendario local. */
  fimDoMes: Date
  /** "Hoje", calendario local. */
  hoje: Date
  feriados: Set<string>
  /** justificativa_prazo_dias_uteis (configuracoes_globais), default 3. */
  prazoDiasUteis: number
}): string | null {
  if (!opts.diaJaPassou || opts.temMarcacao) return null

  const decorridos = diasUteisAposData(opts.fimDoMes, opts.hoje, opts.feriados)
  if (decorridos > opts.prazoDiasUteis) {
    return 'FALTA'
  }
  return 'FALTA - AGUARDANDO JUSTIFICATIVA'
}

/** Marcador do texto pendente, usado para excluir da contagem de faltas em todo lugar que soma. */
export const MARCADOR_FALTA_PENDENTE = 'AGUARDANDO JUSTIFICATIVA'

/** true só para falta DEFINITIVA — exclui a pendente do prazo de justificativa. */
export function isFaltaDefinitiva(observacao?: string | null): boolean {
  if (!observacao) return false
  const upper = observacao.toUpperCase()
  return upper.includes('FALTA') && !upper.includes(MARCADOR_FALTA_PENDENTE)
}

/**
 * Fechar a folha É o prazo (decisão do usuário, 01/09/2026): "AGUARDANDO JUSTIFICATIVA" existe
 * para dar tempo de reação ENQUANTO a folha está aberta. No instante em que o fechamento é
 * confirmado, ninguém mais vai justificar — o pendente vira falta definitiva ali mesmo, na
 * mesma gravação. Sem isso, uma folha fechada antes do prazo de `justificativa_prazo_dias_uteis`
 * vencer congelava "aguardando" para sempre: nada revisita uma folha já Revisada para
 * reavaliar o texto, nem o fechamento manual nem o automático do cron.
 */
export function diasComFaltaPendente(registros: { dia: number; observacao?: string | null }[]): number[] {
  return registros
    .filter(r => typeof r.observacao === 'string' && r.observacao.toUpperCase().includes(MARCADOR_FALTA_PENDENTE))
    .map(r => r.dia)
    .sort((a, b) => a - b)
}

/** Promove toda observação pendente para definitiva, em memória — quem chama grava o resultado. */
export function promoverFaltasPendentes(registros: { observacao?: string | null }[]): void {
  registros.forEach(r => {
    if (typeof r.observacao === 'string' && r.observacao.toUpperCase().includes(MARCADOR_FALTA_PENDENTE)) {
      r.observacao = 'FALTA'
    }
  })
}

/**
 * Dias com falta DECLARADA com antecedência pelo coordenador (`justificativas_eventos`,
 * categoria Regular, resultado 'falta' — ver `declararFaltaAntecipada` em folha-ponto/actions.ts).
 * Diferente da falta automática, esta pula o prazo de dias úteis inteiro: o coordenador já
 * decidiu, então não há mais nada a aguardar. Chamada uma vez por geração/sincronização, nunca
 * por dia — evita N+1 no laço que monta os `daysInMonth` registros.
 */
export async function diasComFaltaDeclarada(
  supabase: any,
  servidorId: string,
  mes: number,
  ano: number
): Promise<Set<number>> {
  const { data } = await supabase
    .from('justificativas_eventos')
    .select('dia')
    .eq('servidor_id', servidorId)
    .eq('mes', mes)
    .eq('ano', ano)
    .eq('categoria', 'Regular')
    .eq('resultado', 'falta')

  return new Set((data || []).map((d: any) => d.dia))
}
