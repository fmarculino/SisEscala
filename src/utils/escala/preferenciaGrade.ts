/**
 * Preferencia de layout da grade de escala: cabecalho dos dias travado no topo
 * (comportamento de planilha, pedido pelos coordenadores em 16/09/2026) ou a grade
 * inteira rolando junto com a pagina, como era ate entao.
 *
 * ⚠️ Vive no localStorage de proposito, e nao em `configuracoes_globais`: e gosto de
 * quem opera, nao regra de negocio. Nao muda numero nenhum da escala, nao viaja para o
 * banco e nao pode valer para os outros usuarios da mesma unidade -- o mesmo
 * coordenador usa monitores diferentes e quer o layout de cada um.
 *
 * ⚠️ Todo acesso vai em try/catch: janela anonima, site data bloqueado ou storage cheio
 * fazem `localStorage` LANCAR no acesso, e preferencia de layout nao pode derrubar a
 * grade de escala. Falha ao ler = o padrao; falha ao gravar = a escolha nao sobrevive
 * ao reload, o que e o pior aceitavel.
 */

export const CHAVE_CABECALHO_FIXO = 'sisescala:escala:cabecalho-fixo'

/**
 * Padrao TRAVADO: foi o que os usuarios pediram, e quem preferir o layout antigo
 * desliga em um clique -- a escolha fica salva naquele navegador.
 */
export const CABECALHO_FIXO_PADRAO = true

/**
 * Piso da area de rolagem da grade. Em monitor baixo (ou com a janela reduzida), a conta
 * da altura disponivel pode dar um valor em que nao cabe linha nenhuma: ai vale mais
 * deixar a PAGINA rolar um pouco do que espremer a grade a nada.
 */
export const ALTURA_MINIMA_GRADE = 320

/** Folga abaixo do card, para a borda inferior nao encostar no fim da area visivel. */
export const FOLGA_INFERIOR_GRADE = 24

export function lerPreferenciaCabecalhoFixo(): boolean {
  if (typeof window === 'undefined') return CABECALHO_FIXO_PADRAO
  try {
    const valor = window.localStorage.getItem(CHAVE_CABECALHO_FIXO)
    if (valor === null) return CABECALHO_FIXO_PADRAO
    return valor === '1'
  } catch {
    return CABECALHO_FIXO_PADRAO
  }
}

export function gravarPreferenciaCabecalhoFixo(valor: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CHAVE_CABECALHO_FIXO, valor ? '1' : '0')
  } catch {
    // Preferencia e descartavel: sem storage, o modo continua valendo nesta sessao.
  }
}

/**
 * Quanto sobra de altura para a grade, dado onde o card comeca dentro da area que rola.
 *
 * ⚠️ `distanciaDoTopo` e a distancia ate o topo do CONTEUDO da area que rola, nunca o
 * `getBoundingClientRect().top` cru -- este ultimo muda conforme a rolagem, e a altura
 * da grade passaria a depender de onde a pagina estava quando alguem redimensionou.
 */
export function alturaDisponivelParaGrade(
  distanciaDoTopo: number,
  alturaDaAreaVisivel: number,
  folgaInferior: number = FOLGA_INFERIOR_GRADE,
  piso: number = ALTURA_MINIMA_GRADE,
): number {
  const disponivel = alturaDaAreaVisivel - distanciaDoTopo - folgaInferior
  if (!Number.isFinite(disponivel)) return piso
  return Math.max(piso, Math.round(disponivel))
}
