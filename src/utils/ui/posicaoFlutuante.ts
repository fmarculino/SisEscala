/**
 * Onde desenhar um painel flutuante (menu, popover) ancorado num botão.
 *
 * ⚠️ O motivo de existir NÃO é layout bonito: é que `position: absolute` dentro de um ancestral
 * com `overflow: hidden` é **recortado**, e o card da grade de escala tem `overflow-hidden` (o
 * arredondamento e a rolagem do cabeçalho fixo dependem dele). Com muitos servidores o card é
 * alto e o menu cabia; com um servidor só ele era cortado no meio, sem barra de rolagem e sem
 * nada indicando que havia mais opções abaixo. Quem renderiza em portal (fora do card) precisa
 * calcular a posição na tela, e é essa conta que mora aqui.
 *
 * Trabalha em coordenadas de VIEWPORT (`getBoundingClientRect` + `position: fixed`), então o
 * chamador precisa recalcular em `scroll` e `resize`.
 *
 * ℹ️ O popover de `IndicadoresPontoServidor.tsx` resolve o mesmo problema com uma cópia desta
 * conta. Não foi migrado junto de propósito: ele foi ajustado em campo duas vezes (v2.65.1 e
 * v2.65.2, abertura para cima e tooltip nativo concorrente) e mexer nele para ganhar só
 * unificação seria risco sem retorno. É o candidato natural se esta função precisar mudar.
 */

export interface AncoraFlutuante {
  /** `getBoundingClientRect()` do botão que abre o painel. */
  top: number
  bottom: number
  left: number
  right: number
}

export interface JanelaFlutuante {
  largura: number
  altura: number
}

export interface PainelFlutuante {
  /** Dimensões desejadas do painel. A altura é a NATURAL, antes de qualquer corte. */
  largura: number
  altura: number
  /** Distância entre o botão e o painel. */
  espacamento?: number
  /** Folga mínima entre o painel e a borda da janela. */
  margem?: number
}

export interface PosicaoFlutuante {
  top: number
  left: number
  /** Teto de altura: o painel rola por dentro quando não cabe inteiro. */
  maxHeight: number
  /** Verdadeiro quando o painel foi aberto para cima do botão. */
  paraCima: boolean
}

/**
 * Decide o canto superior esquerdo e o teto de altura do painel.
 *
 * As regras, em ordem:
 *   1. abre para BAIXO quando o espaço ali comporta o painel inteiro;
 *   2. senão, abre para CIMA se lá couber mais do que embaixo;
 *   3. de um jeito ou de outro, `maxHeight` é o espaço REAL do lado escolhido — é o que garante
 *      barra de rolagem em vez de item invisível, que era exatamente o defeito.
 *
 * ⚠️ `maxHeight` nunca é menor que `alturaMinima`: um painel espremido a 20px é tão inútil
 * quanto um cortado, e nesse caso é melhor ele vazar um pouco e rolar.
 */
export function calcularPosicaoFlutuante(
  ancora: AncoraFlutuante,
  painel: PainelFlutuante,
  janela: JanelaFlutuante,
  alturaMinima = 160
): PosicaoFlutuante {
  const espacamento = painel.espacamento ?? 8
  const margem = painel.margem ?? 8

  const espacoAbaixo = janela.altura - ancora.bottom - espacamento - margem
  const espacoAcima = ancora.top - espacamento - margem

  const cabeAbaixo = espacoAbaixo >= painel.altura
  const paraCima = !cabeAbaixo && espacoAcima > espacoAbaixo

  const espacoDisponivel = paraCima ? espacoAcima : espacoAbaixo
  const maxHeight = Math.max(alturaMinima, Math.min(painel.altura, espacoDisponivel))

  const top = paraCima
    ? Math.max(margem, ancora.top - espacamento - maxHeight)
    : ancora.bottom + espacamento

  // Alinha pela esquerda do botão e traz para dentro da janela quando estouraria à direita.
  const limiteDireita = Math.max(margem, janela.largura - painel.largura - margem)
  const left = Math.min(Math.max(margem, ancora.left), limiteDireita)

  return { top, left, maxHeight, paraCima }
}
