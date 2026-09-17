/**
 * Portao de src/utils/ui/posicaoFlutuante.ts — a conta que tirou o menu "Ferramentas" de dentro
 * do card recortado (issue #5).
 *
 * Transpile antes com:
 *   npx tsc src/utils/ui/posicaoFlutuante.ts --outDir scratchpad/_sim_ui --module commonjs --target es2020
 */
const { calcularPosicaoFlutuante } = require('./_sim_ui/posicaoFlutuante.js')

let ok = 0
let falhas = 0

function eq(nome, obtido, esperado) {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) { ok++ } else {
    falhas++
    console.error('FALHOU: ' + nome + '\n  obtido:   ' + a + '\n  esperado: ' + b)
  }
}
function verdade(nome, cond) { eq(nome, !!cond, true) }

const JANELA = { largura: 1440, altura: 900 }
const PAINEL = { largura: 320, altura: 520 }

// Botao no topo da tela: sobra espaco embaixo, abre para baixo e cabe inteiro.
const alto = calcularPosicaoFlutuante(
  { top: 100, bottom: 140, left: 200, right: 320 },
  PAINEL, JANELA
)
eq('abre para baixo quando cabe', alto.paraCima, false)
eq('cola abaixo do botao com o espacamento', alto.top, 148)
eq('alinha pela esquerda do botao', alto.left, 200)
eq('altura natural quando ha espaco', alto.maxHeight, 520)

// ⚠️ O CASO DA ISSUE: o botao fica na barra de uma grade com UM servidor. O que decide nao e a
// altura do card (o portal escapa dele), e sim o espaco ate o fim da janela. Perto do rodape, o
// painel abre para cima em vez de vazar.
const baixo = calcularPosicaoFlutuante(
  { top: 780, bottom: 820, left: 200, right: 320 },
  PAINEL, JANELA
)
eq('abre para cima quando nao cabe embaixo', baixo.paraCima, true)
verdade('nao vaza pelo topo', baixo.top >= 8)
verdade('termina acima do botao', baixo.top + baixo.maxHeight <= 780 - 8 + 0.001)

// Espaco apertado dos DOIS lados: o painel rola por dentro. E isto que substitui o item
// invisivel do bug — nada pode ficar fora de alcance sem barra de rolagem.
const espremido = calcularPosicaoFlutuante(
  { top: 300, bottom: 340, left: 200, right: 320 },
  PAINEL,
  { largura: 1440, altura: 640 }
)
verdade('limita a altura ao espaco real', espremido.maxHeight < PAINEL.altura)
verdade('maxHeight positivo', espremido.maxHeight > 0)

// Janela muito baixa: melhor vazar e rolar do que espremer a ponto de nao caber um item.
const minusculo = calcularPosicaoFlutuante(
  { top: 100, bottom: 140, left: 200, right: 320 },
  PAINEL,
  { largura: 1440, altura: 220 }
)
eq('respeita a altura minima', minusculo.maxHeight, 160)

// Botao colado na direita: o painel entra para dentro da janela em vez de sair pela borda.
const direita = calcularPosicaoFlutuante(
  { top: 100, bottom: 140, left: 1380, right: 1430 },
  PAINEL, JANELA
)
eq('puxa para dentro quando estouraria a direita', direita.left, 1440 - 320 - 8)
verdade('nunca passa da borda direita', direita.left + PAINEL.largura <= JANELA.largura)

// Botao com left negativo (barra rolada): nunca posiciona fora da tela a esquerda.
const esquerda = calcularPosicaoFlutuante(
  { top: 100, bottom: 140, left: -40, right: 80 },
  PAINEL, JANELA
)
eq('nunca posiciona a esquerda da margem', esquerda.left, 8)

// Janela mais estreita que o painel: a margem esquerda vence, o painel rola/encolhe pelo CSS.
const estreita = calcularPosicaoFlutuante(
  { top: 100, bottom: 140, left: 10, right: 60 },
  PAINEL,
  { largura: 300, altura: 900 }
)
verdade('janela estreita nao produz left negativo', estreita.left >= 8)

// Empate: com o mesmo espaco dos dois lados, abrir para baixo e o comportamento esperado de um
// menu — trocar isso mexeria na direcao de abertura de toda a barra sem motivo.
const empate = calcularPosicaoFlutuante(
  { top: 430, bottom: 470, left: 200, right: 320 },
  PAINEL,
  { largura: 1440, altura: 900 }
)
eq('empate abre para baixo', empate.paraCima, false)

// Espacamento e margem customizados.
const custom = calcularPosicaoFlutuante(
  { top: 100, bottom: 140, left: 200, right: 320 },
  { largura: 320, altura: 200, espacamento: 20, margem: 30 },
  JANELA
)
eq('respeita o espacamento informado', custom.top, 160)

const coladoNaBorda = calcularPosicaoFlutuante(
  { top: 100, bottom: 140, left: 1439, right: 1440 },
  { largura: 320, altura: 200, espacamento: 8, margem: 30 },
  JANELA
)
eq('respeita a margem informada', coladoNaBorda.left, 1440 - 320 - 30)

console.log('\n' + ok + ' assercoes passaram, ' + falhas + ' falharam')
process.exit(falhas === 0 ? 0 : 1)
