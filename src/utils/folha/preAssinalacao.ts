/**
 * Regra de preenchimento automatico da folha de ponto.
 *
 * O CRITERIO
 *   O sistema so preenche horario onde o servidor NAO TEM COMO REGISTRAR.
 *   Onde ele tem meio de registrar, preencher e fabricar marcacao.
 *
 * O QUE ISSO PROIBE
 *   Entrada e saida do turno NUNCA sao geradas. Em todas as unidades o servidor registra
 *   entrada e saida — no terminal web ou no relogio de ponto —, entao gerar horario ali e
 *   exatamente a "marcacao automatica do ponto usando horarios predeterminados ou contratuais"
 *   vedada pela Portaria 671/2021. Dia sem batida fica VAZIO, e a ausencia vira trabalho de
 *   tratamento do coordenador, que e o comportamento honesto.
 *
 * O QUE ISSO PERMITE
 *   Somente os dois passos de intervalo, e somente em unidade que NAO exige marcacao de
 *   intervalo (`unidades.permite_marca_intervalo = false`). Ali o servidor nao tem como
 *   registrar o repouso, e a CLT Art. 74 par. 2 nomeia exatamente esse mecanismo:
 *   "com a PRE-ASSINALACAO do periodo de repouso".
 *
 *   Nao e contorno da vedacao — e o instituto que a lei preve.
 *
 * POR QUE SEM OFFSET ALEATORIO
 *   A geracao antiga aplicava um deslocamento deterministico de ±1 a 14 minutos
 *   (getDeterministicOffset). Pre-assinalacao pressupoe horario PRE-ANOTADO, constante; o
 *   sorteio e justamente o que faz o campo parecer uma batida fabricada em vez de um repouso
 *   declarado.
 *
 *   O sorteio provavelmente nasceu para escapar da Sumula 338, III do TST, que invalida cartao
 *   com horarios de ENTRADA E SAIDA uniformes. Retirar a geracao de entrada e saida resolve
 *   isso na raiz: o que resta nesses campos sao batidas reais, que variam sozinhas. E o
 *   intervalo fixo nao e alcancado pela Sumula, que trata de entrada e saida.
 *
 * MEDIDO EM PRODUCAO (competencias fechadas, 08/08/2026)
 *   07/2026: entrada 71% real / 5% gerado · saida 65% real / 6% gerado
 *   intervalo: ZERO marcacoes reais em toda a base — 100% gerado ou manual.
 *   Ou seja: retirar a geracao de entrada/saida esvazia ~5% das celulas; o intervalo, que e o
 *   caso realmente sem alternativa, continua sendo preenchido.
 */

/** Origem de cada campo da folha. `ficticio` permanece apenas em folhas historicas. */
export type OrigemFolha = 'real' | 'manual' | 'pre_assinalado' | 'ficticio' | null

/**
 * A unidade permite pre-assinalar o intervalo?
 *
 * Verdadeiro apenas quando ela NAO exige que o servidor marque o intervalo no ponto. Se exige,
 * o horario tem de vir de batida — preencher seria fabricar o que o servidor deveria registrar.
 */
export function podePreAssinalarIntervalo(
  permiteMarcaIntervalo: boolean | null | undefined
): boolean {
  return !permiteMarcaIntervalo
}

/**
 * Entrada e saida do turno jamais sao geradas pelo sistema.
 * Existe como funcao — e nao como comentario solto — para que a regra tenha um nome citavel
 * e para que remover a proibicao exija mexer aqui, num lugar so.
 */
export const GERA_ENTRADA_SAIDA_AUTOMATICA = false as const
