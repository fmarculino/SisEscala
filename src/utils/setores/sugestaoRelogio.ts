/**
 * Sugestão de relógio para um setor que nenhum equipamento atende.
 *
 * Fonte única da regra "o que vem pré-marcado". Ela vive aqui, e não nos componentes, porque os
 * DOIS caminhos que mostram sugestão (a aba Marcações → Setores sem Relógio e o aviso logo depois
 * de criar um setor) precisam decidir igual — e porque é uma regra que o projeto pode ser tentado
 * a afrouxar depois, sem perceber o que ela protege.
 *
 * Espelha `fn_relogios_sugeridos_para_setor` (migration 20260915140000).
 */

/** A gente DESTE setor já bate naquele relógio hoje. É fato, não inferência. */
export const FORCA_EVIDENCIA = 2
/** O ancestral mais próximo é atendido por ele. É palpite pela árvore de setores. */
export const FORCA_PALPITE = 1

export type SugestaoRelogio = {
  dispositivo_id: string
  dispositivo_nome: string
  unidade_nome: string
  forca: number
  motivo: string
}

/**
 * Quais sugestões vêm marcadas ao abrir a tela.
 *
 * 🚨 SÓ O SINAL FORTE. O palpite pela hierarquia erra exatamente no caso que a abrangência entre
 * unidades existe para resolver: medido em 15/09/2026, os 3 polos do CAF sairiam "herdando" os
 * relógios da SEDE do CAF, que fica em outro bairro. Pré-marcar isso ensinaria a clicar sem ler, e
 * o resultado seria cadastro espalhado por um equipamento onde aquela gente nunca põe o dedo.
 *
 * Marcar o que é fato e deixar o palpite para a pessoa decidir é o que mantém o aviso confiável.
 */
export function preMarcadas(sugestoes: SugestaoRelogio[]): string[] {
  return (sugestoes || [])
    .filter((s) => s.forca >= FORCA_EVIDENCIA)
    .map((s) => s.dispositivo_id)
}

/** Existe ao menos uma sugestão baseada em batida real? */
export function temEvidencia(sugestoes: SugestaoRelogio[]): boolean {
  return (sugestoes || []).some((s) => s.forca >= FORCA_EVIDENCIA)
}

/**
 * A frase que introduz a lista. Muda com a força porque a decisão que se pede é outra: com
 * evidência é "confirme"; com palpite é "descubra e escolha".
 */
export function textoIntroducao(sugestoes: SugestaoRelogio[]): string {
  if (!sugestoes || sugestoes.length === 0) {
    return 'Não dá para sugerir: ninguém deste setor bateu em relógio nenhum nos últimos 60 dias e nenhum setor acima dele é atendido.'
  }
  return temEvidencia(sugestoes)
    ? 'Relógio onde essa gente já bate hoje — já vem marcado:'
    : 'Palpite pela hierarquia dos setores. Confirme antes de aplicar:'
}

/** O aviso extra que só aparece quando a lista é palpite puro. */
export function avisoPalpite(sugestoes: SugestaoRelogio[]): string | null {
  if (!sugestoes || sugestoes.length === 0) return null
  if (temEvidencia(sugestoes)) return null
  return 'Isto é um palpite pela árvore de setores, não pelo lugar físico. Se este setor funciona em outro prédio, o relógio certo é o de lá — e não o do setor acima dele.'
}
