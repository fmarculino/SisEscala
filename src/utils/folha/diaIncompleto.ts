/**
 * Pendencia de revisao na folha de ponto — o dia INCOMPLETO.
 *
 * O QUE ISTO RESOLVE
 *   A falta automatica (`faltaAutomatica.ts`, 14/08/2026) e tudo-ou-nada: so dispara quando o dia
 *   nao tem NENHUMA marcacao. Basta um passo preenchido para o dia sair da regra — e ai ele fica
 *   sem cor, sem observacao, sem contagem, indistinguivel de um dia normal com celulas vazias.
 *
 *   O plano de 14/08 excluiu a batida parcial dizendo que ela "ja tem tratamento proprio".
 *   Medido em producao em 21/08/2026 (SMS, agosto, 2.307 pares servidor/dia com turno ja
 *   passados): **1.196 dias parciais — 51,8%** — e nao ha tratamento nenhum. A premissa estava
 *   errada.
 *
 * O RECORTE, E POR QUE ELE NAO E "TODO DIA INCOMPLETO"
 *   Dos 1.196, **1.010 sao entrada+saida sem nenhum intervalo**. Marcar todos como pendencia
 *   afogaria o coordenador em aviso e ele ignoraria o conjunto — inclusive os que importam.
 *   O recorte decidido pelo usuario em 21/08/2026 e mais estreito e tem um criterio objetivo:
 *
 *     pendencia so quando falta ENTRADA ou SAIDA — os passos sem os quais NAO DA PARA SABER
 *     QUANTO A PESSOA TRABALHOU.
 *
 *   Eram 151 dias na SMS, contra 1.010 de intervalo faltando. Intervalo ausente continua como
 *   esta: nao impede o calculo da jornada.
 *
 * O QUE ELA NAO FAZ
 *   Nao conta em `total_faltas` (o texto nao contem "FALTA", entao `isFaltaDefinitiva` a ignora
 *   de proposito), nao desconta hora, nao bloqueia nada. Ela SINALIZA. Quem decide continua
 *   sendo o coordenador — Portaria 671/2021, art. 82.
 *
 * COMO SAI DA TELA
 *   Preenchendo o horario que falta (validacao manual ou batida que chegue depois). A pendencia
 *   e recalculada a cada geracao/sincronizacao e nao e preservada, entao ela se cura sozinha —
 *   ao contrario de FALTA, que e preservada explicitamente.
 */

/** Prefixo do texto. Nao pode conter FALTA nem MANUAL — os dois sao lidos por outras regras. */
export const MARCADOR_REVISAR = 'REVISAR:'

export function resolverPendenciaRevisao(opts: {
  /** O dia (calendario local) ja aconteceu. Dia corrente nunca vira pendencia: pode faltar a saida so porque a pessoa ainda esta trabalhando. */
  diaJaPassou: boolean
  /** Ha alguma marcacao no dia. Dia sem nenhuma e FALTA, nao pendencia — as duas regras sao exclusivas. */
  temMarcacao: boolean
  temEntrada: boolean
  temSaida: boolean
}): string | null {
  if (!opts.diaJaPassou) return null
  if (!opts.temMarcacao) return null
  if (opts.temEntrada && opts.temSaida) return null

  if (!opts.temEntrada && !opts.temSaida) return `${MARCADOR_REVISAR} SEM REGISTRO DE ENTRADA E DE SAÍDA`
  if (!opts.temEntrada) return `${MARCADOR_REVISAR} SEM REGISTRO DE ENTRADA`
  return `${MARCADOR_REVISAR} SEM REGISTRO DE SAÍDA`
}

export function isPendenciaRevisao(observacao?: string | null): boolean {
  if (!observacao) return false
  return observacao.toUpperCase().includes(MARCADOR_REVISAR)
}
