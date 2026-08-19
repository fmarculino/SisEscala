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

/** Monta o mapa a partir da lista de jornadas do banco. */
export function montarCargaPorJornada(
  jornadas: Array<{ nome?: string | null; horas_totais?: number | null }> | null | undefined
): CargaPorJornada {
  const mapa: CargaPorJornada = new Map()
  for (const j of jornadas || []) {
    if (!j?.nome) continue
    if (typeof j.horas_totais === 'number') mapa.set(j.nome, j.horas_totais)
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
