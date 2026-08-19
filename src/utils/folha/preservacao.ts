/**
 * Fonte unica de "este horario da folha pode ser sobrescrito ao regerar/sincronizar?".
 *
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE
 *   `folha_ponto.registros` e um SNAPSHOT em jsonb: ele nao le `escala_diaria` na hora de
 *   exibir. Quem traz o horario da escala para a folha e a geracao/sincronizacao — e em
 *   19/08/2026 as quatro copias dela preservavam TUDO que ja estivesse preenchido
 *   (`shouldPreserve = true`, ou `!scaleChangedForDay`, que da no mesmo quando a escala nao
 *   mudou). Resultado: horario corrigido no banco nunca mais chegava a folha.
 *
 *   O caso real: a batida de 18/08 21:20 tinha sido alocada como ENTRADA do dia 19 e a batida
 *   real das 08:23 como SAIDA PARA O INTERVALO. Corrigida a alocacao (migration 20260819180000)
 *   e reconciliada a escala_diaria, a folha continuou mostrando "21:20 / 08:23" — e "Sincronizar"
 *   nao adiantava, porque preservava justamente o valor errado. Dois bugs em serie, e o segundo
 *   escondia a correcao do primeiro.
 *
 * O CRITERIO: PRESERVA-SE DECISAO HUMANA, NAO VALOR DERIVADO
 *   `origem_*` ja distingue os dois casos, e o editor da folha marca 'manual' em toda celula
 *   que alguem digita (FolhaPontoEditor, handler de edicao). Entao:
 *
 *     'manual' | 'ajuste_coordenador' | 'ajuste_servidor'  -> alguem decidiu: PRESERVA
 *     'real' | 'pre_assinalado' | null | ausente            -> derivado da escala: REGERA
 *
 *   Preservar 'real' parece conservador ("nao mexer em batida"), mas e o oposto: 'real' e
 *   exatamente o valor que a escala_diaria manda, e congela-lo impede a folha de receber a
 *   correcao de uma batida mal alocada. Batida real continua protegida onde importa — o guard
 *   de `salvarFolhaPonto` recusa que alguem que nao seja super_admin ALTERE um horario de
 *   origem 'real'.
 *
 * POR QUE UM MODULO, E NAO UM IF EM CADA COPIA
 *   Sao quatro geracoes de folha (`executeGerarFolhaPonto`, `sincronizarFolhaPonto`,
 *   `gerarFolhaPontoServidor`, `sincronizarFolhaPontoServidor`) e elas ja divergiram entre si
 *   antes — mesma armadilha que criou `sequenciaDia.ts`. Um criterio, um arquivo.
 */

export type CampoFolha = 'entrada' | 'saida_intervalo' | 'retorno_intervalo' | 'saida'

/** Origens que representam decisao de uma pessoa, e por isso sobrevivem a regeracao. */
export const ORIGENS_EDICAO_HUMANA = ['manual', 'ajuste_coordenador', 'ajuste_servidor'] as const

type RegistroFolha = Record<string, unknown> | null | undefined

/** A origem gravada para aquele campo indica edicao humana? */
export function ehEdicaoHumana(registro: RegistroFolha, campo: CampoFolha): boolean {
  if (!registro) return false
  const origem = registro[`origem_${campo}`]
  return typeof origem === 'string' && (ORIGENS_EDICAO_HUMANA as readonly string[]).includes(origem)
}

/**
 * O valor ja gravado neste campo deve ser mantido como esta?
 * So quando ha valor E ele veio de decisao humana.
 */
export function preservarCampo(registro: RegistroFolha, campo: CampoFolha): boolean {
  if (!registro) return false
  const valor = registro[campo]
  if (typeof valor !== 'string' || valor === '') return false
  return ehEdicaoHumana(registro, campo)
}
