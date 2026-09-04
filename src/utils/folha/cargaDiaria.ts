/**
 * Fonte unica de "quantas horas normais este dia da folha vale".
 *
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE
 *   A jornada de um servidor NAO e uma so no mes. `escala_mensal.jornada_id` e o padrao, e
 *   `servidores_jornadas_temporarias` sobrepoe esse padrao num intervalo de datas — e o banco
 *   inteiro ja respeita isso: `obter_jornada_servidor_data` e chamada de dentro de
 *   `fn_confirmar_presenca` e `fn_blocos_previstos_dia`, entao terminal, REP, reconciliacao e
 *   a GERACAO da folha resolvem a jornada dia a dia.
 *
 *   O RECALCULO de totais nao resolvia. `salvarFolhaPonto`, `autoCorrigirFolhaPonto` e
 *   `salvarFolhaPontoServidor` somavam `horas_totais` da jornada do MES para todo dia com
 *   turno. Um servidor com jornada reduzida por vigencia — o caso da reducao judicial — teria
 *   o total do mes contado pela jornada cheia, e o inverso tambem: medido em producao em
 *   19/08/2026, a folha 08/2026 de um servidor com 4 dias de jornada maior somava 76h onde o
 *   correto eram 100h.
 *
 * POR QUE RESOLVER PELO NOME GRAVADO NO REGISTRO
 *   Cada registro da folha ja carrega `jornada_nome`, gravado pela geracao com a jornada que
 *   de fato valeu naquele dia (incluindo a vigencia). A folha e um SNAPSHOT: o que ela diz que
 *   valeu no dia 12 e a verdade daquele dia, mesmo que a vigencia seja alterada depois. Ir ao
 *   banco de novo aqui reabriria a divergencia entre o que a folha mostra e o que ela soma.
 *
 *   Conferido antes de adotar: as 18 jornadas cadastradas tem nomes distintos, entao o nome
 *   resolve sem ambiguidade. Se algum dia existirem duas jornadas de mesmo nome e cargas
 *   diferentes, este e o lugar que precisa mudar — e so ele.
 */

/** Mapa nome da jornada -> horas normais diarias. */
export type CargaPorJornada = Map<string, number>

/** So os campos de jornada que este modulo le. */
export interface JornadaCarga {
  nome?: string | null
  horas_totais?: number | null
  intervalo_minutos?: number | null
}

/**
 * Horas normais de UM dia daquela jornada.
 *
 * 🚨 `horas_totais` E O VAO DO RELOGIO, NAO O TEMPO DE TRABALHO.
 *   "08H AS 18H" tem `horas_totais = 10` e `intervalo_minutos = 120` — o vao entre entrar e sair.
 *   Somar esse campo por dia contava o almoco como jornada: a folha de agosto/2026 de uma
 *   servidora saiu com **210h** (21 dias x 10h) onde o trabalho foram 168h (21 x 8h). Medido em
 *   04/09/2026 sobre 415 folhas: **9.217h de intervalo lancadas como jornada normal, 14,1%**.
 *
 * BASE LEGAL — o intervalo nao e jornada em nenhuma das tres fontes:
 *   Portaria 382/2019-GAB-MAB/SMS, Art. 3, I: "jornada de 8 (oito) horas, com intervalo de 2
 *     horas" — a norma do proprio ponto eletronico separa as duas coisas na mesma frase.
 *   Lei 17.331/2008 (RJU de Maraba), Art. 17: teto DIARIO de 8h para quem cumpre 40h semanais.
 *   CLT, Art. 71 §2: "Os intervalos de descanso nao serao computados na duracao do trabalho."
 *
 *   Confirmado pelas batidas: nos 19 dias completos daquela folha a servidora trabalhou em media
 *   8h07/dia. O relogio registrava o que a Portaria descreve; era a soma da folha que nao
 *   acompanhava.
 *
 * ⚠️ `descontarIntervalo` existe porque a regra vale a partir de 09/2026 (decisao do usuario,
 *   04/09/2026). Competencia anterior e documento ja assinado e continua somando o vao — ver
 *   horasNormaisLiquidasVigente em calculoDia.ts.
 */
export function horasNormaisDaJornada(
  jornada: JornadaCarga | null | undefined,
  descontarIntervalo: boolean,
  padrao = 8
): number {
  const bruto = typeof jornada?.horas_totais === 'number' ? jornada.horas_totais : padrao
  if (!descontarIntervalo) return bruto
  const intervalo = (Number(jornada?.intervalo_minutos) || 0) / 60
  // Nunca negativo: cadastro com intervalo maior que a jornada existiria como zero, nao como
  // desconto na folha de outro dia.
  return Math.max(0, bruto - intervalo)
}

/**
 * Monta o mapa a partir da lista de jornadas do banco.
 *
 * ⚠️ `descontarIntervalo` tem de ser o MESMO da competencia sendo calculada. O mapa e montado por
 * folha, e quem chama sabe o mes/ano — por isso a decisao entra aqui e nao dentro do laco.
 */
export function montarCargaPorJornada(
  jornadas: Array<JornadaCarga> | null | undefined,
  descontarIntervalo = false
): CargaPorJornada {
  const mapa: CargaPorJornada = new Map()
  for (const j of jornadas || []) {
    if (!j?.nome) continue
    if (typeof j.horas_totais === 'number') {
      mapa.set(j.nome, horasNormaisDaJornada(j, descontarIntervalo))
    }
  }
  return mapa
}

/**
 * Horas normais de um dia da folha.
 *
 * `horasPadrao` e a carga da jornada do mes — usada quando o registro nao diz qual jornada
 * valeu (folhas antigas, geradas antes de `jornada_nome` existir) ou quando o nome gravado nao
 * corresponde a nenhuma jornada atual (jornada renomeada ou removida depois). Nesses casos o
 * comportamento volta a ser exatamente o de antes, que e o unico fallback honesto: nao ha de
 * onde tirar a carga daquele dia.
 */
export function horasNormaisDoDia(
  registro: { jornada_nome?: string | null } | null | undefined,
  carga: CargaPorJornada,
  horasPadrao: number
): number {
  const nome = registro?.jornada_nome
  if (!nome) return horasPadrao
  const h = carga.get(nome)
  return typeof h === 'number' ? h : horasPadrao
}
